# Mesh2Motion human pack (CC0)

Source: https://github.com/Mesh2Motion/mesh2motion-app
Bones: UE5 names (same as Character Studio) — retarget is near 1:1.

- skeleton.glb — reference skeleton
- animations/*.glb — one clip per file (Action Forge uses this library)

Clips are stored **without** EXT_meshopt_compression so Blender can import them.
In Animations → Mesh2Motion library, search a clip and click Add to bake it onto the character.
