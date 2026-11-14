"""Straighten every job mesh that already exists (pre–stand_up imports/generations).

Usage (from repo root):
  runtime\\python\\python.exe -m pipeline.retro_standup
  runtime\\python\\python.exe -m pipeline.retro_standup character_11e49d
"""
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from pipeline.jobs import Studio


def main(argv):
    studio = Studio()
    wanted = set(argv[1:])
    jobs = [
        job for job in studio.jobs.values()
        if job.path("mesh").is_file() and (not wanted or job.meta["id"] in wanted or job.meta.get("name") in wanted)
    ]
    if not jobs:
        print("No jobs with a mesh to straighten.")
        return 1
    print(f"Straightening {len(jobs)} job(s)…")
    failed = 0
    for job in jobs:
        name = job.meta.get("name") or job.meta["id"]
        print(f"  {name} ({job.meta['id']})…", flush=True)
        try:
            studio.straighten_existing_mesh(job)
            print(f"    ok — markers/rig cleared; re-place dots on Rig")
        except Exception as exc:
            failed += 1
            print(f"    FAIL: {exc}")
    print("Done." if not failed else f"Done with {failed} failure(s).")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
