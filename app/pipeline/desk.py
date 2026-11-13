"""Talk to the local ComfyUI. Started only when a generate step needs it."""
import json
import mimetypes
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import websocket

from . import runtime as rt

PORT = 8188


def _base():
    return f"http://127.0.0.1:{PORT}"


def alive():
    try:
        with urllib.request.urlopen(_base() + "/system_stats", timeout=2) as res:
            return res.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _stopped(cancel):
    return cancel is not None and cancel.is_set()


def ensure(log_path, cancel=None):
    if alive():
        return
    if _stopped(cancel):
        raise rt.Cancelled()
    main = rt.COMFY / "main.py"
    if not main.is_file():
        raise RuntimeError("ComfyUI is not in the runtime folder")
    proc = rt.spawn(
        [str(rt.PYTHON), str(main), "--listen", "127.0.0.1", "--port", str(PORT), "--disable-auto-launch"],
        log_path,
        cwd=str(rt.COMFY),
    )
    for _ in range(180):
        if _stopped(cancel):
            rt.kill_tree(proc)
            raise rt.Cancelled()
        if alive():
            return
        time.sleep(1)
    raise RuntimeError("ComfyUI did not start")


def cancel_prompt(prompt_id):
    """Interrupt one ComfyUI prompt. Pending prompts are dropped from the queue."""
    if not prompt_id or not alive():
        return
    quoted = urllib.parse.quote(str(prompt_id))
    calls = [
        ("/queue", {"delete": [prompt_id]}),
        (f"/api/jobs/{quoted}/cancel", {}),
        ("/interrupt", {"prompt_id": prompt_id}),
    ]
    for path, payload in calls:
        try:
            req = urllib.request.Request(
                _base() + path,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as res:
                res.read()
        except (urllib.error.URLError, TimeoutError, OSError):
            continue


def upload_image(path: Path, cancel=None):
    ensure(rt.JOBS / "comfy.log", cancel)
    if _stopped(cancel):
        raise rt.Cancelled()
    boundary = "----studio" + uuid.uuid4().hex
    filename = path.name
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode(),
        f"Content-Type: {mime}\r\n\r\n".encode(),
        path.read_bytes(),
        f"\r\n--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n',
        f"--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        _base() + "/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        payload = json.loads(res.read().decode("utf-8"))
    name = payload.get("name") or filename
    sub = payload.get("subfolder") or ""
    return f"{sub}/{name}" if sub else name


class RunProgress:
    """Progress from ComfyUI execution events. No timer.

    Stage text is the running node's own title, or its class name when
    the workflow has no title. Progress is finished nodes plus the
    current node's reported fraction, over the nodes in the prompt.
    """

    def __init__(self, prompt):
        self.titles = {}
        for node_id, node in (prompt or {}).items():
            if not isinstance(node, dict) or not node.get("class_type"):
                continue
            title = str((node.get("_meta") or {}).get("title") or node["class_type"])
            self.titles[str(node_id)] = title
        self.total = max(len(self.titles), 1)
        self.finished = set()
        self.current = None
        self.frac = 0.0
        self.stage = "waiting on ComfyUI"
        self.prompt_id = None

    def snapshot(self):
        extra = 0.0
        if self.current and self.current not in self.finished:
            extra = min(1.0, max(0.0, self.frac))
        return self.stage, min(1.0, (len(self.finished) + extra) / self.total)

    def complete(self):
        self.finished.update(self.titles)
        self.current = None
        self.frac = 0.0

    def _title(self, node_id):
        return self.titles.get(str(node_id), str(node_id))

    def _fraction(self, value, maximum):
        try:
            value = float(value or 0)
            maximum = float(maximum or 0)
        except (TypeError, ValueError):
            return None
        if maximum <= 0:
            return 0.0
        return min(1.0, max(0.0, value / maximum))

    def apply(self, message):
        if not isinstance(message, dict):
            return False
        data = message.get("data") or {}
        if not isinstance(data, dict):
            return False
        pid = data.get("prompt_id")
        if self.prompt_id and pid and pid != self.prompt_id:
            return False
        kind = message.get("type")
        changed = False
        if kind == "execution_cached":
            for node_id in data.get("nodes") or []:
                if str(node_id) not in self.finished:
                    self.finished.add(str(node_id))
                    changed = True
        elif kind == "executing":
            node = data.get("node")
            if node is None:
                return changed
            node = str(node)
            if node != self.current:
                self.current = node
                self.frac = 0.0
                self.stage = self._title(node)
                changed = True
        elif kind == "progress":
            node = data.get("node")
            if node is None:
                return changed
            node = str(node)
            frac = self._fraction(data.get("value"), data.get("max"))
            if frac is None:
                return changed
            if node != self.current or abs(frac - self.frac) > 1e-6:
                self.current = node
                self.frac = frac
                self.stage = self._title(node)
                changed = True
        elif kind == "executed":
            node = data.get("node")
            if node is not None and str(node) not in self.finished:
                self.finished.add(str(node))
                if self.current == str(node):
                    self.frac = 0.0
                changed = True
        elif kind == "progress_state":
            for node_id, row in (data.get("nodes") or {}).items():
                if not isinstance(row, dict):
                    continue
                nid = str(row.get("node_id") or node_id)
                state = row.get("state")
                if state == "finished" and nid not in self.finished:
                    self.finished.add(nid)
                    changed = True
                elif state == "running":
                    frac = self._fraction(row.get("value"), row.get("max"))
                    if frac is None:
                        continue
                    if nid != self.current or abs(frac - self.frac) > 1e-6:
                        self.current = nid
                        self.frac = frac
                        self.stage = self._title(nid)
                        changed = True
        return changed


def _drain_progress(ws, tracker):
    changed = False
    while True:
        try:
            raw = ws.recv()
        except websocket.WebSocketTimeoutException:
            break
        except websocket.WebSocketConnectionClosedException:
            break
        if isinstance(raw, (bytes, bytearray)):
            continue
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if tracker.apply(message):
            changed = True
    return changed


def queue(prompt, client_id="character-studio", timeout=7200, on_progress=None, cancel=None, on_id=None):
    ensure(rt.JOBS / "comfy.log", cancel)
    if _stopped(cancel):
        raise rt.Cancelled()
    tracker = RunProgress(prompt)
    if on_progress:
        on_progress(*tracker.snapshot())
    sock = None
    try:
        try:
            sock = websocket.create_connection(
                f"ws://127.0.0.1:{PORT}/ws?clientId={urllib.parse.quote(client_id)}",
                timeout=5,
            )
            sock.settimeout(0.4)
        except (websocket.WebSocketException, OSError, TimeoutError):
            sock = None
        req = urllib.request.Request(
            _base() + "/prompt",
            data=json.dumps({"prompt": prompt, "client_id": client_id}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as res:
            prompt_id = json.loads(res.read().decode("utf-8"))["prompt_id"]
        tracker.prompt_id = prompt_id
        if on_id:
            on_id(prompt_id)
        if _stopped(cancel):
            cancel_prompt(prompt_id)
            raise rt.Cancelled()
        deadline = time.time() + timeout
        last_history = 0.0
        while time.time() < deadline:
            if _stopped(cancel):
                cancel_prompt(prompt_id)
                raise rt.Cancelled()
            if sock is not None:
                try:
                    if _drain_progress(sock, tracker) and on_progress:
                        on_progress(*tracker.snapshot())
                except websocket.WebSocketException:
                    sock = None
            now = time.time()
            if now - last_history >= 2:
                last_history = now
                hist_req = urllib.request.Request(_base() + "/history/" + prompt_id)
                with urllib.request.urlopen(hist_req, timeout=30) as res:
                    history = json.loads(res.read().decode("utf-8"))
                entry = history.get(prompt_id)
                if entry:
                    if _stopped(cancel):
                        cancel_prompt(prompt_id)
                        raise rt.Cancelled()
                    status = (entry.get("status") or {}).get("status_str")
                    if status == "error":
                        raise RuntimeError("ComfyUI reported an error for this step")
                    if entry.get("outputs"):
                        tracker.complete()
                        if on_progress:
                            on_progress(*tracker.snapshot())
                        return entry
            time.sleep(0.4)
    finally:
        if sock is not None:
            sock.close()
    raise RuntimeError("ComfyUI timed out")


def newest(folder: Path, pattern: str):
    found = sorted(folder.glob(pattern), key=lambda p: p.stat().st_mtime)
    return found[-1] if found else None
