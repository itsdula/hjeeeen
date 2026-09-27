#!/usr/bin/env python3
"""
Emulsion segmentation (scene-aware Level 2b). Local Segformer ADE20k (transformers,
MPS, offline) → feathered masks the app uses for targeted treatment:
  skin  = protect faces/people from the grade+grain (keep texture, kill grain)
  sky   = treat the sky separately (bloom, de-grain)
  plant = optional vegetation targeting
Writes <stem>_seg_skin.png / _seg_sky.png / _seg_plant.png (grayscale masks).

Usage: segment_cli.py <out_dir> <image> [--size=768]
Prints [seg] done <out_dir>.
"""
import sys, os, time, warnings
warnings.filterwarnings("ignore")
import numpy as np
from PIL import Image, ImageFilter

GROUPS = {'skin': ['person', 'skin'], 'sky': ['sky'], 'plant': ['tree', 'grass', 'plant', 'palm']}

_PIPE = None
def segment(im, size):
    global _PIPE
    import torch
    from transformers import pipeline
    if _PIPE is None:
        dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
        _PIPE = pipeline('image-segmentation', model='nvidia/segformer-b0-finetuned-ade-512-512', device=dev)
        print(f'[seg] model ready on {dev}', flush=True)
    work = im
    if max(im.size) > size:
        r = size/max(im.size); work = im.resize((round(im.width*r), round(im.height*r)), Image.LANCZOS)
    masks = {}
    for r in _PIPE(work):
        m = np.asarray(r['mask'].resize(im.size, Image.NEAREST)) > 127
        masks[r['label']] = masks.get(r['label'], np.zeros_like(m)) | m
    return masks

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = {a[2:].split('=')[0]: a.split('=',1)[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
    out_dir, img_path = args[0], args[1]
    size = int(opts.get('size', 768))
    os.makedirs(out_dir, exist_ok=True)
    im = Image.open(img_path).convert('RGB')
    if im.width > 1400: im = im.resize((1400, round(im.height*1400/im.width)), Image.LANCZOS)
    t = time.time()
    masks = segment(im, size)
    shape = next(iter(masks.values())).shape if masks else (im.height, im.width)
    stem = os.path.splitext(os.path.basename(img_path))[0]
    feather = max(2, int(0.003 * (shape[0]**2 + shape[1]**2)**0.5))
    for g, labels in GROUPS.items():
        acc = np.zeros(shape, bool)
        for lb in labels:
            for k, v in masks.items():
                if lb in k.lower(): acc |= v
        m = np.asarray(Image.fromarray((acc*255).astype('uint8')).filter(ImageFilter.GaussianBlur(feather)))
        Image.fromarray(m).save(os.path.join(out_dir, f'{stem}_seg_{g}.png'))
    print(f'[seg] {len(masks)} labels in {time.time()-t:.1f}s', flush=True)
    print(f'[seg] done {out_dir}', flush=True)

if __name__ == '__main__':
    main()
