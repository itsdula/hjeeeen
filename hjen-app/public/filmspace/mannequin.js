// Film Space — the human stand-in.
//
// A REAL rigged, skinned human loaded from a vendored GLB (Quaternius Universal
// Base Characters, genuinely CC0 1.0 / public domain — NO attribution required;
// see ./assets/LICENSE). Full 65-joint UE-mannequin skeleton (incl. fingers),
// ~14.3k tris. The mesh is rendered as neutral clay — realism is SHAPE + adult
// proportions; photoreal skin / cast face are a later stage. Textures were stripped
// at vendor time (we override to clay anyway), so the module is geometry + skeleton
// only. Loaded offline from disk (base64 ES module, no runtime network).
//
// The GLB skeleton is retargeted onto the app's COCO-17 joint graph so pose.png
// stays exact and zero-ML: cocoWorld() reads real bone WORLD positions, which are
// axis-independent, so the export is correct whatever the source rig's local axes.
//
// FK posing is world-axis "aim" retargeting: each pose declares, per limb segment,
// a target DIRECTION in an anatomical basis (up / character-right / facing). This
// is independent of the source rig's idiosyncratic bone axes, so the same preset
// table (stand · contrapposto · walk-stride · sit · point · reach · hands-in-pockets)
// reads correctly on the real skeleton.

import * as THREE from 'three';
import { GLTFLoader } from '../world/vendor/GLTFLoader.js';
import { HJEN_STANDIN_GLB_B64 } from './assets/HjenStandIn.glb.js';

const loader = new GLTFLoader();

// ── bone-name → anatomical role. The vendored rig uses the Unreal/Epic mannequin
//    naming (pelvis / spine_01 / upperarm_l / thigh_l / Head …); mixamorig, Blender
//    (.L/.R), Skeleton_* and CesiumMan fallbacks stay so any rig still maps. ──
const BONE_NAMES = {
  hips:      ['Skeleton_torso_joint_1', 'Hips', 'mixamorigHips', 'pelvis'],
  spine:     ['Skeleton_torso_joint_2', 'Spine', 'mixamorigSpine', 'spine_01'],
  chest:     ['torso_joint_3', 'Spine2', 'Chest', 'mixamorigSpine2', 'spine_02'],
  neck:      ['Skeleton_neck_joint_1', 'Neck', 'mixamorigNeck', 'neck_01'],
  head:      ['Skeleton_neck_joint_2', 'Head', 'mixamorigHead', 'head'],
  shoulderL: ['Skeleton_arm_joint_L__4_', 'LeftArm', 'mixamorigLeftArm', 'upperarm_l', 'shoulder.L'],
  elbowL:    ['Skeleton_arm_joint_L__3_', 'LeftForeArm', 'mixamorigLeftForeArm', 'lowerarm_l', 'forearm.L'],
  wristL:    ['Skeleton_arm_joint_L__2_', 'LeftHand', 'mixamorigLeftHand', 'hand_l', 'hand.L'],
  shoulderR: ['Skeleton_arm_joint_R', 'RightArm', 'mixamorigRightArm', 'upperarm_r', 'shoulder.R'],
  elbowR:    ['Skeleton_arm_joint_R__2_', 'RightForeArm', 'mixamorigRightForeArm', 'lowerarm_r', 'forearm.R'],
  wristR:    ['Skeleton_arm_joint_R__3_', 'RightHand', 'mixamorigRightHand', 'hand_r', 'hand.R'],
  hipL:      ['leg_joint_L_1', 'LeftUpLeg', 'mixamorigLeftUpLeg', 'thigh_l', 'upper_leg.L'],
  kneeL:     ['leg_joint_L_2', 'LeftLeg', 'mixamorigLeftLeg', 'calf_l', 'lower_leg.L'],
  ankleL:    ['leg_joint_L_3', 'LeftFoot', 'mixamorigLeftFoot', 'foot_l', 'foot.L'],
  footL:     ['leg_joint_L_5', 'LeftToeBase', 'mixamorigLeftToeBase', 'ball_l', 'toe.L'],
  hipR:      ['leg_joint_R_1', 'RightUpLeg', 'mixamorigRightUpLeg', 'thigh_r', 'upper_leg.R'],
  kneeR:     ['leg_joint_R_2', 'RightLeg', 'mixamorigRightLeg', 'calf_r', 'lower_leg.R'],
  ankleR:    ['leg_joint_R_3', 'RightFoot', 'mixamorigRightFoot', 'foot_r', 'foot.R'],
  footR:     ['leg_joint_R_5', 'RightToeBase', 'mixamorigRightToeBase', 'ball_r', 'toe.R'],
};

