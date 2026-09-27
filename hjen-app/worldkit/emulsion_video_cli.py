#!/usr/bin/env python3
"""
Emulsion for VIDEO — applies the same look pipeline as the stills path to every
frame of a (generated) clip, then re-encodes with the original audio.

Temporal consistency:
  - scene-adaptive factors (night/warm) are computed ONCE for the whole clip
    (sampled frames) so the grade never flickers.
  - grain uses a DIFFERENT seed per frame (real film grain is independent per
    frame; the coherence comes from tasteful amplitude, not from freezing it).
Depth-DoF is intentionally NOT applied to video (per-frame metric depth flickers).

Usage: emulsion_video_cli.py <in.mp4> <out.mp4> --body= --lens= --stock=
       --intensity= --scan= --preset= --dtype= --damount= [--maxw=1920] [--crf=18]
Prints [vid] progress <i>/<N> and [vid] done <out>.
"""
import sys, os, subprocess, tempfile, shutil, glob, json
import numpy as np
from PIL import Image, ImageFilter
sys.path.insert(0, "/Users/befilmz/Downloads/HJEN BRAND/02_PRODUCT/dna_corpus/calibration")
from emulsion_py import render, analyze, _smooth, MANUAL

# ---- optional Scene Protect (skin/sky), same treatment as the stills path ----
def _blurf(a, r):
    return np.asarray(Image.fromarray((np.clip(a,0,1)*255).astype('uint8')).filter(ImageFilter.GaussianBlur(r)), np.float32)/255.0

def seg_protect(emul, base, skin_m, sky_m, skin_s, sky_s):
    e = emul.astype(np.float32)/255; b = base.astype(np.float32)/255; out = e.copy()
    if skin_s > 0 and skin_m is not None:
        m = (_blurf(skin_m, 2) * skin_s)[..., None]
        e_lo = _blurf(e, 2); b_lo = _blurf(b, 2)
        out = out*(1-m) + (e_lo + (b - b_lo))*m          # graded tone + original texture, de-grained
    if sky_s > 0 and sky_m is not None:
        m = (_blurf(sky_m, 2) * sky_s)[..., None]
        out = out*(1-m) + _blurf(out, 2)*m               # de-grain sky
    return (np.clip(out,0,1)*255).astype('uint8')

def _ff(name):
    for c in (os.path.expanduser(f'~/.local/bin/{name}'), f'/opt/homebrew/bin/{name}', f'/usr/local/bin/{name}', name):
        if shutil.which(c) or os.path.exists(c): return c
    return name
FFMPEG, FFPROBE = _ff('ffmpeg'), _ff('ffprobe')

