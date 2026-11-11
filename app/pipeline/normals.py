"""Turn a baked normal map down when it would shade as dark blotches.

The bake records the high poly's normals, and where the high poly folds back on itself
(hair, straps, creases) those normals point into the body. At full strength that reads as
dark patches. 0.55 keeps the form and drops the patches; a map that is actually full of
back-facing hits is turned down further.
"""
import json
import struct
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

BAD_Z = 0.40
BAD_SHARE = 0.015
SCALE = 0.55
WEAK_SCALE = 0.4


def _parts(data):
    clen, _ = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen])
    off = 20 + clen
    off += (4 - off % 4) % 4
    blen, _ = struct.unpack_from("<II", data, off)
    return js, bytearray(data[off + 8:off + 8 + blen])


def _pack(js, blob):
    js["buffers"][0]["byteLength"] = len(blob)
    payload = json.dumps(js, separators=(",", ":")).encode()
    payload += b" " * ((4 - len(payload) % 4) % 4)
    blob = bytes(blob) + b"\x00" * ((4 - len(blob) % 4) % 4)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(payload) + 8 + len(blob))
    out += struct.pack("<II", len(payload), 0x4E4F534A) + payload
    out += struct.pack("<II", len(blob), 0x004E4942) + blob
    return bytes(out)


def repair(path):
    path = Path(path)
    data = path.read_bytes()
    if data[:4] != b"glTF":
        return None
    js, blob = _parts(data)
    changed = False
    report = {"scale": None, "bad_share": 0.0}
    for mat in js.get("materials", []):
        ref = mat.get("normalTexture")
        if not ref:
            continue
        tex = js["textures"][ref["index"]]
        info = js["images"][tex["source"]]
        if "bufferView" not in info:
            continue
        bv = js["bufferViews"][info["bufferView"]]
        start = bv.get("byteOffset", 0)
        im = Image.open(BytesIO(bytes(blob[start:start + bv["byteLength"]]))).convert("RGB")
        rgb = np.asarray(im, dtype=np.float32) / 255.0
        used = np.abs(rgb - np.array([0.5, 0.5, 1.0])).max(2) > 0.02
        share = float(((rgb[:, :, 2] * 2 - 1 < BAD_Z) & used).sum() / max(1, int(used.sum())))
        scale = WEAK_SCALE if share > BAD_SHARE else SCALE
        report = {"scale": scale, "bad_share": round(share, 4)}
        if ref.get("scale") != scale:
            ref["scale"] = scale
            changed = True
    if changed:
        path.write_bytes(_pack(js, blob))
    return report