// Limb segments we pose = (parent bone, child bone). aim() points the segment.
const SEGMENTS = [
  ['neck', 'head'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
  ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['ankleL', 'footL'],
  ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['ankleR', 'footR'],
];

// Pose presets. Each entry is a direction in the anatomical basis:
// [ up, characterRight, facing ]. Vectors are normalized by aim().
// characterLEFT = -characterRight. Order-independent (applied parent→child).
const POSES = {
  'stand': {
    neck: [1, 0, 0], head: [1, 0, 0],
    shoulderL: [-1, -0.18, 0], elbowL: [-1, -0.05, 0],
    shoulderR: [-1, 0.18, 0], elbowR: [-1, 0.05, 0],
    hipL: [-1, -0.04, 0], kneeL: [-1, 0, 0], footL: [0, 0, 1],
    hipR: [-1, 0.04, 0], kneeR: [-1, 0, 0], footR: [0, 0, 1],
  },
  'contrapposto': {
    neck: [1, 0.05, 0], head: [1, -0.04, 0.03],
    shoulderL: [-1, -0.22, 0.02], elbowL: [-1, -0.06, 0.10],
    shoulderR: [-1, 0.14, 0], elbowR: [-1, 0.05, 0.06],
    hipR: [-1, 0.04, 0], kneeR: [-1, 0, 0], footR: [0, 0, 1],
    hipL: [-1, -0.10, 0.14], kneeL: [-1, 0, 0.12], footL: [0, 0, 1],
  },
  'walk-stride': {
    neck: [1, 0, 0], head: [1, 0, 0.03],
    hipL: [-1, -0.04, 0.85], kneeL: [-1, 0, 0.10], footL: [0, 0, 1],
    hipR: [-1, 0.04, -0.60], kneeR: [-1, 0, 0.60], footR: [-0.4, 0, 0.6],
    shoulderL: [-1, -0.10, -0.50], elbowL: [-1, 0, -0.22],
    shoulderR: [-1, 0.10, 0.55], elbowR: [-1, 0, 0.35],
  },
  'sit': {
    neck: [1, 0, 0], head: [1, 0, 0.02],
    hipL: [-0.06, -0.05, 1], kneeL: [-1, 0, 0.02], footL: [0, 0, 1],
    hipR: [-0.06, 0.05, 1], kneeR: [-1, 0, 0.02], footR: [0, 0, 1],
    shoulderL: [-1, -0.10, 0.06], elbowL: [-0.35, 0, 0.85],
    shoulderR: [-1, 0.10, 0.06], elbowR: [-0.35, 0, 0.85],
  },
  'point': {
    neck: [1, 0.02, 0.04], head: [1, 0, 0.06],
    shoulderR: [-0.05, 0.10, 0.98], elbowR: [0, 0, 1],
    shoulderL: [-1, -0.16, 0], elbowL: [-1, -0.05, 0],
    hipL: [-1, -0.04, 0], kneeL: [-1, 0, 0], footL: [0, 0, 1],
    hipR: [-1, 0.04, 0], kneeR: [-1, 0, 0], footR: [0, 0, 1],
  },
  'reach': {
    neck: [1, 0, 0.10], head: [1, 0, 0.10],
    shoulderL: [0.55, -0.12, 0.75], elbowL: [0.55, 0, 0.75],
    shoulderR: [0.55, 0.12, 0.75], elbowR: [0.55, 0, 0.75],
    hipL: [-1, -0.04, 0.06], kneeL: [-1, 0, 0], footL: [0, 0, 1],
    hipR: [-1, 0.04, 0.06], kneeR: [-1, 0, 0], footR: [0, 0, 1],
  },
  'hands-in-pockets': {
    neck: [1, 0, 0], head: [1, 0, 0],
    shoulderL: [-1, -0.12, 0.06], elbowL: [-0.55, 0.42, 0.55],
    shoulderR: [-1, 0.12, 0.06], elbowR: [-0.55, -0.42, 0.55],
    hipL: [-1, -0.05, 0], kneeL: [-1, 0, 0.03], footL: [0, 0, 1],
    hipR: [-1, 0.05, 0], kneeR: [-1, 0, 0.03], footR: [0, 0, 1],
  },
};
// Fraction of standing height the whole figure drops so a pose reads grounded.
const POSE_DROP = { 'sit': 0.30 };

// ── Pose-from-image retarget ──
// An estimated 3D pose (named joints, hips-centred metres from a monocular model)
// is retargeted onto the same DIRECTION-based FK the presets use. We build the
// SOURCE's anatomical basis from its own shoulders + hips, express every limb
// segment's aim (child − parent) as [up, characterRight, facing] IN THAT basis,
// then feed the SAME specs through the rig's own basis in _applyPose — so the
// retarget is frame-independent vector math, no IK solver. Two chirality knobs are
// tuned once against the render: FWD_SIGN corrects that monocular world space is
// y-DOWN (left-handed vs three.js), YAW_SIGN maps torso azimuth to stage rotation.
const FWD_SIGN = -1;
const YAW_SIGN = -1;
// HMR retarget calibration. FLIP maps SMPL/HMR camera space (x right, y DOWN,
// z INTO screen) to three.js (y up, z toward viewer) — a proper rotation, det +1,
// so chirality (left/right) is preserved. FACING_SIGN picks which face of the
// torso plane is anterior. Both tuned once against the rendered figure.
const HMR_FLIP = [1, -1, -1];
const HMR_FACING_SIGN = 1;

// ── Self-intersection guard ──
// Cheap analytic collision proxies (a head SPHERE, a torso CAPSULE, two thigh
// CAPSULES), all scaled by figure height, plus a clearance margin. After a pose
// is applied we push any arm point that has penetrated a proxy back OUT to the
// surface + clearance — so a hand comes to REST on the head (reads as "holding
// the head") instead of clipping through it. Fractions of figure height:
const COL_HEAD_R = 0.115;   // head sphere radius — skull AND jaw/face (was too small,
                            //   let finger tips clip the face); ~20cm dia at 1.75m
const COL_HEAD_UP = 0.035;  // lift the sphere centre toward skull-centre but keep it low
                            //   enough that the sphere still envelopes the jaw/chin
const COL_TORSO_R = 0.10;   // torso capsule radius (kept < a natural arms-at-side offset)
const COL_THIGH_R = 0.065;  // thigh capsule radius
const COL_HAND = 0.115;     // hand length past the wrist (wrist→finger-tips), figure-frac
const COL_CLEAR = 0.012;    // clearance margin (~2cm at 1.75m) — hand RESTS just off skin
const COL_ITERS = 16;       // max resolve steps per joint phase (was 8 — deep folds need more)

// closest point on segment a→b to p, written into `out`.
function _closestOnSeg(p, a, b, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}
// mannequin segment role → [ parentJointName, childJointName ] in the named set.
const JOINT_MAP = {
  neck:      ['__shoulderC', 'nose'],
  shoulderL: ['left_shoulder', 'left_elbow'],   elbowL: ['left_elbow', 'left_wrist'],
  shoulderR: ['right_shoulder', 'right_elbow'], elbowR: ['right_elbow', 'right_wrist'],
  hipL: ['left_hip', 'left_knee'],   kneeL: ['left_knee', 'left_ankle'],   ankleL: ['left_ankle', 'left_foot'],
  hipR: ['right_hip', 'right_knee'], kneeR: ['right_knee', 'right_ankle'], ankleR: ['right_ankle', 'right_foot'],
};

// Neutral clay. A mild self-emissive of the same hue lifts the concave crevices
// of the base mesh's molded surface detail (the vendor mesh carries faint sculpted
// forms), so under the stage lights the figure reads as one smooth, even clay tone
// — a featureless artist's dummy — instead of showing dark patchy shading.
const clay = () => new THREE.MeshStandardMaterial({
  color: 0x9198a1, roughness: 0.95, metalness: 0,
  emissive: 0x9198a1, emissiveIntensity: 0.14, flatShading: false,
});

// Recompute vertex normals WELD-AWARE (averaged by world POSITION, not by vertex
// index). The vendored body mesh splits vertices along UV/material seams; a plain
// geometry.computeVertexNormals() averages per-index, so the two sides of a seam
// get different normals and a hard shading LINE appears (e.g. across the waist)
// that the authored GLB normals never had. Averaging by position welds those
// seams back to one smooth normal — reproducing the original look everywhere and
// smoothing the reshaped groin strip too. Topology/skinning attributes untouched.
const _wn = { pA: new THREE.Vector3(), pB: new THREE.Vector3(), pC: new THREE.Vector3(), cb: new THREE.Vector3(), ab: new THREE.Vector3(), n: new THREE.Vector3() };
function computeWeldedVertexNormals(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  let nrm = geo.attributes.normal;
  if (!nrm) { nrm = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3); geo.setAttribute('normal', nrm); }
  const keyToAcc = new Map(), acc = [], vertKey = new Int32Array(pos.count), Q = 1e4;
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * Q) + '_' + Math.round(pos.getY(i) * Q) + '_' + Math.round(pos.getZ(i) * Q);
    let a = keyToAcc.get(k);
    if (a === undefined) { a = acc.length; keyToAcc.set(k, a); acc.push(new THREE.Vector3()); }
    vertKey[i] = a;
  }
  const { pA, pB, pC, cb, ab, n } = _wn;
  const addFace = (ia, ib, ic) => {
    pA.fromBufferAttribute(pos, ia); pB.fromBufferAttribute(pos, ib); pC.fromBufferAttribute(pos, ic);
    cb.subVectors(pC, pB); ab.subVectors(pA, pB); cb.cross(ab);   // area-weighted face normal
    acc[vertKey[ia]].add(cb); acc[vertKey[ib]].add(cb); acc[vertKey[ic]].add(cb);
  };
  if (idx) { for (let i = 0; i < idx.count; i += 3) addFace(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)); }
  else { for (let i = 0; i < pos.count; i += 3) addFace(i, i + 1, i + 2); }
  for (let i = 0; i < pos.count; i++) { n.copy(acc[vertKey[i]]); if (n.lengthSq() > 0) n.normalize(); nrm.setXYZ(i, n.x, n.y, n.z); }
  nrm.needsUpdate = true;
}

