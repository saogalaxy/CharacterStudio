"""A private, hidden ComfyUI per step: free port, job-scoped input/output, killed afterwards."""
import json
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import runtime as rt


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Comfy rejected the graph (HTTP {e.code}): {e.read().decode(errors='replace')[:1500]}")


class Comfy:
    """with Comfy(workdir, log, flash=True, cancel=ev) as c: c.run(prompt, timeout, progress)"""

    def __init__(self, workdir, log_path, flash=False, cancel=None):
        self.dir = Path(workdir)
        self.input, self.output = self.dir / "input", self.dir / "output"
        self.log_path, self.flash, self.cancel = Path(log_path), flash, cancel
        self.proc = None

    def __enter__(self):
        for d in (self.input, self.output, self.dir / "temp", self.dir / "user"):
            d.mkdir(parents=True, exist_ok=True)
        self.port = _free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        db = "sqlite:///" + str(self.dir / "comfy.db").replace("\\", "/")
        # --disable-assets avoids Comfy's assets sqlite lock (orphan runs used to
        # leave comfy.db.lock and kill the next mesh start with exit 1).
        args = [rt.PYTHON, "-I", "-W", "ignore::FutureWarning", rt.COMFY / "main.py", "--windows-standalone-build",
                "--lowvram", "--port", self.port, "--listen", "127.0.0.1", "--disable-auto-launch",
                "--disable-assets",
                "--database-url", db, "--input-directory", self.input, "--output-directory", self.output,
                "--temp-directory", self.dir / "temp", "--user-directory", self.dir / "user"]
        if self.flash:
            args.append("--use-flash-attention")
        self.proc = rt.spawn(args, self.log_path, cwd=rt.COMFY.parent)
        t0 = time.time()
        while time.time() - t0 < 420:
            self._check_cancel()
            if self.proc.poll() is not None:
                raise RuntimeError(f"Comfy stopped while starting (exit {self.proc.returncode}); see {self.log_path.name}")
            try:
                _get(self.url + "/system_stats", 3)
                return self
            except Exception:
                time.sleep(2)
        raise RuntimeError("Comfy did not start within 7 minutes")

    def __exit__(self, *exc):
        rt.kill_tree(self.proc)

    def _check_cancel(self):
        if self.cancel is not None and self.cancel.is_set():
            rt.kill_tree(self.proc)
            raise rt.Cancelled()

    def run(self, prompt, timeout, progress=None):
        res = _post(self.url + "/prompt", {"prompt": prompt, "client_id": "character-studio"})
        if res.get("node_errors"):
            raise RuntimeError(f"Comfy graph errors: {json.dumps(res['node_errors'])[:1500]}")
        pid, t0 = res["prompt_id"], time.time()
        while time.time() - t0 < timeout:
            self._check_cancel()
            if self.proc.poll() is not None:
                raise RuntimeError(f"Comfy crashed during the run (exit {self.proc.returncode}); see {self.log_path.name}")
            try:
                h = _get(f"{self.url}/history/{pid}")
            except Exception:
                h = {}
            if pid in h:
                st = h[pid].get("status") or {}
                if st.get("status_str") == "error":
                    for m in st.get("messages") or []:
                        if m[0] == "execution_error":
                            d = m[1]
                            raise RuntimeError(f"Comfy failed in {d.get('node_type')} (node {d.get('node_id')}): "
                                               f"{str(d.get('exception_message')).strip()[:900]}")
                    raise RuntimeError("Comfy reported an execution error")
                return h[pid]
            # The worker thread can die without exiting the process or writing history.
            # A prompt that is gone from the queue and has no history will never finish.
            if time.time() - t0 > 20:
                try:
                    q = _get(f"{self.url}/queue")
                except Exception:
                    q = None
                if q is not None:
                    queued = [item[1] for item in (q.get("queue_running") or []) + (q.get("queue_pending") or [])]
                    if pid not in queued:
                        raise RuntimeError("Comfy dropped this run before it finished. See the step log.")
            if progress:
                progress(f"running in Comfy, {int(time.time() - t0)} s")
            time.sleep(3)
        raise RuntimeError(f"Comfy run took longer than {timeout // 60} minutes")
