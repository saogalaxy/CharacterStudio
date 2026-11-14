"""HTTP client for Character Studio — shared by CLI and MCP.

Talks to the local aiohttp API (default 127.0.0.1:8765). Can spawn the
server with ``--headless`` when nothing is listening, so an agent can drive
jobs without the WebView window.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parent
PKG = APP.parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
RUNTIME_PY = PKG / "runtime" / "python" / "python.exe"
RUNTIME_PYW = PKG / "runtime" / "python" / "pythonw.exe"


class StudioError(RuntimeError):
    pass


class StudioClient:
    def __init__(self, host=DEFAULT_HOST, port=DEFAULT_PORT, timeout=30.0):
        self.base = f"http://{host}:{int(port)}"
        self.timeout = float(timeout)
        self.port = int(port)
        self.host = host

    def alive(self) -> bool:
        try:
            self.get("/api/jobs")
            return True
        except Exception:
            return False

    def ensure(self, headless=True, wait=20.0) -> dict:
        """Return status; start headless server if the API is down."""
        if self.alive():
            return {"ok": True, "running": True, "started": False, "base": self.base}
        if not headless:
            raise StudioError(f"Character Studio API not reachable at {self.base}")
        py = RUNTIME_PY if RUNTIME_PY.is_file() else Path(sys.executable)
        cmd = [str(py), str(APP / "app.py"), "--headless", "--port", str(self.port)]
        creation = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        if os.name == "nt":
            creation |= 0x08000000  # CREATE_NO_WINDOW
        subprocess.Popen(
            cmd,
            cwd=str(PKG),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation if os.name == "nt" else 0,
            start_new_session=(os.name != "nt"),
        )
        deadline = time.time() + wait
        while time.time() < deadline:
            if self.alive():
                return {"ok": True, "running": True, "started": True, "base": self.base}
            time.sleep(0.25)
        raise StudioError(f"started headless but API did not come up at {self.base}")

    def get(self, path: str):
        return self._request("GET", path)

    def post(self, path: str, body=None):
        return self._request("POST", path, body if body is not None else {})

    def delete(self, path: str):
        return self._request("DELETE", path)

    def _request(self, method: str, path: str, body=None):
        url = self.base + path
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                if not raw:
                    return {"ok": True}
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise StudioError(f"{method} {path} -> {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise StudioError(f"{method} {path} failed: {exc.reason}") from exc

    # --- high-level ops -------------------------------------------------

    def list_jobs(self):
        return self.get("/api/jobs")

    def get_job(self, job_id: str):
        return self.get(f"/api/jobs/{job_id}")

    def run_step(self, job_id: str, step: str, payload=None):
        return self.post(f"/api/jobs/{job_id}/run/{step}", payload or {})

    def stop(self, job_id: str):
        return self.post(f"/api/jobs/{job_id}/stop", {})

    def see_skeleton(self, job_id: str):
        return self.post(f"/api/jobs/{job_id}/skeleton/seen", {})

    def put_markers(self, job_id: str, **payload):
        return self.post(f"/api/jobs/{job_id}/markers", payload)

    def job_dir(self, job_id: str) -> Path:
        return PKG / "jobs" / job_id

    def read_json(self, job_id: str, rel: str):
        path = self.job_dir(job_id) / rel
        if not path.is_file():
            raise StudioError(f"missing {path}")
        return json.loads(path.read_text(encoding="utf-8"))

    def deform_attribution(self, job_id: str):
        return self.read_json(job_id, "rig/deform_attribution.json")

    def rig_report(self, job_id: str):
        return self.read_json(job_id, "rig/report.json")

    def markers_file(self, job_id: str):
        return self.read_json(job_id, "markers.json")

    def last_weight_log(self, job_id: str) -> dict:
        """Parse the latest ``STEP weights`` line from the rig log."""
        log = self.job_dir(job_id) / "logs" / "rig.txt"
        if not log.is_file():
            raise StudioError(f"no rig log at {log}")
        last = None
        for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("STEP weights "):
                last = line[len("STEP weights "):]
        if last is None:
            raise StudioError("no STEP weights line in rig log")
        return json.loads(last)

    def pose_shots(self, job_id: str) -> list[dict]:
        folder = self.job_dir(job_id) / "rig" / "poses"
        if not folder.is_dir():
            return []
        out = []
        for path in sorted(folder.glob("*.png")):
            out.append({"name": path.name, "path": str(path), "bytes": path.stat().st_size})
        return out

    def tear_summary(self, job_id: str) -> dict:
        """Compact deform QA view: gate + per-pose tear bone counts."""
        data = self.deform_attribution(job_id)
        poses = {}
        for name, pose in (data.get("poses") or {}).items():
            poses[name] = {
                "tears": len(pose.get("tears") or []),
                "max_stretch": pose.get("max_stretch"),
                "tear_bones": pose.get("tear_bones") or {},
                "crush_bones": pose.get("crush_bones") or {},
            }
        return {"gate": data.get("gate"), "poses": poses}

    def wait_idle(self, job_id: str, timeout=3600.0, poll=1.0) -> dict:
        """Poll until job.running is null or timeout."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            state = self.get_job(job_id)
            if not state.get("running"):
                return state
            time.sleep(poll)
        raise StudioError(f"job {job_id} still running after {timeout}s")


def default_client() -> StudioClient:
    port = int(os.environ.get("CHARACTER_STUDIO_PORT", DEFAULT_PORT))
    host = os.environ.get("CHARACTER_STUDIO_HOST", DEFAULT_HOST)
    return StudioClient(host=host, port=port)