let _buffer = null;
function glbBuffer() {
  if (_buffer) return _buffer;
  const bin = atob(HJEN_STANDIN_GLB_B64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  _buffer = u.buffer;
  return _buffer;
}
// Each instance parses its own scene → its own independent skeleton.
function parseGLB() {
  return new Promise((res, rej) => loader.parse(glbBuffer(), '', g => res(g), rej));
}

const _v = () => new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qpp = new THREE.Quaternion();

// Build the mannequin. Returns a record with the same shape the stage expects:
//   { group, nodes, height, pose, setPose(name), setHeight(h), cocoWorld() }
export async function buildMannequin(height) {
  const gltf = await parseGLB();
  const model = gltf.scene;

  // one clay material for the whole figure (drops any source texture too). The
  // rig ships as MULTIPLE skinned meshes (body + hair + eyes) — collect them ALL,
  // because each one must be re-bound after we wrap/scale the model or the meshes
  // that aren't re-bound keep stale bind matrices and float free of the pose.
  const skinnedList = [];
  model.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.material = clay();
      o.userData.pick = true;
      o.frustumCulled = false;   // skinned bbox drifts when posed
      if (o.isSkinnedMesh) skinnedList.push(o);
    }
  });
  const skinned = skinnedList[0] || null;

  // resolve bones by name (with fallbacks)
  const bones = {};
  for (const role in BONE_NAMES) {
    for (const nm of BONE_NAMES[role]) { const b = model.getObjectByName(nm); if (b) { bones[role] = b; break; } }
  }

  // ── wrap: outer(user rotation slider) → poseRoot(SMPL global orientation) →
  //    fit(base orient + height scale + ground/sit) → model ──
  // poseRoot sits BETWEEN the user's Rotation slider (outer.rotation.y) and the
  // base fit so an image-recovered global orientation (a horizontal dive, a
  // pitched crouch) can tip the whole figure WITHOUT stealing the manual
  // Rotation control. It stays identity for presets.
  const fit = new THREE.Group(); fit.add(model);
  const poseRoot = new THREE.Group(); poseRoot.add(fit);
  const outer = new THREE.Group(); outer.add(poseRoot);
  outer.updateMatrixWorld(true);

  // stand upright (source is authored Z-up under a "Z_UP" node; if it isn't
  // already Y-up after import, rotate it)
  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(_v());
  if (size.z > size.y * 1.2) { fit.rotation.x = -Math.PI / 2; outer.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(model); size = box.getSize(_v()); }

  // face +Z (toward the default camera). facing = right × up, where
  // right = (rightShoulder − leftShoulder). Verified against the rendered figure.
  if (bones.shoulderL && bones.shoulderR) {
    const right = bones.shoulderR.getWorldPosition(_v()).sub(bones.shoulderL.getWorldPosition(_v())).setY(0).normalize();
    const facing = right.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    fit.rotation.y -= Math.atan2(facing.x, facing.z);   // rotate facing → +Z
    outer.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model); size = box.getSize(_v());
  }

  const H0 = Math.max(0.001, size.y);            // upright, unscaled height
  const floorUnit = -box.min.y;                  // lift so feet sit on y=0 (unscaled)

  // capture bind pose (rest local quaternions) for reset
  const bindQuat = {};
  for (const role in bones) bindQuat[role] = bones[role].quaternion.clone();

  // ── neutralise the crotch at the GEOMETRY level (no added mesh) ──
  // The vendored base mesh is an anatomically complete NUDE male: it carries an
  // explicit genital form protruding forward-and-down between the upper thighs.
  // A stand-in that appears in a plate / reference / video must read as a smooth,
  // featureless artist's dummy — never nude anatomy. Every PRIOR attempt ADDED a
  // primitive over the spot (a front cover ellipsoid, then a wardrobe wrap), and
  // anything added protrudes from SOME angle — the cover ellipsoid read as a ball
  // sticking out of the REAR. So we flatten the anatomy in the mesh ITSELF.
  //
  // In the body mesh's bind-pose local frame we rebuild the pelvis basis from the
  // hip/head bone REST positions (via the inverse bind matrices — frame-exact,
  // independent of the fit/scale wrapping), isolate the anterior groin vertices
  // (central column between the thighs, within the groin height band, protruding
  // along +anterior), and CLAMP each one's forward coordinate down to a smooth
  // ceiling LINE anchored on the lower belly ABOVE and the perineum BELOW. The
  // clamp only ever pulls a vertex BACK toward that surrounding surface, never
  // past it — so the strip becomes a smooth neutral pubic plate with no bump and
  // NO crater, continuous with the belly and the inner thighs (lateral + vertical
  // smoothstep falloff, so no seam). Because the edit lives in the bind pose of a
  // SKINNED mesh, it rides every pose and can never stick out from any viewpoint.
  // cocoWorld()/pose.png read BONE positions, untouched — the 17 joints stay exact.
  // Constants are metres in the vendored GLB's own bind space (figure ≈ 1.81 tall).
  (function flattenGroinGeometry() {   // HJEN_GROIN_FLATTEN_V2
    // body = the skinned mesh with the most vertices (SuperHero_Male), not the
    // eyebrow/eye skinned meshes that share the same rig.
    const body = skinnedList.slice().sort((a, b) =>
      b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
    if (!body || !body.skeleton) return;
    const skel = body.skeleton, posAttr = body.geometry.attributes.position;

    // bone rest position in the mesh's bind-local frame = translation of the
    // (inverted) inverse-bind matrix.
    const restOf = role => {
      const b = bones[role]; if (!b) return null;
      const idx = skel.bones.indexOf(b); if (idx < 0) return null;
      const m = skel.boneInverses[idx].clone().invert();
      return new THREE.Vector3(m.elements[12], m.elements[13], m.elements[14]);
    };
    const hL = restOf('hipL'), hR = restOf('hipR'), hd = restOf('head');
    if (!hL || !hR || !hd) return;
    const hipC = hL.clone().add(hR).multiplyScalar(0.5);
    const up = hd.clone().sub(hipC).normalize();
    const right = hR.clone().sub(hL).normalize();          // character's right
    const fwd = right.clone().cross(up).normalize();        // anterior (front of body)
    const hipHalfW = hL.distanceTo(hR) * 0.5;

    // Reference plane for the anterior coordinate as a function of height u (metres
    // above hipC along up): a LINE through the real belly surface above and the
    // perineum below, so the neutral plate is continuous with both.
    const CEIL_A = 0.093, CEIL_B = 0.265;                   // ref = A + B*u
    const RECESS = 0.010;                                   // gentle extra recess at the very centre
    // A SMOOTH radial weight (2D Gaussian in the up/lat plane, centred on the groin)
    // drives the pull, so the deformation is C1-continuous everywhere — no hard
    // region edge, therefore NO seam/ridge when normals are recomputed.
    const U0 = -0.045;                                      // groin-region centre, metres above hipC
    const SIG_U = 0.100;                                    // vertical spread
    const SIG_LAT = 0.052 + 0.10 * hipHalfW;               // lateral spread (~0.063)

    const p = new THREE.Vector3(), rel = new THREE.Vector3(); let touched = 0;
    for (let i = 0; i < posAttr.count; i++) {
      p.fromBufferAttribute(posAttr, i);
      rel.copy(p).sub(hipC);
      const u = rel.dot(up), lat = rel.dot(right), f = rel.dot(fwd);
      const wu = (u - U0) / SIG_U, wl = lat / SIG_LAT;
      const w = Math.exp(-(wu * wu + wl * wl));             // smooth 0..1, peak at the groin centre
      if (w < 0.02) continue;
      const target = (CEIL_A + CEIL_B * u) - RECESS * w;    // ref line, slight central recess
      if (f <= target) continue;                            // already at/behind it — leave it
      p.addScaledVector(fwd, -w * (f - target));            // smooth pull-back, full at centre, fading out
      posAttr.setXYZ(i, p.x, p.y, p.z);
      touched++;
    }
    if (touched) {
      posAttr.needsUpdate = true;
      computeWeldedVertexNormals(body.geometry);           // re-light seam-free (weld by position)
      body.geometry.computeBoundingSphere();
    }
  })();

  const mann = {
    group: outer, nodes: bones, bones, skinned, height, pose: 'stand', _H0: H0, _floorUnit: floorUnit,
    _poseRoot: poseRoot,

    // Re-pose (which re-binds at the new scale) so height changes never leave a
    // stale bind matrix behind.
    setHeight(h) { mann.height = h; mann.setPose(mann.pose); },

    _applyFit() {
      const s = mann.height / mann._H0;
      fit.scale.setScalar(s);
      const drop = (POSE_DROP[mann.pose] || 0) * mann.height;
      fit.position.y = mann._floorUnit * s - drop;
      outer.updateMatrixWorld(true);
    },

    // point a limb segment (parent→child) along a world-space target direction
    _aim(role, childRole, target) {
      const p = bones[role], c = bones[childRole]; if (!p || !c) return;
      outer.updateMatrixWorld(true);
      const cur = c.getWorldPosition(_v()).sub(p.getWorldPosition(_v()));
      if (cur.lengthSq() < 1e-9) return;
      cur.normalize();
      _q.setFromUnitVectors(cur, target.clone().normalize());   // world delta rotation
      p.getWorldQuaternion(_qp);                                // current bone world quat
      const newWorld = _q.multiply(_qp);                        // R * boneWorld
      p.parent.getWorldQuaternion(_qpp);                        // parent-of-bone world quat
      p.quaternion.copy(_qpp.invert().multiply(newWorld));      // → local
      p.updateMatrixWorld(true);
    },

    // Reset bones to bind, clear any image-recovered root tilt, apply the fit,
    // and re-bind skinning at REST in the current (oriented + height-scaled)
    // frame. GLTFLoader bound the skeleton in the raw import frame; after we wrap
    // the model in oriented/scaled groups those bind matrices are stale, which
    // double-transforms and collapses the mesh when bones are posed. Recomputing
    // inverses at the rest pose makes skinning exact in the wrapped frame.
    _rebindRest() {
      for (const role in bindQuat) bones[role].quaternion.copy(bindQuat[role]);
      poseRoot.quaternion.identity(); poseRoot.position.set(0, 0, 0);
      mann._applyFit();
      outer.updateMatrixWorld(true);
      for (const sk of skinnedList) {
        if (!sk.skeleton) continue;
        sk.skeleton.calculateInverses();
        sk.bind(sk.skeleton, sk.matrixWorld);
      }
      outer.updateMatrixWorld(true);
    },

    // Apply ANY spec set (preset table OR a pose retargeted from an image). A spec
    // per role is a direction [up, characterRight, facing] in the rig's anatomical
    // basis. Reset → fit → re-bind → derive the rig basis → aim each segment.
    _applyPose(name, specSet) {
      mann.pose = name;
      mann._rebindRest();
      // anatomical basis from the (now reset) skeleton
      const up = new THREE.Vector3(0, 1, 0);
      const sL = bones.shoulderL.getWorldPosition(_v());
      const sR = bones.shoulderR.getWorldPosition(_v());
      const right = sR.clone().sub(sL).setY(0).normalize();     // character's right
      const fwd = right.clone().cross(up).normalize();          // facing (right × up ≈ +Z)
      if (fwd.z < 0) fwd.negate();
      const dir = ([u, r, f]) => up.clone().multiplyScalar(u).addScaledVector(right, r).addScaledVector(fwd, f);
      for (const [role, child] of SEGMENTS) {
        const spec = specSet[role]; if (!spec) continue;
        mann._aim(role, child, dir(spec));
      }
      mann._resolvePenetration();   // presets can fold a hand into head/knee too
      outer.updateMatrixWorld(true);
    },

    setPose(name) { mann._applyPose(name, POSES[name] || POSES.stand); },

    // Retarget an estimated 3D pose (named joints in a monocular model's own metric
    // frame) onto the rig. Builds the SOURCE anatomical basis from its shoulders +
    // hips, projects every limb segment's aim into it → the same [up,right,facing]
    // spec the presets speak, then runs the shared _applyPose path. Returns the
    // torso yaw (deg) so the stage can face the figure the way the source did, and
    // the count of segments that resolved. Zero-ML, zero-IK — pure vector math.
    setPoseFromJoints(J, opts) {
      const minVis = (opts && opts.minVis != null) ? opts.minVis : 0.3;
      const V = j => (j ? new THREE.Vector3(j.x, j.y, j.z) : null);
      const ok = j => j && (j.v == null || j.v >= minVis);
      const sL = V(J.left_shoulder), sR = V(J.right_shoulder), hL = V(J.left_hip), hR = V(J.right_hip);
      if (!sL || !sR || !hL || !hR) return { ok: false, reason: 'missing torso joints', segments: 0 };
      const shoulderC = sL.clone().add(sR).multiplyScalar(0.5);
      const hipC = hL.clone().add(hR).multiplyScalar(0.5);
      const up = shoulderC.clone().sub(hipC);
      if (up.lengthSq() < 1e-8) return { ok: false, reason: 'degenerate torso', segments: 0 };
      up.normalize();
      const fwd = sR.clone().sub(sL).cross(up);                 // (charRight × up)
      if (fwd.lengthSq() < 1e-8) return { ok: false, reason: 'degenerate torso', segments: 0 };
      fwd.normalize().multiplyScalar(FWD_SIGN);
      const right = up.clone().cross(fwd).normalize();          // re-orthogonalise
      const named = { ...J, __shoulderC: { x: shoulderC.x, y: shoulderC.y, z: shoulderC.z, v: 1 } };
      const specs = {};
      for (const role in JOINT_MAP) {
        const [pn, cn] = JOINT_MAP[role]; const pj = named[pn], cj = named[cn];
        if (!ok(pj) || !ok(cj)) continue;
        const d = V(cj).sub(V(pj)); if (d.lengthSq() < 1e-8) continue; d.normalize();
        specs[role] = [d.dot(up), d.dot(right), d.dot(fwd)];   // [up, characterRight, facing]
      }
      mann._applyPose('image', specs);
      const yaw = Math.atan2(fwd.x, fwd.z) * YAW_SIGN;
      return { ok: true, yawDeg: THREE.MathUtils.radToDeg(yaw), segments: Object.keys(specs).length };
    },

    // ── HMR (SMPL) retarget — rotations + RECOVERED GLOBAL ORIENTATION ──
    // Consumes a single-image SMPL recovery (4D-Humans / HMR2.0): the posed 3D
    // joints (+ global_orient / body_pose axis-angle, kept for future twist).
    // Unlike setPoseFromJoints — which rebuilds a per-frame anatomical basis and
    // thereby CANCELS global orientation (a horizontal dive collapsed to a
    // STANDING figure) — this recovers the trunk's world orientation onto
    // poseRoot so the body actually lies/leans/faces as shot, then aims every
    // limb along its ABSOLUTE world direction from the SMPL joints. The trunk is
    // carried by poseRoot; the limbs by absolute aims — same world frame, no
    // double counting, and no per-rig rest calibration needed (robust across
    // rigs). Returns segment count. joints3d come in SMPL space; HMR_FLIP maps
    // them to three.js.
    setPoseFromParams(params) {
      const Jn = params && params.joints3d;
      if (!Jn) return { ok: false, reason: 'no joints', segments: 0 };
      const P = name => { const j = Jn[name]; return j ? new THREE.Vector3(
        j[0] * HMR_FLIP[0], j[1] * HMR_FLIP[1], j[2] * HMR_FLIP[2]) : null; };
      const LS = P('left_shoulder'), RS = P('right_shoulder'),
            LH = P('left_hip'), RH = P('right_hip');
      if (!LS || !RS || !LH || !RH) return { ok: false, reason: 'missing torso joints', segments: 0 };

      mann.pose = 'image';
      mann._rebindRest();

      // trunk frame in three.js world
      const shoulderC = LS.clone().add(RS).multiplyScalar(0.5);
      const hipC = LH.clone().add(RH).multiplyScalar(0.5);
      const U = shoulderC.clone().sub(hipC);
      if (U.lengthSq() < 1e-8) return { ok: false, reason: 'degenerate torso', segments: 0 };
      U.normalize();
      const side = RS.clone().sub(LS);                       // left→right shoulder
      let F = side.clone().cross(U);                         // chest normal
      if (F.lengthSq() < 1e-8) F = new THREE.Vector3(0, 0, 1);
      F.multiplyScalar(HMR_FACING_SIGN).normalize();
      let R = U.clone().cross(F).normalize();                // X = Y×Z
      F = R.clone().cross(U).normalize();                    // re-orthonormalise Z

      // rotate poseRoot canonical (X=right, Y=up, Z=facing) → (R, U, F), pivoting
      // about the pelvis so the figure stays framed instead of swinging off origin.
      const pelvisBone = bones.hips || bones.spine;
      outer.updateMatrixWorld(true);
      const p0 = pelvisBone.getWorldPosition(_v());
      poseRoot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, U, F));
      outer.updateMatrixWorld(true);
      const p1 = pelvisBone.getWorldPosition(_v());
      poseRoot.position.add(p0.sub(p1));
      outer.updateMatrixWorld(true);

      // aim each limb along its ABSOLUTE world direction from the SMPL joints
      const HMAP = {
        neck: ['neck', 'nose'],
        shoulderL: ['left_shoulder', 'left_elbow'], elbowL: ['left_elbow', 'left_wrist'],
        shoulderR: ['right_shoulder', 'right_elbow'], elbowR: ['right_elbow', 'right_wrist'],
        hipL: ['left_hip', 'left_knee'], kneeL: ['left_knee', 'left_ankle'], ankleL: ['left_ankle', 'left_foot'],
        hipR: ['right_hip', 'right_knee'], kneeR: ['right_knee', 'right_ankle'], ankleR: ['right_ankle', 'right_foot'],
      };
      let n = 0;
      for (const [role, child] of SEGMENTS) {
        const jm = HMAP[role]; if (!jm) continue;
        const a = P(jm[0]), b = P(jm[1]); if (!a || !b) continue;
        const d = b.clone().sub(a); if (d.lengthSq() < 1e-8) continue;
        mann._aim(role, child, d.normalize()); n++;
      }
      // Push any hand/forearm that landed inside the head/torso/thigh back out to
      // the surface (rest on it, never clip through). __noResolve is a headless
      // test escape hatch only — production always resolves.
      if (!(params && params.__noResolve)) mann._resolvePenetration();
      outer.updateMatrixWorld(true);
      return { ok: true, segments: n };
    },

    // ── Self-intersection guard ──
    // Build the analytic collision proxies from the CURRENT posed skeleton: a
    // head sphere, a torso capsule (neck→hip-centre), and two thigh capsules.
    // They read from head/neck/hip/knee bones, none of which are descendants of
    // the arm joints, so they stay fixed while an arm is resolved.
    _collisionProxies() {
      outer.updateMatrixWorld(true);
      const h = mann.height;
      const up = new THREE.Vector3(0, 1, 0);
      const headC = bones.head.getWorldPosition(_v()).addScaledVector(up, COL_HEAD_UP * h);
      const neck = (bones.neck || bones.chest || bones.spine || bones.head).getWorldPosition(_v());
      const hipC = bones.hipL.getWorldPosition(_v()).add(bones.hipR.getWorldPosition(_v())).multiplyScalar(0.5);
      const caps = [{ a: neck, b: hipC, r: COL_TORSO_R * h }];
      if (bones.hipL && bones.kneeL) caps.push({ a: bones.hipL.getWorldPosition(_v()), b: bones.kneeL.getWorldPosition(_v()), r: COL_THIGH_R * h });
      if (bones.hipR && bones.kneeR) caps.push({ a: bones.hipR.getWorldPosition(_v()), b: bones.kneeR.getWorldPosition(_v()), r: COL_THIGH_R * h });
      return { head: { c: headC, r: COL_HEAD_R * h }, caps, clear: COL_CLEAR * h };
    },

    // Worst (deepest) penetration of world point P into any proxy. Returns
    // { depth, normal } where depth>0 means inside (needs pushing out by `depth`
    // along `normal` to rest at surface + clearance), normal points OUTWARD.
    _worstPenetration(P, proxies) {
      let depth = 0, normal = null;
      const test = (q, r) => {
        const dx = P.x - q.x, dy = P.y - q.y, dz = P.z - q.z;
        const dist = Math.hypot(dx, dy, dz);
        const dep = (r + proxies.clear) - dist;
        if (dep > depth && dist > 1e-6) { depth = dep; normal = new THREE.Vector3(dx / dist, dy / dist, dz / dist); }
      };
      test(proxies.head.c, proxies.head.r);
      for (const cap of proxies.caps) test(_closestOnSeg(P, cap.a, cap.b, _v()), cap.r);
      return { depth, normal };
    },

    // Rotate a joint about its own pivot so that a descendant world point pW
    // swings toward world target tW (moves the whole subtree; used to steer a
    // hand/forearm out along the penetration normal).
    _steerJoint(jointRole, pW, tW) {
      const jb = bones[jointRole]; if (!jb) return;
      const pivot = jb.getWorldPosition(_v());
      const cur = pW.clone().sub(pivot), tgt = tW.clone().sub(pivot);
      if (cur.lengthSq() < 1e-10 || tgt.lengthSq() < 1e-10) return;
      _q.setFromUnitVectors(cur.normalize(), tgt.normalize());
      jb.getWorldQuaternion(_qp);
      const newWorld = _q.multiply(_qp);
      jb.parent.getWorldQuaternion(_qpp);
      jb.quaternion.copy(_qpp.invert().multiply(newWorld));
      jb.updateMatrixWorld(true);
    },

    // Resolve one arm out of the proxies: first steer with the SHOULDER (moves
    // the whole arm), then fine-correct with the ELBOW. Each phase iterates,
    // pushing the deepest-penetrating sample point out to the surface + clearance
    // and no further (so the hand comes to REST on the surface), capped at
    // COL_ITERS. Samples = wrist + two forearm points (+ elbow for the shoulder
    // phase, since the elbow is a shoulder descendant but the elbow's own pivot).
    _resolveArm(shoulderRole, elbowRole, wristRole, proxies) {
      // Samples run the whole arm surface: elbow, two forearm points, the wrist, and
      // — critically — the HAND itself, extrapolated past the wrist along the forearm
      // line (the rig's wrist bone stops at the palm, so fingers reach ~11cm further
      // and were clipping the face while the wrist cleared). Hand tip + mid-hand +
      // wrist all get pushed out, so the whole hand comes to rest on the surface.
      const samples = (withElbow) => {
        outer.updateMatrixWorld(true);
        const e = bones[elbowRole].getWorldPosition(_v());
        const w = bones[wristRole].getWorldPosition(_v());
        const handLen = COL_HAND * mann.height;
        const hd = w.clone().sub(e); const hand = hd.lengthSq() > 1e-9 ? hd.normalize() : new THREE.Vector3(0, -1, 0);
        const tip = w.clone().addScaledVector(hand, handLen);
        const pts = [tip, w.clone().addScaledVector(hand, handLen * 0.5), w.clone(), e.clone().lerp(w, 0.5), e.clone().lerp(w, 0.25)];
        if (withElbow) pts.push(e.clone());
        return pts;
      };
      const stepOnce = (jointRole, withElbow) => {
        let worst = null, worstP = null;
        for (const P of samples(withElbow)) {
          const pen = mann._worstPenetration(P, proxies);
          if (pen.depth > 0 && (!worst || pen.depth > worst.depth)) { worst = pen; worstP = P; }
        }
        if (!worst) return false;
        mann._steerJoint(jointRole, worstP, worstP.clone().addScaledVector(worst.normal, worst.depth));
        return true;
      };
      for (let i = 0; i < COL_ITERS; i++) if (!stepOnce(shoulderRole, true)) break;
      for (let i = 0; i < COL_ITERS; i++) if (!stepOnce(elbowRole, false)) break;
    },

    // Push both arms out of any self-intersection. Deterministic, no-op when the
    // pose is already clear (early break), cheap enough for every pose apply.
    _resolvePenetration() {
      if (!bones.head || !bones.hipL || !bones.hipR) return;
      const proxies = mann._collisionProxies();
      if (bones.shoulderL && bones.elbowL && bones.wristL) mann._resolveArm('shoulderL', 'elbowL', 'wristL', proxies);
      if (bones.shoulderR && bones.elbowR && bones.wristR) mann._resolveArm('shoulderR', 'elbowR', 'wristR', proxies);
      outer.updateMatrixWorld(true);
    },

    // COCO-17 in world space — read from real bone positions (exact, zero-ML).
    cocoWorld() {
      outer.updateMatrixWorld(true);
      const w = role => bones[role].getWorldPosition(_v());
      const up = new THREE.Vector3(0, 1, 0);
      const sL = w('shoulderL'), sR = w('shoulderR');
      const right = sR.clone().sub(sL).setY(0).normalize();
      const fwd = right.clone().cross(up).normalize(); if (fwd.z < 0) fwd.negate();
      const h = mann.height;
      const hc = w('head').addScaledVector(up, 0.045 * h);      // skull centre
      const face = (f, u, r) => hc.clone().addScaledVector(fwd, f * h).addScaledVector(up, u * h).addScaledVector(right, r * h);
      return {
        nose: face(0.078, 0.010, 0),
        left_eye: face(0.066, 0.028, -0.028), right_eye: face(0.066, 0.028, 0.028),
        left_ear: face(-0.006, 0.020, -0.072), right_ear: face(-0.006, 0.020, 0.072),
        left_shoulder: sL, right_shoulder: sR,
        left_elbow: w('elbowL'), right_elbow: w('elbowR'),
        left_wrist: w('wristL'), right_wrist: w('wristR'),
        left_hip: w('hipL'), right_hip: w('hipR'),
        left_knee: w('kneeL'), right_knee: w('kneeR'),
        left_ankle: w('ankleL'), right_ankle: w('ankleR'),
      };
    },
  };

  mann.setPose('stand');
  return mann;
}
