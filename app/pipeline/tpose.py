"""Qwen Image 2.1 T-pose edit graphs.

TextEncodeQwenImage21 must receive the source as the named slot ``images.image_1``.
The bare list form queues fine but drops the image conditioning, so Comfy draws an
unrelated character instead of editing the source.

Methods:
  standard — original Studio identity-preserving prompt, 1024 output
  2_5d     — Desktop ``2.5d T-pose.json`` prompt + larger output for mesh
  custom   — user-edited prompt on the standard graph
"""
from pathlib import Path

from . import runtime as rt

STANDARD_PROMPT = (
    "Edit this character into a standing straight symmetrical t-pose with arms "
    "extended horizontally parallel to the ground, legs straight, facing camera. "
    "Preserve the exact same character identity, face, hair color and style, "
    "outfit, colors, accessories, body proportions, and art style from the input. "
    "The subject is a smooth physical 3D object with visible material properties: "
    "semi-matte skin with subsurface scattering, painted highlights, crisp sculpted "
    "molded hair edges with no gaps, matte smooth synthetic polymers, and "
    "hand-painted gradients under soft studio lighting. Place the entire statue "
    "against a clean grey photographic background with significant negative space. "
    "Remove all watermarks and output no text."
)

# From Desktop ``2.5d T-pose api.json`` (TextEncodeQwenImage21 prompt).
PROMPT_2_5D = (
    " character to standing straight symmetrical t-pose arms extended parallel to surface  . "
    "keep body proportions \n\n"
    "A high-definition anime character illustration with bold, uniform black ink outlines. "
    "The character features a high-gloss PVC finish with sharp, hard-edged specular "
    "highlights on the skin and clothing., . High contrast, clean lineart, professional "
    "character-sheet style, Shadow should be parallel to the wall, remove floor Shadow ,  "
    "pure white background with a heavy, sharp-edged semi warm tones"
)

METHODS = ("standard", "2_5d", "custom")
DEFAULT_METHOD = "standard"
DEFAULT_PROMPTS = {
    "standard": STANDARD_PROMPT,
    "2_5d": PROMPT_2_5D,
    "custom": STANDARD_PROMPT,
}

UPSCALE_NAME = "4x-UltraSharp.pth"
# When the Desktop upscale model isn't in the package, 2.5d still emits a larger
# image for the mesh step (Desktop upscales after Qwen).
FALLBACK_2_5D_SIZE = 2048


def _upscale_model_path():
    return rt.COMFY / "models" / "upscale_models" / UPSCALE_NAME


def settings_from(payload=None):
    """Normalize UI/API tpose settings.

    standard / 2_5d always restore their stock prompts unless ``keep_prompt`` is set.
    custom keeps the prompt the UI sent, or the remembered custom text.
    ``custom_prompt`` survives a switch to standard / 2.5D so Custom can come back.
    """
    payload = payload or {}
    method = str(payload.get("method") or DEFAULT_METHOD).lower().strip()
    if method not in METHODS:
        method = DEFAULT_METHOD
    remembered = str(payload.get("custom_prompt") or "")
    if method == "custom":
        prompt = str(payload.get("prompt") or remembered or STANDARD_PROMPT)
        if not prompt.strip():
            prompt = remembered.strip() or STANDARD_PROMPT
        remembered = prompt
    elif payload.get("keep_prompt") and payload.get("prompt") is not None:
        prompt = str(payload.get("prompt") or DEFAULT_PROMPTS[method])
    else:
        prompt = DEFAULT_PROMPTS[method]
    if not str(prompt).strip():
        prompt = DEFAULT_PROMPTS.get(method, STANDARD_PROMPT)
    return {"method": method, "prompt": prompt, "custom_prompt": remembered}


def build_prompt(image_name, method=DEFAULT_METHOD, prompt=None, seed=42, filename_prefix="studio_tpose",
                 steps=25):
    method = method if method in METHODS else DEFAULT_METHOD
    text = (prompt if prompt is not None else DEFAULT_PROMPTS[method]).strip() or DEFAULT_PROMPTS[method]
    use_2_5d = method == "2_5d"

    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "ResizeAndPadImage",
              "inputs": {"image": ["1", 0], "target_width": 1024, "target_height": 1024,
                         "padding_color": "black", "interpolation": "lanczos"}},
        "3": {"class_type": "UNETLoader",
              "inputs": {"unet_name": "qwen_image_2.1_int8_convrot.safetensors", "weight_dtype": "default"}},
        "4": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": "qwen3vl_8b_int8_convrot.safetensors", "type": "qwen_image",
                         "device": "default"}},
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
        "6": {"class_type": "QwenImage21Cache", "inputs": {"model": ["3", 0], "device": "auto", "dtype": "default"}},
        "7": {"class_type": "TextEncodeQwenImage21",
              # Desktop 2.5d passes resolution=0 (pixel budget); standard Studio used 0 too.
              "inputs": {"clip": ["4", 0], "prompt": text, "negative_prompt": "", "resolution": 0,
                         "vae": ["5", 0], "images.image_1": ["2", 0]}},
        "8": {"class_type": "KSampler",
              "inputs": {"model": ["6", 0], "positive": ["7", 0], "negative": ["7", 1],
                         "latent_image": ["7", 2], "seed": seed, "steps": steps, "cfg": 1.0,
                         "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["5", 0]}},
    }

    image_out = ["9", 0]
    if use_2_5d:
        if _upscale_model_path().is_file():
            g["11"] = {"class_type": "UpscaleModelLoader", "inputs": {"model_name": UPSCALE_NAME}}
            g["12"] = {"class_type": "ImageUpscaleWithModel",
                       "inputs": {"upscale_model": ["11", 0], "image": ["9", 0]}}
            image_out = ["12", 0]
        else:
            # Offline package has no UltraSharp; still give mesh a denser T-pose.
            g["12"] = {"class_type": "ImageScale",
                       "inputs": {"image": ["9", 0], "upscale_method": "lanczos",
                                  "width": FALLBACK_2_5D_SIZE, "height": FALLBACK_2_5D_SIZE,
                                  "crop": "disabled"}}
            image_out = ["12", 0]

    g["10"] = {"class_type": "SaveImage", "inputs": {"images": image_out, "filename_prefix": filename_prefix}}
    return {"prompt": g, "client_id": "character-studio"}
