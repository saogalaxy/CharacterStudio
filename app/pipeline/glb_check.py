"""Independent GLB check (no Blender): skin, joints, weights, named animations."""
import json, struct, sys

REQUIRED = {"idle", "walk", "mild_crouch", "wave", "farm_harvest"}

path = sys.argv[1]
data = open(path, "rb").read()
magic, ver, total = struct.unpack_from("<III", data, 0)
assert magic == 0x46546C67, "not a GLB"
jlen, _ = struct.unpack_from("<II", data, 12)
g = json.loads(data[20:20 + jlen])
nodes = g.get("nodes", [])
skins = g.get("skins", [])
anims = g.get("animations", [])
meshes = g.get("meshes", [])
prims = [p for m in meshes for p in m["primitives"]]
has_w = all("JOINTS_0" in p["attributes"] and "WEIGHTS_0" in p["attributes"] for p in prims)
joint_names = [nodes[j]["name"] for j in skins[0]["joints"]] if skins else []
out = {
    "skins": len(skins),
    "joints": len(joint_names),
    "joint_names": joint_names,
    "primitives_with_weights": f"{sum('WEIGHTS_0' in p['attributes'] for p in prims)}/{len(prims)}",
    "animations": {a["name"]: len(a["channels"]) for a in anims},
    "materials": len(g.get("materials", [])),
    "textures": len(g.get("textures", [])),
}
missing = REQUIRED - set(out["animations"])
ok = bool(skins) and has_w and not missing and {"pelvis", "head", "hand_l", "foot_r"} <= set(joint_names)
out["missing_animations"] = sorted(missing)
out["result"] = "PASS" if ok else "FAIL"
print(json.dumps(out, indent=1))
sys.exit(0 if ok else 1)
