#!/usr/bin/env python3
"""
Emulsion depth-aware defocus (scene-aware Level 2). Runs Depth-Anything-V2-Small
(same model as depth_cli.py — MPS, offline, no middlemen), then applies physically
varying lens blur: sharp at the focus plane, progressively defocused fore/background,
with optional distance haze. This is the DoF that pure 2D post can't fake.

Usage: defocus_cli.py <out_dir> <image> [--focus=auto|0..1] [--aperture=1.6]
                      [--haze=0.10] [--maxradius=0] [--size=1400]
Writes <stem>_defocus.png (the result) + <stem>_depth8.png (preview).
Prints [defocus] done <path> on success.
"""
import sys, os, time
import numpy as np
from PIL import Image, ImageFilter

_PIPE = None
def get_depth(im, size=1024):
    global _PIPE
    import torch
    from transformers import pipeline
    if _PIPE is None:
        dev = 'mps' if torch.backends.mps.is_available() else 'cpu'
        _PIPE = pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=dev)
        print(f'[defocus] model ready on {dev}', flush=True)
    work = im
    if max(im.size) > size:
        r = size / max(im.size); work = im.resize((round(im.width*r), round(im.height*r)), Image.LANCZOS)
    pred = _PIPE(work)['predicted_depth']
    if pred.dim() == 3: pred = pred[0]
    d = pred.float().cpu().numpy()
    d = (d - d.min()) / max(1e-9, d.max() - d.min())          # 1 = near, 0 = far
    return np.asarray(Image.fromarray((d*255).astype('uint8')).resize(im.size, Image.BILINEAR), np.float32)/255.0

def _blur(arr, r):
    if r < 0.5: return arr.copy()
    return np.asarray(Image.fromarray((np.clip(arr,0,1)*255).astype('uint8')).filter(ImageFilter.GaussianBlur(r)), np.float32)/255.0

def guided_matte(depth, rgb, r=None, eps=8e-4):
    """Edge-aware refine: snap depth edges to the RGB image so the DoF matte
    follows the real subject outline (He et al. guided filter, gaussian mean)."""
    h, w = depth.shape
    if r is None: r = max(4, int(0.006 * (h*h+w*w)**0.5))
    I = rgb[..., 0]*0.2126 + rgb[..., 1]*0.7152 + rgb[..., 2]*0.0722
    mI, mp = _blur(I, r), _blur(depth, r)
    mIp, mII = _blur(I*depth, r), _blur(I*I, r)
    a = (mIp - mI*mp) / (mII - mI*mI + eps)
    b = mp - a*mI
    return np.clip(_blur(a, r)*I + _blur(b, r), 0, 1)

def defocus(rgb, depth, focus=None, aperture=1.6, max_radius=None, haze=0.10):
    h, w = depth.shape
    if max_radius is None or max_radius <= 0: max_radius = 0.018 * (h*h+w*w)**0.5
    if focus is None: focus = float(np.percentile(depth, 72))
    coc = np.abs(depth - focus) * aperture
    coc = np.clip(coc / max(coc.max(), 1e-6), 0, 1) * max_radius
    radii = np.array([0.0, max_radius*0.18, max_radius*0.40, max_radius*0.68, max_radius])
    stack = [rgb if r == 0 else _blur(rgb, r) for r in radii]
    out = np.zeros_like(rgb)
    for i in range(len(radii)-1):
        lo, hi = radii[i], radii[i+1]
        m = (coc >= lo) & (coc <= hi + 1e-6)
        if m.any():
            t = ((coc[m]-lo)/max(hi-lo,1e-6))[:, None]
            out[m] = stack[i][m]*(1-t) + stack[i+1][m]*t
    out[coc > radii[-1]] = stack[-1][coc > radii[-1]]
    if haze > 0:
        far = np.clip((focus - depth) / max(focus, 1e-6), 0, 1)[..., None]
        L = (out*np.array([0.2126,0.7152,0.0722])).sum(2, keepdims=True)
        out = out*(1-haze*far) + (L*0.5 + np.array([0.62,0.66,0.72])*0.5)*(haze*far)
    return np.clip(out, 0, 1), focus

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = {a[2:].split('=')[0]: a.split('=',1)[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
    out_dir, img_path = args[0], args[1]
    os.makedirs(out_dir, exist_ok=True)
    focus = None if opts.get('focus','auto') == 'auto' else float(opts['focus'])
    aperture = float(opts.get('aperture', 1.6)); haze = float(opts.get('haze', 0.10))
    max_radius = float(opts.get('maxradius', 0)); size = int(opts.get('size', 1400))

    depth_only = opts.get('depthonly', '0') == '1'
    im = Image.open(img_path).convert('RGB')
    if max(im.size) > size:
        r = size/max(im.size); im = im.resize((round(im.width*r), round(im.height*r)), Image.LANCZOS)
    rgb = np.asarray(im, np.float32)/255.0
    t = time.time(); depth = get_depth(im)
    depth = guided_matte(depth, rgb)                         # edge-aware matte (subject outline)
    stem = os.path.splitext(os.path.basename(img_path))[0]
    depth8 = os.path.join(out_dir, f'{stem}_depth8.png')
    Image.fromarray((depth*255).astype('uint8')).save(depth8)
    if depth_only:
        # depth map only — the browser/worker does the live defocus (focus/aperture/haze + click)
        print(f'[defocus] depth@matte in {time.time()-t:.1f}s', flush=True)
        print(f'[defocus] done {depth8}', flush=True)
        return
    out, foc = defocus(rgb, depth, focus, aperture, max_radius, haze)
    outp = os.path.join(out_dir, f'{stem}_defocus.png')
    Image.fromarray((out*255).astype('uint8')).save(outp)
    print(f'[defocus] focus@{foc:.2f} aperture={aperture} in {time.time()-t:.1f}s', flush=True)
    print(f'[defocus] done {outp}', flush=True)

if __name__ == '__main__':
    import warnings; warnings.filterwarnings("ignore")
    main()
