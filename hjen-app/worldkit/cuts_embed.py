#!/usr/bin/env python3
"""Cuts Engine — visual re-identification embeddings (local, offline, MPS).

Manifest JSON: { "out": <path>, "model": <hf id>, "shots": [{ "i", "frames": [paths] }] }

For every shot, across the frames given, it computes three normalised vectors:
  · face   — FaceNet (vggface2) on the largest detectable face in ANY frame (strongest identity, but often absent in wide/motion shots)
  · person — DINOv2 on the isolated person crop (appearance fallback when no face)
  · scene  — DINOv2 on the full frame (location signal)
Writes { "faceDim", "vecDim", "shots": [{ "i", "face"|null, "person", "scene", "hasFace", "hasPerson" }] }.

Identity is a similarity problem no single signal solves on a fast montage, so
the caller FUSES these three (+ time) to decide who-is-who. Detection runs on
CPU (an MPS adaptive-pool gap); embeddings run on MPS.
"""
import sys, json
import numpy as np
import torch
from PIL import Image
from torchvision.models.detection import (
    fasterrcnn_mobilenet_v3_large_fpn, FasterRCNN_MobileNet_V3_Large_FPN_Weights,
)
from transformers import AutoImageProcessor, AutoModel
from facenet_pytorch import MTCNN, InceptionResnetV1


def main() -> int:
    manifest = json.load(open(sys.argv[1]))
    out_path = manifest["out"]
    shots = manifest["shots"]
    model_name = manifest.get("model", "facebook/dinov2-base")
    dev = "mps" if torch.backends.mps.is_available() else "cpu"

    dw = FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT
    det = fasterrcnn_mobilenet_v3_large_fpn(weights=dw).eval().to(dev)
    prep = dw.transforms()
    proc = AutoImageProcessor.from_pretrained(model_name)
    emb = AutoModel.from_pretrained(model_name).eval().to(dev)
    mtcnn = MTCNN(image_size=160, margin=16, keep_all=True, device="cpu")  # detect on CPU
    fnet = InceptionResnetV1(pretrained="vggface2").eval().to(dev)
    print("READY %s on %s" % (model_name, dev), flush=True)

    def largest_person(img):
        x = prep(img).to(dev)
        with torch.no_grad():
            out = det([x])[0]
        best, ba = None, 0.0
        for b, l, s in zip(out["boxes"], out["labels"], out["scores"]):
            if int(l) == 1 and float(s) > 0.5:
                a = float((b[2] - b[0]) * (b[3] - b[1]))
                if a > ba:
                    ba, best = a, b
        if best is None:
            return None
        x1, y1, x2, y2 = [int(v) for v in best.tolist()]
        w, h = img.size
        px, py = int((x2 - x1) * 0.06), int((y2 - y1) * 0.06)
        return img.crop((max(0, x1 - px), max(0, y1 - py), min(w, x2 + px), min(h, y2 + py)))

    def dino(img):
        inp = proc(images=img, return_tensors="pt").to(dev)
        with torch.no_grad():
            o = emb(**inp)
        v = o.last_hidden_state[:, 0].squeeze(0).float().cpu().numpy()
        return v / (np.linalg.norm(v) + 1e-8)

    def best_face_vec(imgs):
        """Largest face across all frames of the shot → its FaceNet vector."""
        best_crop, best_area = None, 0.0
        for im in imgs:
            try:
                boxes, probs = mtcnn.detect(im)
            except Exception:
                boxes = None
            if boxes is None:
                continue
            for b, p in zip(boxes, probs):
                if p is None or p < 0.90:
                    continue
                area = float((b[2] - b[0]) * (b[3] - b[1]))
                if area > best_area:
                    best_area = area
                    crops = mtcnn.extract(im, np.array([b]), None)
                    best_crop = crops[0] if crops is not None else None
        if best_crop is None:
            return None
        with torch.no_grad():
            e = fnet(best_crop.unsqueeze(0).to(dev))[0].float().cpu().numpy()
        return e / (np.linalg.norm(e) + 1e-8)

    res = []
    for idx, sh in enumerate(shots):
        try:
            imgs = []
            for f in sh.get("frames", [])[:4]:
                try:
                    imgs.append(Image.open(f).convert("RGB"))
                except Exception:
                    pass
            if not imgs:
                res.append({"i": sh["i"], "face": None, "person": None, "scene": None, "hasFace": False, "hasPerson": False})
            else:
                key = imgs[0]
                crop = largest_person(key)
                face = best_face_vec(imgs)
                res.append({
                    "i": sh["i"],
                    "face": None if face is None else face.astype(np.float32).tolist(),
                    "person": dino(crop if crop is not None else key).astype(np.float32).tolist(),
                    "scene": dino(key).astype(np.float32).tolist(),
                    "hasFace": face is not None,
                    "hasPerson": crop is not None,
                })
        except Exception as e:  # noqa: BLE001
            res.append({"i": sh["i"], "face": None, "person": None, "scene": None, "hasFace": False, "hasPerson": False, "error": str(e)})
        print("EMBED %d/%d" % (idx + 1, len(shots)), flush=True)

    vecDim = next((len(r["person"]) for r in res if r.get("person")), 0)
    faceDim = next((len(r["face"]) for r in res if r.get("face")), 0)
    json.dump({"model": model_name, "vecDim": vecDim, "faceDim": faceDim, "shots": res}, open(out_path, "w"))
    print("DONE %s" % out_path, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
