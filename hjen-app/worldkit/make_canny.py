#!/usr/bin/env python3
"""
Generate a MINIMAL silhouette+perspective edge map from a source image.

CRITICAL DESIGN PRINCIPLE — this is NOT a tight Canny like ControlNet uses.

A standard tight Canny captures every edge: face features, fabric weave,
painting details, hair strands. When that map is passed to gpt-image-2
as a structural template, the model freezes the SOURCE's identity and
texture into the output — defeating the entire purpose of the
saudi-art-translator skill, which exists to REPLACE the cultural skin
(face, wardrobe, environment) while preserving only composition.

This script intentionally produces a MINIMAL edge map by:
  1. Heavy Gaussian blur (~6 px) to destroy face features, fabric texture,
     and small painting details before any edge detection runs.
  2. Posterizing the blurred image to 4 tone levels — this flattens the
     scene into broad regions and makes only major silhouettes survive.
  3. Edge-detecting the posterized image — the only edges that survive
     are the silhouette of the subject (body + head outline) and the
     gross perspective lines of the architecture (wall-floor, window
     frame, ceiling line).
  4. Converting the result to PURE BINARY B&W (no grays, no anti-aliasing
     halftones) by hard-thresholding to 1-bit. This produces a clean
     stencil that the model treats as a structural skeleton, not as a
     pixel-tight texture lock.

SUBJECT-ONLY mode (--mask):
  When --mask <depth_or_mask_path> is supplied, the canny output is
  multiplied by a binary mask derived from the supplied image. This is
  the RECOMMENDED mode for cultural-translation work where the
  background pattern needs to be FREE for the model to redesign.
  Without --mask, the canny preserves the SOURCE's wall-pattern edges,
  which forces the output to fill the source's wall outlines with a
  Saudi-tinted version of the source's pattern — a cultural-skin
  half-translation. With --mask, only the subject silhouette
  (face + head + hand + drape outline) survives, and the background
  is left blank for the model to design from prompt + location refs.

PIL-only — no OpenCV, no numpy.
"""

import argparse
from pathlib import Path
from PIL import Image, ImageFilter, ImageOps, ImageChops


def _build_subject_mask(
    mask_path: Path,
    target_size: tuple,
    mask_threshold: int,
    mask_dilate: int,
) -> Image.Image:
    """
    Build a binary subject mask from a grayscale image (typically the depth
    map). Pixels brighter than mask_threshold become 'subject region' (255);
    pixels darker become 'background' (0). The mask is then dilated outward
    by mask_dilate pixels so the subject's outer silhouette is captured (the
    canny edge tends to sit just outside the depth boundary).
    """
    mask = Image.open(mask_path).convert("L")
    if mask.size != target_size:
        mask = mask.resize(target_size, Image.LANCZOS)
    # Hard threshold: depth > mask_threshold = subject; else = background.
    mask = mask.point(lambda p: 255 if p > mask_threshold else 0)
    # Dilate the binary mask so the silhouette edges are inside the mask.
    if mask_dilate > 0:
        # MaxFilter requires an odd kernel size; round up to nearest odd.
        kernel = mask_dilate * 2 + 1
        mask = mask.filter(ImageFilter.MaxFilter(size=kernel))
        mask = mask.point(lambda p: 255 if p > 127 else 0)
    return mask