def probe(path):
    """Source fps/audio/codec/pix_fmt/color/bitrate via ffmpeg -i stderr (ffprobe absent).
    Used to MATCH the source on re-encode so quality is preserved."""
    import re
    info = dict(fps=24.0, has_audio=False, codec='h264', pix_fmt='yuv420p',
                color=None, bitrate=None)
    try:
        err = subprocess.run([FFMPEG, '-hide_banner', '-i', path], capture_output=True, text=True).stderr
        m = re.search(r'([0-9.]+)\s*fps', err);            info['fps'] = float(m.group(1)) if m else 24.0
        info['has_audio'] = ' Audio:' in err
        vline = next((l for l in err.splitlines() if 'Video:' in l), '')
        cm = re.search(r'Video:\s*([a-z0-9]+)', vline);     info['codec'] = cm.group(1) if cm else 'h264'
        pm = re.search(r'(yuv[0-9a-z]+|gbrp[0-9a-z]*)', vline); info['pix_fmt'] = pm.group(1) if pm else 'yuv420p'
        clm = re.search(r'(bt709|bt2020[a-z]*|smpte[0-9]+|bt470[a-z0-9]*)', vline); info['color'] = clm.group(1) if clm else None
        bm = re.search(r'bitrate:\s*([0-9]+)\s*kb/s', err); info['bitrate'] = int(bm.group(1)) if bm else None
    except Exception:
        pass
    return info

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    o = {a[2:].split('=')[0]: a.split('=',1)[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
    inp, outp = args[0], args[1]
    maxw = int(o['maxw']) if o.get('maxw') else None       # None = process at NATIVE resolution (preserve)
    skin_s = float(o.get('skin', 0.0)); sky_s = float(o.get('sky', 0.0))
    seg_fn = None
    if skin_s > 0 or sky_s > 0:
        from segment_cli import segment, GROUPS
        def seg_fn(im_pil):
            masks = segment(im_pil, 640)
            def grab(labels):
                acc = None
                for lb in labels:
                    for k, v in masks.items():
                        if lb in k.lower(): acc = v if acc is None else (acc | v)
                return acc.astype(np.float32) if acc is not None else None
            return grab(GROUPS['skin']), grab(GROUPS['sky'])
    cam = dict(body=o.get('body','alexa_mini_lf'), lens=o.get('lens','cooke_s4'),
               stock=o.get('stock','vision3_250d'), intensity=float(o.get('intensity',1.0)),
               scan=o.get('scan','2K'), preset=o.get('preset','auto'),
               dtype=o.get('dtype','none'), damount=float(o.get('damount',0.0)))
    pv = probe(inp); fps, has_audio = pv['fps'], pv['has_audio']
    tmp = tempfile.mkdtemp(prefix='emuvid_')
    fdir = os.path.join(tmp, 'in'); odir = os.path.join(tmp, 'out')
    os.makedirs(fdir); os.makedirs(odir)
    print(f'[vid] extracting frames (fps={fps:.2f}, audio={has_audio})', flush=True)
    subprocess.run([FFMPEG, '-y', '-v', 'error', '-i', inp, '-vsync', '0',
                    os.path.join(fdir, '%06d.png')], check=True)
    frames = sorted(glob.glob(os.path.join(fdir, '*.png')))
    N = len(frames)
    if N == 0: print('[vid] no frames extracted', flush=True); sys.exit(1)

    # clip-level scene factors — analyse a handful of frames, average (no flicker)
    if cam['preset'] in MANUAL:
        night, warm = MANUAL[cam['preset']]
    else:
        ns, ws = [], []
        for f in frames[::max(1, N//6)][:6]:
            a = np.asarray(Image.open(f).convert('RGB'))
            key, wm = analyze(a)
            ns.append(1 - _smooth(0.12, 0.34, key)); ws.append(_smooth(1.05, 1.45, wm))
        night, warm = float(np.mean(ns)), float(np.mean(ws))
    print(f'[vid] clip scene: night={night:.2f} warm={warm:.2f}  ({N} frames)', flush=True)

    for i, f in enumerate(frames):
        im = Image.open(f).convert('RGB')
        # NATIVE resolution by default (preserve source quality); only downscale if an
        # explicit maxw was passed. Crop to EVEN dims (yuv420p requirement).
        tw = min(im.width, maxw) if maxw else im.width
        th = round(im.height * tw / im.width)
        tw -= tw % 2; th -= th % 2
        if (tw, th) != im.size:
            im = im.resize((tw, th), Image.LANCZOS) if maxw else im.crop((0, 0, tw, th))
        a = np.asarray(im)
        out = render(a, body=cam['body'], lens=cam['lens'], stock=cam['stock'],
                     intensity=cam['intensity'], scan=cam['scan'], preset=cam['preset'],
                     seed=i+1, night=night, warm=warm, dtype=cam['dtype'], damount=cam['damount'])
        if seg_fn is not None:
            skin_m, sky_m = seg_fn(im)
            out = seg_protect(out, a, skin_m, sky_m, skin_s, sky_s)
        Image.fromarray(out).save(os.path.join(odir, os.path.basename(f)))
        if (i+1) % 5 == 0 or i+1 == N:
            print(f'[vid] progress {i+1}/{N}', flush=True)

    # re-encode to MATCH the source: same codec + resolution, near-transparent quality,
    # preserved colour, and the original audio copied bit-for-bit. The point of the tool
    # is the look — never lose the clip's quality.
    is_hevc = pv['codec'] in ('hevc', 'h265')
    vcodec = 'libx265' if is_hevc else 'libx264'
    crf = o.get('crf', '17' if is_hevc else '15')          # visually ~transparent
    pix = pv['pix_fmt'] if pv['pix_fmt'] in ('yuv420p', 'yuv422p', 'yuv444p', 'yuv420p10le') else 'yuv420p'
    cmd = [FFMPEG, '-y', '-v', 'error', '-framerate', f'{fps}', '-i', os.path.join(odir, '%06d.png')]
    if has_audio:
        cmd += ['-i', inp, '-map', '0:v', '-map', '1:a', '-c:a', 'copy', '-shortest']  # audio bit-for-bit
    cmd += ['-c:v', vcodec, '-preset', 'slow', '-crf', str(crf), '-pix_fmt', pix]
    if pv['color']:
        cmd += ['-color_primaries', pv['color'], '-color_trc', pv['color'], '-colorspace', pv['color']]
    if is_hevc: cmd += ['-tag:v', 'hvc1']                  # QuickTime-playable HEVC
    cmd += [outp]
    print(f'[vid] encoding {vcodec} crf{crf} {pix} (matching source {pv["codec"]})', flush=True)
    subprocess.run(cmd, check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'[vid] done {outp}', flush=True)

if __name__ == '__main__':
    main()
