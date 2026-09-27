#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# HJEN Film Space — single-image human body recovery (HMR / SMPL).
#
# Replaces the old MediaPipe-keypoints → direction-FK pose engine, which
# structurally discarded global body orientation (a horizontal volleyball dive
# rendered as a STANDING mannequin). This sidecar runs 4D-Humans / HMR2.0
# (github.com/shubham-goel/4D-Humans, MIT code) to recover full SMPL parameters
# from ONE image: root global orientation + per-joint rotations + shape + the
# posed 3D joints. Global orientation and per-joint rotation are first-class
# outputs here, so a horizontal/pitched/rotated body is recovered as such.
#
# ┌── LICENSING ──────────────────────────────────────────────────────────────┐
# │ RESEARCH WEIGHTS — INTERNAL / NDA USE ONLY, pending a commercial license.  │
# │ • HMR2.0 code: MIT (4D-Humans).                                            │
# │ • HMR2.0 checkpoint + config: 4D-Humans research release                   │
# │     (www.cs.utexas.edu/~pavlakos/4dhumans/hmr2_data.tar.gz).               │
# │ • SMPL body model (SMPL_NEUTRAL.pkl): SMPL research license                │
# │     (smpl.is.tue.mpg.de) — downloaded for internal use only.               │
# │ Do NOT ship a commercial build on these weights until licensing clears.    │
# └────────────────────────────────────────────────────────────────────────────┘
#
# Model assets live in ~/.cache/4DHumans (the 4D-Humans default cache):
#   logs/train/multiruns/hmr2/0/checkpoints/epoch=35-step=1000000.ckpt   (~2.5GB)
#   logs/train/multiruns/hmr2/0/model_config.yaml
#   data/smpl/SMPL_NEUTRAL.pkl   ·   data/SMPL_to_J19.pkl   ·   data/smpl_mean_params.npz
# Override the cache with env CACHE_DIR_4DHUMANS's parent ($HOME/.cache). First
# run downloads the bundle; afterwards this runs fully offline. The 4D-Humans
# source tree is vendored at ../STUDY/world_from_image/4D-Humans (see --repo).
#
# detectron2 is deliberately DROPPED (heavy, single-subject user images don't
# need it): the person box comes from a lightweight torchvision detector, with a
# full-frame fallback. pyrender is never imported (we output params, not pixels)
# — the renderer modules are stubbed in sys.modules before the model loads.
#
# Usage:  pose_hmr.py <out_dir> <image_path> [--repo=/path/to/4D-Humans]
# Output: <out_dir>/pose.json  and a "[hmr] done <path>" line on stdout.
# Prints [hmr] progress lines (mirrors depth_cli's stdout contract) + real
# measured load / cold / warm latency on this machine.
# ─────────────────────────────────────────────────────────────────────────────
import sys, os, json, time, types


def log(msg):
    print(f'[hmr] {msg}', flush=True)


def _stub_renderers():
    """hmr2.utils.__init__ imports pyrender-backed renderers at module top,
    hmr2.models.hmr2 imports MeshRenderer/SkeletonRenderer, and
    hmr2.datasets.__init__ imports webdataset (training only). We only want SMPL
    params, never pixels or training data — inject dummy modules so the import
    graph resolves without pyrender / OpenGL / webdataset present."""
    sys.modules.setdefault('webdataset', types.ModuleType('webdataset'))
    for name, attrs in {
        'hmr2.utils.renderer': ['Renderer', 'cam_crop_to_full'],
        'hmr2.utils.mesh_renderer': ['MeshRenderer'],
        'hmr2.utils.skeleton_renderer': ['SkeletonRenderer'],
    }.items():
        m = types.ModuleType(name)
        for a in attrs:
            setattr(m, a, type(a, (), {'__init__': lambda self, *a, **k: None}))
        sys.modules[name] = m


def _rotmat_to_aa(R):
    """3x3 rotation matrix -> axis-angle (3,). Uses cv2.Rodrigues (stable)."""
    import cv2
    import numpy as np
    rvec, _ = cv2.Rodrigues(np.asarray(R, dtype=np.float64))
    return rvec.reshape(3).tolist()


