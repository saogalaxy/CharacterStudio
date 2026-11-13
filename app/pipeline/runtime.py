"""Where the engines live.

Portable layout (the packaged app):
    <pkg>/app/         this code
    <pkg>/runtime/     python, ComfyUI (+ custom nodes, models), hf cache, blender
    <pkg>/jobs/        user work
Without runtime/ next to app/, the developer install paths are used.
"""
import os
import shutil
import subprocess
import time
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
PKG = APP.parent
RT = PKG / "runtime"
PORTABLE = (RT / "ComfyUI" / "main.py").is_file()

if PORTABLE:
    PYTHON = RT / "python" / "python.exe"
    COMFY = RT / "ComfyUI"
    BLENDER = RT / "blender" / "blender.exe"
    HF_HOME = RT / "hf"
    JOBS = PKG / "jobs"
else:
    _EI = Path(r"D:\ComfyUI-Easy-Install\ComfyUI-Easy-Install")
    PYTHON = _EI / "python_embeded" / "python.exe"
    COMFY = _EI / "ComfyUI"
    BLENDER = Path(r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe")
    HF_HOME = None
    JOBS = APP / "jobs"

BLENDER_SCRIPTS = APP / "pipeline" / "blender"
WORKFLOWS = APP / "workflows"

NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW: child consoles never appear


def engine_env():
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    if HF_HOME:
        # the package must never reach out to the internet for weights
        env.update(HF_HOME=str(HF_HOME), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                   TORCH_HOME=str(RT / "torch"), U2NET_HOME=str(COMFY / "models" / "rembg"))
    return env


def spawn(args, log_path, cwd=None):
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log = open(log_path, "a", encoding="utf-8", errors="replace")
    return subprocess.Popen([str(a) for a in args], cwd=str(cwd) if cwd else None, env=engine_env(),
                            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                            creationflags=NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)


def kill_tree(proc):
    if proc and proc.poll() is None:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True,
                       creationflags=NO_WINDOW)


def child_pids(parent):
    """Direct child process ids. Toolhelp, because wmic is gone on current Windows."""
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_void_p),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel.Process32FirstW.restype = wintypes.BOOL
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel.Process32NextW.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL

    snap = kernel.CreateToolhelp32Snapshot(0x00000002, 0)
    if snap is None or snap == wintypes.HANDLE(-1).value:
        raise OSError("could not list processes")
    found = []
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        ok = kernel.Process32FirstW(snap, ctypes.byref(entry))
        parent = int(parent)
        while ok:
            if entry.th32ParentProcessID == parent:
                found.append(int(entry.th32ProcessID))
            ok = kernel.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snap)
    return found


def kill_descendants():
    """End processes this app started (ComfyUI, Blender, the WebView browser)."""
    try:
        pids = child_pids(os.getpid())
    except OSError:
        return
    for pid in pids:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True,
                       creationflags=NO_WINDOW, timeout=5)


def _wmic_comfy_pids(needle):
    """PIDs of ComfyUI main.py processes whose command line contains needle."""
    needle = str(needle).replace("/", "\\").lower()
    try:
        out = subprocess.check_output(
            ["wmic", "process", "where",
             "name='python.exe' or name='pythonw.exe'",
             "get", "ProcessId,CommandLine", "/FORMAT:LIST"],
            stderr=subprocess.DEVNULL, creationflags=NO_WINDOW, text=True, errors="replace")
    except Exception:
        return []
    pids, cmd = [], ""
    for line in out.splitlines():
        if line.startswith("CommandLine="):
            cmd = line[len("CommandLine="):]
        elif line.startswith("ProcessId=") and cmd:
            low = cmd.lower().replace("/", "\\")
            if "comfyui" in low and "main.py" in low and needle in low:
                try:
                    pids.append(int(line.split("=", 1)[1].strip()))
                except ValueError:
                    pass
            cmd = ""
    return pids


def kill_comfy_orphans(path):
    """Kill leftover ComfyUI processes for a job workdir (or the whole jobs root)."""
    for pid in _wmic_comfy_pids(path):
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True,
                       creationflags=NO_WINDOW)
    # give Windows a moment to release sqlite locks
    if _wmic_comfy_pids(path):
        time.sleep(0.8)


def reclaim_workdir(path):
    """Kill orphan Comfy for this folder, then delete it so the next run is clean."""
    path = Path(path)
    kill_comfy_orphans(path)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    if path.exists():
        # last resort: drop the locked sqlite files Comfy chokes on
        for name in ("comfy.db", "comfy.db-shm", "comfy.db-wal", "comfy.db.lock"):
            try:
                (path / name).unlink(missing_ok=True)
            except OSError:
                pass
        time.sleep(0.5)
        shutil.rmtree(path, ignore_errors=True)


def blender(script, args, log_path, cancel=None, timeout=3600):
    """Run a Blender script headless; returns exit code. `cancel` is a threading.Event."""
    p = spawn([BLENDER, "-b", "--factory-startup", "--python-exit-code", "1",
               "-P", BLENDER_SCRIPTS / script, "--", *args], log_path)
    return wait_proc(p, cancel, timeout)


def wait_proc(p, cancel=None, timeout=3600):
    import time
    t0 = time.time()
    while p.poll() is None:
        if cancel is not None and cancel.is_set():
            kill_tree(p)
            raise Cancelled()
        if time.time() - t0 > timeout:
            kill_tree(p)
            raise RuntimeError(f"timed out after {timeout}s")
        time.sleep(0.5)
    return p.returncode


class Cancelled(Exception):
    pass