def make_minimal_canny(
    in_path: Path,
    out_path: Path,
    blur_radius: float = 6.0,
    posterize_bits: int = 2,
    threshold: int = 60,
    dilate: int = 0,
    invert: bool = False,
    mask_path: Path = None,
    mask_threshold: int = 100,
    mask_dilate: int = 8,
) -> None:
    """
    blur_radius: heavy blur kills fine detail (face, fabric, paintings).
                 6.0 is the default for 2000×2500-class images. Increase
                 (8–12) for sources with strong texture / busy backgrounds.
    posterize_bits: 2 = 4 tone levels (best for silhouette extraction).
                    1 = 2 tone levels (extremely minimal — body shape only).
                    3 = 8 tone levels (more architectural lines retained).
    threshold: hard binary cut-off on the edge map. Higher = fewer edges.
    dilate: optional thickening of edges (1, 3, 5 — odd numbers).
    invert: black edges on white instead of white on black.
    mask_path: optional grayscale mask (typically the depth map) restricting
               output edges to the subject region only. Recommended for
               cultural-translation work. When supplied, only edges falling
               inside the masked region survive — the background plate is
               wiped to black, freeing the model to design wall patterns
               from the prompt and location refs.
    mask_threshold: depth value above which a pixel counts as 'subject region'
                    (default 100; raise for tighter silhouette, lower for
                    wider including drape/foreground props).
    mask_dilate: pixels to dilate the binary mask outward so the silhouette
                 edges sit inside the mask (default 8).
    """
    im = Image.open(in_path).convert("L")
    in_size = im.size

    # Step 1 — heavy blur destroys identity-bearing detail.
    if blur_radius > 0:
        im = im.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    # Step 2 — posterize to broad regions (silhouette generator).
    im = ImageOps.posterize(im, bits=posterize_bits)

    # Step 3 — edges of the posterized regions = only major silhouette
    # boundaries and gross perspective lines.
    edges = im.filter(ImageFilter.FIND_EDGES)

    # Step 4 — pure binary B&W. Threshold then convert to 1-bit and back
    # to L (the API needs an 8-bit grayscale PNG, but the content is 1-bit).
    edges = edges.point(lambda p: 255 if p > threshold else 0)
    edges = edges.convert("1").convert("L")

    # Optional thickening for clearer structural lines.
    if dilate > 0:
        edges = edges.filter(ImageFilter.MaxFilter(size=max(3, dilate | 1)))
        # Re-binarize after dilation (MaxFilter can introduce intermediate values).
        edges = edges.point(lambda p: 255 if p > 127 else 0)

    # Step 5 — subject-only mask: zero out edges in the background region so
    # the model is free to redesign the wall pattern from prompt + location
    # refs without being constrained by the source's painted-wall edges.
    if mask_path is not None:
        subject_mask = _build_subject_mask(
            mask_path, in_size, mask_threshold, mask_dilate,
        )
        # Multiply edges by mask (both 0 or 255) — pixels outside subject = 0.
        edges = ImageChops.multiply(edges, subject_mask)
        edges = edges.point(lambda p: 255 if p > 127 else 0)

    if invert:
        edges = ImageOps.invert(edges)

    if edges.size != in_size:
        edges = edges.resize(in_size, Image.LANCZOS)
        edges = edges.point(lambda p: 255 if p > 127 else 0)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    edges.save(out_path, format="PNG", optimize=True)
    mask_note = (f"  mask={mask_path.name}  mask_threshold={mask_threshold}  "
                 f"mask_dilate={mask_dilate}") if mask_path else ""
    print(f"[canny-minimal] {in_path.name} -> {out_path.name}  "
          f"size={in_size[0]}x{in_size[1]}  blur={blur_radius}  "
          f"posterize_bits={posterize_bits}  threshold={threshold}  "
          f"dilate={dilate}  invert={invert}{mask_note}")


def main():
    ap = argparse.ArgumentParser(description=(
        "Minimal silhouette+perspective edge map for saudi-art-translator. "
        "Pure binary B&W output. Intentionally drops face/texture/painting "
        "detail so the model can REPLACE the cultural skin freely."
    ))
    ap.add_argument("--input", required=True, help="Source image absolute path")
    ap.add_argument("--output", required=True, help="Output PNG absolute path")
    ap.add_argument("--blur", type=float, default=6.0,
                    help="Gaussian blur radius (default 6.0; increase 8–12 for busy sources)")
    ap.add_argument("--posterize-bits", type=int, default=2,
                    help="Posterize bits 1–4 (default 2 = 4 tone levels; lower = more minimal)")
    ap.add_argument("--threshold", type=int, default=60,
                    help="Binary threshold for edges 0–255 (default 60; higher = fewer edges)")
    ap.add_argument("--dilate", type=int, default=0,
                    help="Optional edge dilation kernel size (0=off, 3, 5)")
    ap.add_argument("--invert", action="store_true",
                    help="Output black edges on white background")
    ap.add_argument("--mask", default=None,
                    help="Optional grayscale mask (typically the depth map) — "
                         "edges outside the mask region are zeroed. Use for "
                         "subject-only canny in cultural-translation work so "
                         "the model is FREE to redesign wall patterns from "
                         "the prompt and location refs.")
    ap.add_argument("--mask-threshold", type=int, default=100,
                    help="Mask threshold 0–255: pixels brighter than this in "
                         "the mask image count as 'subject region' (default 100).")
    ap.add_argument("--mask-dilate", type=int, default=8,
                    help="Pixels to dilate the binary subject mask outward "
                         "so silhouette edges sit inside the mask (default 8).")
    args = ap.parse_args()

    in_path = Path(args.input).expanduser().resolve()
    out_path = Path(args.output).expanduser().resolve()
    if not in_path.is_file():
        raise SystemExit(f"ERROR: input not found: {in_path}")

    mask_path = None
    if args.mask:
        mask_path = Path(args.mask).expanduser().resolve()
        if not mask_path.is_file():
            raise SystemExit(f"ERROR: mask not found: {mask_path}")

    make_minimal_canny(
        in_path, out_path,
        blur_radius=args.blur,
        posterize_bits=args.posterize_bits,
        threshold=args.threshold,
        dilate=args.dilate,
        invert=args.invert,
        mask_path=mask_path,
        mask_threshold=args.mask_threshold,
        mask_dilate=args.mask_dilate,
    )


if __name__ == "__main__":
    main()