def _person_box(img_bgr, repo_dir):
    """Largest confident person box [x1,y1,x2,y2] via torchvision (CPU). Falls
    back to the full frame. detectron2-free, single-subject friendly."""
    import numpy as np
    H, W = img_bgr.shape[:2]
    full = np.array([0.0, 0.0, float(W), float(H)], dtype=np.float32)
    try:
        import torch
        import torchvision
        from torchvision.models.detection import (
            fasterrcnn_mobilenet_v3_large_fpn,
            FasterRCNN_MobileNet_V3_Large_FPN_Weights as Wt,
        )
        det = fasterrcnn_mobilenet_v3_large_fpn(weights=Wt.DEFAULT)
        det.eval()
        rgb = img_bgr[:, :, ::-1].copy()
        t = torch.from_numpy(rgb).permute(2, 0, 1).float() / 255.0
        with torch.no_grad():
            out = det([t])[0]
        best, best_area = None, 0.0
        for box, label, score in zip(out['boxes'], out['labels'], out['scores']):
            if int(label) != 1 or float(score) < 0.5:   # COCO label 1 == person
                continue
            x1, y1, x2, y2 = [float(v) for v in box.tolist()]
            area = (x2 - x1) * (y2 - y1)
            if area > best_area:
                best_area, best = area, [x1, y1, x2, y2]
        if best is not None:
            # pad 8% so the aspect-expand crop keeps limbs (dives reach wide)
            pw, ph = (best[2] - best[0]) * 0.08, (best[3] - best[1]) * 0.08
            return (np.array([best[0] - pw, best[1] - ph, best[2] + pw, best[3] + ph],
                             dtype=np.float32), 'torchvision-mobilenet')
    except Exception as e:  # noqa
        log(f'detector unavailable ({e}); using full frame')
    return (full, 'full-frame')


