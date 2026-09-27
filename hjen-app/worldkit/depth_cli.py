#!/usr/bin/env python3
"""Phase-0 depth engine: Depth-Anything-V2-Small (Apache) on MPS.
Usage: depth_cli.py out_dir img1 [img2 ...] [--repeat N] [--size 1536]
Saves <stem>_depth16.png (16-bit raw) + <stem>_depth8.png (preview).
Prints per-call timings (cold vs warm) for experiment 0g."""
import sys, time, os
from PIL import Image

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = {a.split('=')[0]: a.split('=')[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
    out_dir, imgs = args[0], args[1:]
    repeat = int(opts.get('--repeat', 1))
    size = int(opts.get('--size', 1536))
    os.makedirs(out_dir, exist_ok=True)

    t0 = time.time()
    import torch
    from transformers import pipeline
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    pipe = pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=device)
    print(f'[load] model ready in {time.time()-t0:.1f}s on {device}', flush=True)

    for img_path in imgs:
        im = Image.open(img_path).convert('RGB')
        if max(im.size) > size:
            r = size / max(im.size)
            im = im.resize((round(im.width*r), round(im.height*r)), Image.LANCZOS)
        stem = os.path.splitext(os.path.basename(img_path))[0]
        for k in range(repeat):
            t = time.time()
            out = pipe(im)
            dt = time.time() - t
            print(f'[depth] {stem} call {k+1}/{repeat}: {dt:.2f}s @ {im.size}', flush=True)
        pred = out['predicted_depth']
        if pred.dim() == 3: pred = pred[0]
        d = pred.float().cpu().numpy()
        d = (d - d.min()) / max(1e-9, (d.max() - d.min()))  # 1 = near for DA (disparity-like)
        import numpy as np
        d16 = (d * 65535).astype('uint16')
        Image.fromarray(d16, mode='I;16').resize(im.size, Image.BILINEAR).save(os.path.join(out_dir, f'{stem}_depth16.png'))
        Image.fromarray((d * 255).astype('uint8')).resize(im.size, Image.BILINEAR).save(os.path.join(out_dir, f'{stem}_depth8.png'))
        im.save(os.path.join(out_dir, f'{stem}_rgb.png'))
        print(f'[save] {stem}: depth16/depth8/rgb -> {out_dir}', flush=True)

if __name__ == '__main__':
    main()
