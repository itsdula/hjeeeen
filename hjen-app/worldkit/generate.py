#!/usr/bin/env python3
"""
Generate a Saudi-translated image via OpenAI gpt-image-2 (ChatGPT Image 2.0).

Image-to-image edit: takes the user's reference image (+ optional canny/depth
+ any number of additional references) and posts them to OpenAI's
/v1/images/edits endpoint as a multipart form. Returns an image (decoded from
the response's b64_json field) optionally resized to exactly match the
reference's pixel dimensions.

Stdlib-only HTTP (multipart/form-data hand-rolled) — no extra deps beyond
Pillow.
"""

import argparse
import base64
import io
import json
import mimetypes
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image


API_URL = "https://api.openai.com/v1/images/edits"
DEFAULT_MODEL = "gpt-image-2"
ALLOWED_SIZES = {
    "1024x1024", "1024x1536", "1536x1024",
    "2048x2048", "1536x2304", "2304x1536",
    "3840x3840", "2160x3840", "3840x2160",
    "auto",
}


def detect_mime(path: Path) -> str:
    mt, _ = mimetypes.guess_type(str(path))
    if mt and mt.startswith("image/"):
        return mt
    ext = path.suffix.lower()
    return {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp"}.get(ext, "image/png")


def closest_size(w: int, h: int) -> str:
    """Map input (w,h) to the closest documented gpt-image-2 size from the
    skill's pre-generation menu."""
    target = w / h
    portrait = h > w
    landscape = w > h
    if abs(target - 1.0) < 0.05:
        return "2048x2048"
    if portrait:
        # 2K portrait is the editorial default
        return "1536x2304"
    if landscape:
        return "2304x1536"
    return "2048x2048"


def build_multipart(fields: dict, files: list) -> tuple:
    """Build multipart/form-data body.

    fields: dict of str -> str (text fields).
    files:  list of (field_name, filename, mime, data_bytes).
    Returns (body_bytes, content_type_header_value).
    """
    boundary = "----saudi-translator-" + secrets.token_hex(16)
    buf = io.BytesIO()

    def w(s):
        buf.write(s.encode("utf-8") if isinstance(s, str) else s)

    for name, value in fields.items():
        if value is None:
            continue
        w(f"--{boundary}\r\n")
        w(f'Content-Disposition: form-data; name="{name}"\r\n\r\n')
        w(str(value))
        w("\r\n")
    for field_name, filename, mime, data in files:
        w(f"--{boundary}\r\n")
        w(f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n')
        w(f"Content-Type: {mime}\r\n\r\n")
        w(data)
        w("\r\n")
    w(f"--{boundary}--\r\n")
    return buf.getvalue(), f"multipart/form-data; boundary={boundary}"


def call_gpt_image_2(api_key: str, model: str, prompt: str,
                     ref_path: Path, size: str, quality: str,
                     canny_path: Path = None, depth_path: Path = None,
                     extra_refs: list = None, moderation: str = "auto",
                     output_compression: int = None,
                     retries: int = 2, timeout: int = 600) -> bytes:
    """
    Order in which images are sent to the API (matches the master prompt's
    [INPUT IMAGES — N REFERENCES] block):
      IMAGE 1 = ref_path (the photographic source)
      IMAGE 2 = canny_path  (if provided)
      IMAGE 3 = depth_path  (if provided)
      IMAGE 4..N = extra_refs in declared order (face, wardrobe flat-lays,
                   location refs, object refs — whatever the caller passed)

    All images are sent with field name `image[]` so OpenAI treats them as a
    multi-image edit array. Order is significant — the prompt must label each
    image by index in the same order.
    """
    image_paths = [ref_path]
    if canny_path is not None:
        image_paths.append(canny_path)
    if depth_path is not None:
        image_paths.append(depth_path)
    image_paths.extend(extra_refs or [])

    files = []
    for p in image_paths:
        files.append(("image[]", p.name, detect_mime(p), p.read_bytes()))

    fields = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "moderation": moderation,
        "n": "1",
    }
    if output_compression is not None:
        fields["output_compression"] = str(output_compression)

    body, content_type = build_multipart(fields, files)

    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                API_URL, data=body,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": content_type,
                    "Content-Length": str(len(body)),
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            data_arr = payload.get("data") or []
            if not data_arr:
                raise RuntimeError(f"No image in response: {json.dumps(payload)[:500]}")
            b64 = data_arr[0].get("b64_json")
            if not b64:
                raise RuntimeError(f"No b64_json in response[0]: {json.dumps(data_arr[0])[:500]}")
            return base64.b64decode(b64)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            last_err = f"HTTP {e.code}: {err_body[:1200]}"
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 ** attempt * 3)
                continue
            raise RuntimeError(last_err) from e
        except urllib.error.URLError as e:
            last_err = f"URL error: {e.reason}"
            if attempt < retries:
                time.sleep(2 ** attempt * 3)
                continue
            raise RuntimeError(last_err) from e
    raise RuntimeError(last_err or "Unknown failure")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Reference image path")
    ap.add_argument("--prompt-file", required=True, help="Master prompt .txt")
    ap.add_argument("--output", required=True, help="Output PNG path")
    ap.add_argument("--draft-from", default=None,
                    help="Optional path to a structurally-locked draft image (e.g. from a "
                         "ComfyUI/Flux/ControlNet pre-pass). When set, this image becomes "
                         "IMAGE 1 (the framing/composition/pose reference) for gpt-image-2, "
                         "and --input is added as the FINAL --ref entry instead.")
    ap.add_argument("--canny", default=None,
                    help="Optional: path to MINIMAL Canny edge map. Sent as IMAGE 2.")
    ap.add_argument("--depth", default=None,
                    help="Optional: path to MINIMAL depth map. Sent as IMAGE 3.")
    ap.add_argument("--ref", action="append", default=[],
                    help="Optional additional reference image. Repeatable. Each --ref is "
                         "appended in declaration order AFTER source/canny/depth. Use for "
                         "face, wardrobe flat-lays, location refs, object refs.")
    ap.add_argument("--size", default=None,
                    help=f"Output size. Pick from menu: {sorted(ALLOWED_SIZES)}. "
                         "Default: closest-match to input dimensions.")
    ap.add_argument("--quality", default="high",
                    choices=["low", "medium", "high", "auto"],
                    help="Output quality (default: high — editorial-grade).")
    ap.add_argument("--moderation", default="auto",
                    choices=["auto", "low"],
                    help="Moderation strictness (default: auto).")
    ap.add_argument("--output-compression", type=int, default=None,
                    help="Output compression 0-100 (for JPEG/WebP outputs).")
    ap.add_argument("--model", default=os.environ.get("OPENAI_IMAGE_MODEL", DEFAULT_MODEL))
    ap.add_argument("--preserve-dims", action="store_true",
                    help="Resize output to exactly match input pixel dimensions")
    args = ap.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: OPENAI_API_KEY not set. export OPENAI_API_KEY=sk-... "
              "(get one at https://platform.openai.com/api-keys)", file=sys.stderr)
        sys.exit(2)

    ref = Path(args.input).expanduser().resolve()
    if not ref.is_file():
        print(f"ERROR: input not found: {ref}", file=sys.stderr)
        sys.exit(2)

    prompt_path = Path(args.prompt_file).expanduser().resolve()
    if not prompt_path.is_file():
        print(f"ERROR: prompt file not found: {prompt_path}", file=sys.stderr)
        sys.exit(2)
    prompt = prompt_path.read_text(encoding="utf-8").strip()
    if not prompt:
        print("ERROR: prompt file is empty", file=sys.stderr)
        sys.exit(2)

    canny_path = None
    if args.canny:
        canny_path = Path(args.canny).expanduser().resolve()
        if not canny_path.is_file():
            print(f"ERROR: canny file not found: {canny_path}", file=sys.stderr)
            sys.exit(2)

    depth_path = None
    if args.depth:
        depth_path = Path(args.depth).expanduser().resolve()
        if not depth_path.is_file():
            print(f"ERROR: depth file not found: {depth_path}", file=sys.stderr)
            sys.exit(2)

    extra_refs = []
    for ref_arg in args.ref:
        rp = Path(ref_arg).expanduser().resolve()
        if not rp.is_file():
            print(f"ERROR: --ref file not found: {rp}", file=sys.stderr)
            sys.exit(2)
        extra_refs.append(rp)

    if args.draft_from:
        draft_path = Path(args.draft_from).expanduser().resolve()
        if not draft_path.is_file():
            print(f"ERROR: --draft-from file not found: {draft_path}", file=sys.stderr)
            sys.exit(2)
        with Image.open(draft_path) as im:
            in_w, in_h = im.size
        extra_refs.append(ref)
        ref = draft_path
    else:
        with Image.open(ref) as im:
            in_w, in_h = im.size

    size = args.size or closest_size(in_w, in_h)
    if size not in ALLOWED_SIZES:
        print(f"ERROR: --size {size!r} not in allowed menu {sorted(ALLOWED_SIZES)}",
              file=sys.stderr)
        sys.exit(2)

    print(f"[generate] model={args.model}  input={ref.name}  "
          f"input_size={in_w}x{in_h}  output_size={size}  quality={args.quality}"
          f"{'  canny=' + canny_path.name if canny_path else ''}"
          f"{'  depth=' + depth_path.name if depth_path else ''}"
          f"{'  refs=' + str(len(extra_refs)) if extra_refs else ''}",
          file=sys.stderr)

    out_bytes = call_gpt_image_2(
        api_key, args.model, prompt, ref, size, args.quality,
        canny_path=canny_path, depth_path=depth_path,
        extra_refs=extra_refs, moderation=args.moderation,
        output_compression=args.output_compression,
    )

    out_path = Path(args.output).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if args.preserve_dims:
        gen = Image.open(io.BytesIO(out_bytes)).convert("RGB")
        if gen.size != (in_w, in_h):
            gen = gen.resize((in_w, in_h), Image.LANCZOS)
        gen.save(out_path, format="PNG")
    else:
        out_path.write_bytes(out_bytes)

    print(json.dumps({
        "ok": True,
        "output": str(out_path),
        "input_size": [in_w, in_h],
        "output_size": size,
        "quality": args.quality,
        "model": args.model,
    }))


if __name__ == "__main__":
    main()
