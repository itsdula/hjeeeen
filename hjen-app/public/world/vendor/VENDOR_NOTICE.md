# Vendored three.js addons

These files are vendored offline (no CDN at runtime) to match the pinned
`three.module.js` (r160) used by HJEN SET / World / Film Space.

| File | Source | Version | License |
|------|--------|---------|---------|
| `three.module.js` | three.js core | r160 | MIT |
| `GLTFLoader.js` | three.js `examples/jsm/loaders/GLTFLoader.js` | r160 | MIT |
| `BufferGeometryUtils.js` | three.js `examples/jsm/utils/BufferGeometryUtils.js` | r160 | MIT |
| `PLYLoader.js` | three.js `examples/jsm/loaders/PLYLoader.js` | r160 | MIT |
| `TransformControls.js` | three.js `examples/jsm/controls/TransformControls.js` | r160 | MIT |
| `gaussian-splats-3d.module.js` | mkkellogg/GaussianSplats3D | vendored | MIT |

Retrieved 2026-07-20 from
`https://github.com/mrdoob/three.js/tree/r160/examples/jsm`.

Local edit: `GLTFLoader.js` — the single relative import of
`../utils/BufferGeometryUtils.js` was repointed to `./BufferGeometryUtils.js`
so both live in this one vendor directory. No other changes.

three.js is Copyright © 2010-2024 three.js authors, MIT License
(https://github.com/mrdoob/three.js/blob/dev/LICENSE).
