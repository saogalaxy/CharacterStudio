"""Character Studio agent CLI.

Examples:
  runtime\\python\\python.exe -m cs_cli ensure
  runtime\\python\\python.exe -m cs_cli jobs
  runtime\\python\\python.exe -m cs_cli job <job_id>
  runtime\\python\\python.exe -m cs_cli run <job_id> markers
  runtime\\python\\python.exe -m cs_cli run <job_id> rig --wait
  runtime\\python\\python.exe -m cs_cli tears <job_id>
  runtime\\python\\python.exe -m cs_cli weights <job_id>
  runtime\\python\\python.exe -m cs_cli poses <job_id>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow ``python -m cs_cli`` from app/ and ``python app/cs_cli.py``.
APP = Path(__file__).resolve().parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from agent_drive import StudioClient, StudioError, default_client  # noqa: E402


def _out(data):
    print(json.dumps(data, indent=2, default=str))


def main(argv=None):
    parser = argparse.ArgumentParser(prog="cs", description="Drive Character Studio via its local API")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-ensure", action="store_true", help="do not auto-start headless API")
    sub = parser.add_subparsers(dest="cmd", required=True)
    # Accept --no-ensure before or after the subcommand.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--no-ensure", action="store_true", default=argparse.SUPPRESS,
                        help="do not auto-start headless API")

    sub.add_parser("ensure", help="start headless API if needed", parents=[common])
    sub.add_parser("jobs", help="list jobs", parents=[common])
    p = sub.add_parser("job", help="get one job state", parents=[common])
    p.add_argument("job_id")
    p = sub.add_parser("run", help="run a pipeline step", parents=[common])
    p.add_argument("job_id")
    p.add_argument("step", choices=["source", "tpose", "mesh", "markers", "skeleton", "rig", "animations"])
    p.add_argument("--wait", action="store_true", help="poll until the step finishes")
    p.add_argument("--timeout", type=float, default=7200.0)
    p = sub.add_parser("stop", help="stop the running step", parents=[common])
    p.add_argument("job_id")
    p = sub.add_parser("see-skeleton", help="mark skeleton as checked", parents=[common])
    p.add_argument("job_id")
    p = sub.add_parser("markers", help="read markers.json", parents=[common])
    p.add_argument("job_id")
    p = sub.add_parser("weights", help="latest STEP weights from rig log", parents=[common])
    p.add_argument("job_id")
    p = sub.add_parser("tears", help="compact deform QA / tear bone summary", parents=[common])
    p.add_argument("job_id")
    p = sub.add_parser("poses", help="list QA pose PNG paths", parents=[common])
    p.add_argument("job_id")
    p = sub.add_parser("report", help="rig/report.json", parents=[common])
    p.add_argument("job_id")
    p = sub.add_parser("deform", help="full deform_attribution.json (large)", parents=[common])
    p.add_argument("job_id")

    args = parser.parse_args(argv)
    client = default_client()
    if args.host:
        client = StudioClient(host=args.host, port=args.port or client.port)
    elif args.port:
        client = StudioClient(host=client.host, port=args.port)

    try:
        if args.cmd != "ensure" and not args.no_ensure:
            client.ensure(headless=True)
        if args.cmd == "ensure":
            _out(client.ensure(headless=True))
        elif args.cmd == "jobs":
            data = client.list_jobs()
            slim = [
                {
                    "id": j["id"],
                    "name": j["name"],
                    "running": j.get("running"),
                    "files": j.get("files"),
                    "rig_stale": j.get("rig_stale"),
                    "skeleton_seen": j.get("skeleton_seen"),
                }
                for j in data.get("jobs", [])
            ]
            _out({"jobs": slim})
        elif args.cmd == "job":
            _out(client.get_job(args.job_id))
        elif args.cmd == "run":
            state = client.run_step(args.job_id, args.step)
            if args.wait:
                state = client.wait_idle(args.job_id, timeout=args.timeout)
            _out(state)
        elif args.cmd == "stop":
            _out(client.stop(args.job_id))
        elif args.cmd == "see-skeleton":
            _out(client.see_skeleton(args.job_id))
        elif args.cmd == "markers":
            _out(client.markers_file(args.job_id))
        elif args.cmd == "weights":
            _out(client.last_weight_log(args.job_id))
        elif args.cmd == "tears":
            _out(client.tear_summary(args.job_id))
        elif args.cmd == "poses":
            _out({"poses": client.pose_shots(args.job_id)})
        elif args.cmd == "report":
            _out(client.rig_report(args.job_id))
        elif args.cmd == "deform":
            _out(client.deform_attribution(args.job_id))
        else:
            parser.error(f"unknown command {args.cmd}")
    except StudioError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