def _run_on(device, model, batch):
    from hmr2.utils import recursive_to
    import torch
    # MPS has no float64 — downcast before the device move.
    batch = {k: (v.float() if torch.is_tensor(v) and v.dtype == torch.float64 else v)
             for k, v in batch.items()}
    b = recursive_to(batch, device)
    with torch.no_grad():
        return model(b)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = {a.split('=')[0].lstrip('-'): a.split('=')[1]
            for a in sys.argv[1:] if a.startswith('--') and '=' in a}
    if len(args) < 2:
        log('usage: pose_hmr.py <out_dir> <image_path> [--repo=...]')
        sys.exit(2)
    out_dir, img_path = args[0], args[1]
    os.makedirs(out_dir, exist_ok=True)

    # Vendored 4D-Humans source on the import path.
    repo = opts.get('repo') or os.path.join(
        os.path.dirname(__file__), '..', '..', 'STUDY', 'world_from_image', '4D-Humans')
    repo = os.path.abspath(repo)
    if os.path.isdir(repo) and repo not in sys.path:
        sys.path.insert(0, repo)

    t0 = time.time()
    import cv2
    import numpy as np
    import torch
    _stub_renderers()
    # Torch 2.6+ defaults torch.load(weights_only=True); the HMR2 checkpoint
    # embeds an omegaconf config object. This is OUR OWN trusted, locally cached
    # checkpoint, so allow full unpickling.
    _orig_torch_load = torch.load
    def _trusted_load(*a, **k):
        k['weights_only'] = False   # override Lightning's explicit weights_only=True
        return _orig_torch_load(*a, **k)
    torch.load = _trusted_load
    from hmr2.configs import CACHE_DIR_4DHUMANS
    from hmr2.models import download_models, load_hmr2, DEFAULT_CHECKPOINT
    # hmr2.datasets.__init__ pulls training-only deps (webdataset/braceexpand/…).
    # Skip it: register an empty package with the right __path__ so only the
    # inference module (vitdet_dataset + its .utils) loads.
    import hmr2  # noqa
    ds_pkg = types.ModuleType('hmr2.datasets')
    ds_pkg.__path__ = [os.path.join(repo, 'hmr2', 'datasets')]
    sys.modules['hmr2.datasets'] = ds_pkg
    from hmr2.datasets.vitdet_dataset import ViTDetDataset

    log(f'cache dir {CACHE_DIR_4DHUMANS}')
    if not os.path.exists(DEFAULT_CHECKPOINT):
        log('downloading model weights (~2.5GB, first run only)…')
        download_models(CACHE_DIR_4DHUMANS)

    log('loading the body model…')
    model, model_cfg = load_hmr2(DEFAULT_CHECKPOINT)
    device = torch.device('mps') if torch.backends.mps.is_available() else torch.device('cpu')
    try:
        model = model.to(device)
    except Exception as e:  # noqa
        log(f'{device} placement failed ({e}); using cpu')
        device = torch.device('cpu'); model = model.to(device)
    model.eval()
    t_load = time.time() - t0
    log(f'model ready in {t_load:.1f}s on {device.type}')

    img_cv2 = cv2.imread(img_path)
    if img_cv2 is None:
        log(f'could not read image: {img_path}'); sys.exit(3)
    H, W = img_cv2.shape[:2]

    log('finding the figure…')
    box, detector = _person_box(img_cv2, repo)
    log(f'figure box {[round(v) for v in box.tolist()]} via {detector}')

    dataset = ViTDetDataset(model_cfg, img_cv2, box[None, :])
    loader = torch.utils.data.DataLoader(dataset, batch_size=1, shuffle=False, num_workers=0)
    batch = next(iter(loader))

    log('reading the body…')
    # cold pass (includes lazy MPS kernel build) then a warm pass — report both.
    try:
        t = time.time(); out = _run_on(device, model, batch); t_cold = time.time() - t
        t = time.time(); out = _run_on(device, model, batch); t_warm = time.time() - t
    except (NotImplementedError, RuntimeError) as e:
        log(f'{device.type} hit an unsupported op ({e}); retrying on cpu')
        device = torch.device('cpu'); model = model.to(device)
        t = time.time(); out = _run_on(device, model, batch); t_cold = time.time() - t
        t = time.time(); out = _run_on(device, model, batch); t_warm = time.time() - t
    log(f'inference cold {t_cold:.2f}s · warm {t_warm:.2f}s on {device.type}')

    sp = out['pred_smpl_params']
    go = sp['global_orient'][0].detach().cpu().numpy()     # (1,3,3)
    bp = sp['body_pose'][0].detach().cpu().numpy()          # (23,3,3)
    betas = sp['betas'][0].detach().cpu().numpy().reshape(-1).tolist()
    global_orient = _rotmat_to_aa(go[0])
    body_pose = [_rotmat_to_aa(bp[j]) for j in range(bp.shape[0])]

    # Posed 3D joints — smpl_wrapper remaps to OpenPose-25 (then appends extras).
    kp = out['pred_keypoints_3d'][0].detach().cpu().numpy()  # (44,3), model frame
    OP = dict(nose=0, neck=1, right_shoulder=2, right_elbow=3, right_wrist=4,
              left_shoulder=5, left_elbow=6, left_wrist=7, mid_hip=8,
              right_hip=9, right_knee=10, right_ankle=11,
              left_hip=12, left_knee=13, left_ankle=14,
              left_foot=19, right_foot=22)   # BigToe stands in for the foot tip
    joints3d = {name: [float(kp[i][0]), float(kp[i][1]), float(kp[i][2])]
                for name, i in OP.items()}

    pred_cam = out['pred_cam'][0].detach().cpu().numpy().tolist()   # [s, tx, ty]
    focal = float(model_cfg.EXTRA.FOCAL_LENGTH)

    payload = {
        'ok': True,
        'global_orient': global_orient,        # axis-angle (3,)
        'body_pose': body_pose,                # 23 x axis-angle
        'betas': betas,                        # 10
        'joints3d': joints3d,                  # named, SMPL/model frame (metres)
        'camera': {'s': pred_cam[0], 'tx': pred_cam[1], 'ty': pred_cam[2],
                   'focal_length': focal, 'img_w': W, 'img_h': H,
                   'box': [float(v) for v in box.tolist()]},
        'meta': {'device': device.type, 'detector': detector,
                 'latency_load_s': round(t_load, 2),
                 'latency_infer_cold_s': round(t_cold, 2),
                 'latency_infer_warm_s': round(t_warm, 2),
                 'weights': 'HMR2.0 (4D-Humans) — RESEARCH, internal use only'},
    }
    out_path = os.path.join(out_dir, 'pose.json')
    with open(out_path, 'w') as f:
        json.dump(payload, f)
    log(f'done {out_path}')


if __name__ == '__main__':
    main()
