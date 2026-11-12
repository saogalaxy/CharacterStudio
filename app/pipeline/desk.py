"""Talk to the local ComfyUI. Started only when a generate step needs it."""
import json
import mimetypes
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

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


def ensure(log_path):
    if alive():
        return
    main = rt.COMFY / "main.py"
    if not main.is_file():
        raise RuntimeError("ComfyUI is not in the runtime folder")
    rt.spawn(
        [str(rt.PYTHON), str(main), "--listen", "127.0.0.1", "--port", str(PORT), "--disable-auto-launch"],
        log_path,
        cwd=str(rt.COMFY),
    )
    for _ in range(180):
        if alive():
            return
        time.sleep(1)
    raise RuntimeError("ComfyUI did not start")


def upload_image(path: Path):
    ensure(rt.JOBS / "comfy.log")
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


def queue(prompt, client_id="character-studio", timeout=7200):
    ensure(rt.JOBS / "comfy.log")
    req = urllib.request.Request(
        _base() + "/prompt",
        data=json.dumps({"prompt": prompt, "client_id": client_id}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        prompt_id = json.loads(res.read().decode("utf-8"))["prompt_id"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        hist_req = urllib.request.Request(_base() + "/history/" + prompt_id)
        with urllib.request.urlopen(hist_req, timeout=30) as res:
            history = json.loads(res.read().decode("utf-8"))
        entry = history.get(prompt_id)
        if entry:
            status = (entry.get("status") or {}).get("status_str")
            if status == "error":
                raise RuntimeError("ComfyUI reported an error for this step")
            if entry.get("outputs"):
                return entry
        time.sleep(2)
    raise RuntimeError("ComfyUI timed out")


def newest(folder: Path, pattern: str):
    found = sorted(folder.glob(pattern), key=lambda p: p.stat().st_mtime)
    return found[-1] if found else None
