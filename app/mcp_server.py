"""MCP stdio server for Character Studio.

Exposes the local job API so Cursor (or any MCP client) can drive the app,
including starting it headless when needed.

Run (Cursor mcp.json):
  D:\\CharacterStudio\\runtime\\python\\python.exe
  D:\\CharacterStudio\\app\\mcp_server.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

APP = Path(__file__).resolve().parent
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from agent_drive import StudioError, default_client  # noqa: E402

SERVER_NAME = "character-studio"
SERVER_VERSION = "0.1.0"

TOOLS = [
    {
        "name": "cs_ensure",
        "description": "Ensure Character Studio API is up; start headless on 127.0.0.1:8765 if needed.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "cs_list_jobs",
        "description": "List Character Studio jobs (id, name, files, running).",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "cs_get_job",
        "description": "Full job state JSON for one job id.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "cs_run_step",
        "description": (
            "Run a pipeline step: markers | skeleton | rig | animations | mesh | tpose | source. "
            "Set wait=true to poll until finished. Prefer markers/rig over starting Comfy mesh/tpose "
            "unless the user asked for generation."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "step": {
                    "type": "string",
                    "enum": ["source", "tpose", "mesh", "markers", "skeleton", "rig", "animations"],
                },
                "wait": {"type": "boolean", "default": False},
                "timeout": {"type": "number", "default": 7200},
            },
            "required": ["job_id", "step"],
        },
    },
    {
        "name": "cs_stop",
        "description": "Stop the running step on a job.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "cs_see_skeleton",
        "description": (
            "Mark the skeleton as reviewed (required before bind). "
            "Only call after zooming Skeleton/Rig joints on the mesh "
            "(neck, head, head_top, clavicles, spine, pelvis, knees) "
            "and confirming each sits on/inside the body — not from numbers alone."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "cs_get_markers",
        "description": "Read markers.json (joints, envelopes, tags) from disk for a job.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "cs_put_markers",
        "description": (
            "POST marker/joint updates. Pass joints and/or markers dicts as in the UI API. "
            "After editing chin/head/shoulders/knees/groin: zoom Markers close-ups of those dots, "
            "then zoom Skeleton/Rig joints driven by them on the mesh, before see_skeleton or rig. "
            "Do not bind from numbers alone."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "joints": {"type": "object"},
                "markers": {"type": "object"},
                "envelopes": {"type": "object"},
                "reset": {"type": "boolean"},
            },
            "required": ["job_id"],
        },
    },
    {
        "name": "cs_weights",
        "description": "Latest bind weight stats from the rig log (STEP weights), including hair_pinned when present.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "cs_tears",
        "description": "Compact deform QA: gate + tear/crush bone counts per sampled pose.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "cs_poses",
        "description": "List QA pose PNG paths under jobs/<id>/rig/poses (walk/idle stills).",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "cs_rig_report",
        "description": "Read rig/report.json for a job.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
]


def _text(payload: Any) -> dict:
    text = payload if isinstance(payload, str) else json.dumps(payload, indent=2, default=str)
    return {"content": [{"type": "text", "text": text}]}


def _err(message: str) -> dict:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def _client():
    client = default_client()
    client.ensure(headless=True)
    return client


def call_tool(name: str, args: dict) -> dict:
    args = args or {}
    try:
        if name == "cs_ensure":
            return _text(default_client().ensure(headless=True))
        client = _client()
        if name == "cs_list_jobs":
            data = client.list_jobs()
            slim = [
                {
                    "id": j["id"],
                    "name": j["name"],
                    "running": j.get("running"),
                    "files": j.get("files"),
                    "rig_stale": j.get("rig_stale"),
                    "skeleton_seen": j.get("skeleton_seen"),
                    "can_run": j.get("can_run"),
                }
                for j in data.get("jobs", [])
            ]
            return _text({"jobs": slim})
        if name == "cs_get_job":
            return _text(client.get_job(args["job_id"]))
        if name == "cs_run_step":
            state = client.run_step(args["job_id"], args["step"])
            if args.get("wait"):
                state = client.wait_idle(args["job_id"], timeout=float(args.get("timeout") or 7200))
            return _text(state)
        if name == "cs_stop":
            return _text(client.stop(args["job_id"]))
        if name == "cs_see_skeleton":
            return _text(client.see_skeleton(args["job_id"]))
        if name == "cs_get_markers":
            return _text(client.markers_file(args["job_id"]))
        if name == "cs_put_markers":
            payload = {k: args[k] for k in ("joints", "markers", "envelopes", "reset") if k in args}
            return _text(client.put_markers(args["job_id"], **payload))
        if name == "cs_weights":
            return _text(client.last_weight_log(args["job_id"]))
        if name == "cs_tears":
            return _text(client.tear_summary(args["job_id"]))
        if name == "cs_poses":
            return _text({"poses": client.pose_shots(args["job_id"])})
        if name == "cs_rig_report":
            return _text(client.rig_report(args["job_id"]))
        return _err(f"unknown tool {name}")
    except StudioError as exc:
        return _err(str(exc))
    except KeyError as exc:
        return _err(f"missing argument: {exc}")
    except Exception as exc:  # noqa: BLE001 — surface to MCP client
        return _err(f"{type(exc).__name__}: {exc}")


def _read_message() -> dict | None:
    line = sys.stdin.buffer.readline()
    if not line:
        return None
    # Support Content-Length framed MCP and newline-delimited JSON.
    if line.lower().startswith(b"content-length:"):
        length = int(line.split(b":", 1)[1].strip())
        while True:
            header = sys.stdin.buffer.readline()
            if header in (b"\r\n", b"\n", b""):
                break
        body = sys.stdin.buffer.read(length)
        return json.loads(body.decode("utf-8"))
    return json.loads(line.decode("utf-8"))


def _write_message(msg: dict) -> None:
    # MCP stdio transport: one JSON-RPC message per line, no Content-Length
    # header (that is LSP framing and MCP clients reject it).
    raw = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(raw + b"\n")
    sys.stdout.buffer.flush()


def handle(msg: dict) -> dict | None:
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": mid,
            "result": {
                "protocolVersion": params.get("protocolVersion") or "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        }
    if method == "notifications/initialized":
        return None
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        result = call_tool(name, arguments)
        return {"jsonrpc": "2.0", "id": mid, "result": result}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if mid is None:
        return None
    return {
        "jsonrpc": "2.0",
        "id": mid,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main():
    # Line-buffer-friendly: binary framed writes on stdout.
    while True:
        msg = _read_message()
        if msg is None:
            break
        reply = handle(msg)
        if reply is not None:
            _write_message(reply)


if __name__ == "__main__":
    main()
