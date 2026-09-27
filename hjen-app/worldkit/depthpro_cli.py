#!/usr/bin/env python3
"""
Apple Depth Pro — METRIC monocular depth (meters), sharp boundaries, MPS/offline.
The accurate depth stage for Emulsion DoF: true per-element distance + crisp edges
(Sintel F1 0.409, best-in-class). Replaces the relative Depth-Anything-Small path
when accuracy matters. First run downloads ~1.9GB weights; ~6-8s/image on MPS.

Output: <stem>_depth8.png  — depth normalised 0..255 (0 = nearest, 255 = farthest)
        <stem>_depth_meta.json — { "min_m": <nearest metres>, "max_m": <farthest> }
so the browser can reconstruct metric metres per pixel for a thin-lens CoC render.

Usage: depthpro_cli.py <out_dir> <image> [--size=1400]
Prints [depthpro] range <min_m> <max_m> and [depthpro] done <depth8_path>.
"""
import sys, os, time, json, warnings
warnings.filterwarnings("ignore")
import numpy as np
from PIL import Image

_PP = None
def metric_depth(im):
    global _PP
    import torch
    from transformers import pipeline
    if _PP is None:
        dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
        _PP = pipeline('depth-estimation', model='apple/DepthPro-hf', device=dev)
        print(f'[depthpro] model ready on {dev}', flush=True)
    pred = _PP(im)['predicted_depth']
    d = pred.detach().float().cpu().numpy()
    if d.ndim == 3: d = d[0]
    return np.asarray(Image.fromarray(d).resize(im.size, Image.BILINEAR), np.float32)   # metres

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = {a[2:].split('=')[0]: a.split('=',1)[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
    out_dir, img_path = args[0], args[1]
    size = int(opts.get('size', 1400))
    os.makedirs(out_dir, exist_ok=True)
    im = Image.open(img_path).convert('RGB')
    if max(im.size) > size:
        r = size/max(im.size); im = im.resize((round(im.width*r), round(im.height*r)), Image.LANCZOS)
    t = time.time()
    dm = metric_depth(im)
    # robust range (ignore outliers) so the 8-bit quantisation spans the real scene
    lo, hi = float(np.percentile(dm, 0.5)), float(np.percentile(dm, 99.5))
    dm = np.clip(dm, lo, hi)
    norm = (dm - lo) / max(hi - lo, 1e-6)                    # 0 = nearest, 1 = farthest
    stem = os.path.splitext(os.path.basename(img_path))[0]
    depth8 = os.path.join(out_dir, f'{stem}_depth8.png')
    Image.fromarray((norm*255).astype('uint8')).save(depth8)
    json.dump({'min_m': lo, 'max_m': hi}, open(os.path.join(out_dir, f'{stem}_depth_meta.json'), 'w'))
    print(f'[depthpro] range {lo:.3f} {hi:.3f} in {time.time()-t:.1f}s', flush=True)
    print(f'[depthpro] done {depth8}', flush=True)

if __name__ == '__main__':
    main()
