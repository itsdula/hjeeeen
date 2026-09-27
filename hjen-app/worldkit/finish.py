#!/usr/bin/env python3
"""HJEN SET — Angle Pack finish. Takes a captured plate (a new-angle render from
the world viewer) and locks it onto gpt-image-2 in the Clay & Basil DNA:

  plate.png ── make_canny ──► canny.png   (structure / angle lock)
            ── depth (DA-V2) ─► depth.png  (near→far volume)
  plate + canny + depth + DNA prompt ── gpt-image-2 ──► locked.png

All three helpers live beside this file (make_canny.py, depth_cli.py,
generate.py, hjen_finish_prompt.txt). Needs OPENAI_API_KEY in the env.
Prints one JSON line: {"ok":true,"locked":"<abs path>"} or {"ok":false,...}.

Usage: finish.py --plate <png> --out <dir> [--quality high]
"""
import argparse, json, os, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(cmd):
    r = subprocess.run(cmd, cwd=str(HERE), capture_output=True, text=True)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plate', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--quality', default='high', choices=['low', 'medium', 'high', 'auto'])
    a = ap.parse_args()

    plate = Path(a.plate).expanduser().resolve()
    out = Path(a.out).expanduser().resolve(); out.mkdir(parents=True, exist_ok=True)
    if not plate.is_file():
        print(json.dumps({'ok': False, 'error': f'plate not found: {plate}'})); return
    if not os.environ.get('OPENAI_API_KEY'):
        print(json.dumps({'ok': False, 'error': 'OPENAI_API_KEY not set'})); return

    py = sys.executable
    stem = plate.stem
    canny = out / f'{stem}_canny.png'
    depth = out / f'{stem}_depth8.png'
    depthS = out / f'{stem}_depthS.png'
    locked = out / f'{stem}_locked.png'

    # 1) canny (structure / tight angle lock) — PIL only, instant
    rc, log = run([py, str(HERE / 'make_canny.py'), '--input', str(plate), '--output', str(canny),
                   '--blur', '2', '--posterize-bits', '3'])
    if rc != 0:
        print(json.dumps({'ok': False, 'error': 'canny failed', 'log': log[-500:]})); return

    # 2) depth of the plate (DA-V2-Small on MPS) + stylise to the 8-band volume sketch
    rc, log = run([py, str(HERE / 'depth_cli.py'), str(out), str(plate), '--size=1536'])
    have_depth = rc == 0 and depth.exists()
    if have_depth:
        try:
            from PIL import Image, ImageFilter, ImageOps
            d = Image.open(depth).convert('L').filter(ImageFilter.GaussianBlur(5))
            ImageOps.posterize(d, 3).save(depthS)
        except Exception:
            have_depth = False

    # 3) gpt-image-2 finish, angle held
    gen = [py, str(HERE / 'generate.py'), '--input', str(plate),
           '--prompt-file', str(HERE / 'hjen_finish_prompt.txt'),
           '--output', str(locked), '--canny', str(canny),
           '--quality', a.quality, '--preserve-dims']
    if have_depth:
        gen += ['--depth', str(depthS)]
    rc, log = run(gen)
    if rc != 0 or not locked.exists():
        # surface the OpenAI error message if present, else a log tail
        msg = 'gpt-image-2 finish failed'
        m = re.search(r'"message":\s*"([^"]+)"', log)
        if m:
            msg = m.group(1)
        elif 'billing_hard_limit' in log:
            msg = 'Billing hard limit has been reached'
        print(json.dumps({'ok': False, 'error': msg, 'log': log[-400:]})); return

    print(json.dumps({'ok': True, 'locked': str(locked), 'canny': str(canny),
                      'depth': str(depthS) if have_depth else None}))


if __name__ == '__main__':
    main()
