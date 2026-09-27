// Video model registry — the ONE capability descriptor the Video UI reads to
// render per-model controls (durations, modes, ratios, which extra fields to
// show). Adding a future model = one entry here; the adapter that runs it is
// chosen by `provider`.
//
// Two backends today:
//   • seedance — BytePlus ModelArk (src/lib/seedance.ts).       flags-in-prompt.
//   • kling    — Kuaishou Kling    (src/lib/kling.ts).          structured JSON.
//
// Capability facts for Kling are taken from the live Kling "Video Capability
// Map" (kling.ai/document-api/guides/capability-map/video). cfg_scale is NOT
// supported on kling-v2.x. `mode` maps std=720P · pro=1080P · 4k=4K.

export type VideoProvider = 'seedance' | 'kling';

export interface VideoModelFeatures {
  /** Native audio generation (sound on/off). */
  audio: boolean;
  /** First-frame (start image) anchor. */
  firstFrame: boolean;
  /** Last-frame anchor (image_tail / end frame). */
  endFrame: boolean;
  negativePrompt: boolean;
  cfgScale: boolean;
  /** Explicit camera_control protocol (preset moves + 6-axis). */
  cameraControl: boolean;
  /** Motion Brush (static/dynamic masks). */
  motionBrush: boolean;
  /** Multi-shot storyboarding (multi_prompt). */
  multiShot: boolean;
}

export interface VideoModelDescriptor {
  /** UI id — for Kling this equals the API `model_name`. */
  id: string;
  /** Vendor-facing model id actually sent on the wire. */
  apiModelId: string;
  label: string;
  provider: VideoProvider;
  blurb?: string;
  /** Kling only — std/pro/4k. */
  modes?: Array<'std' | 'pro' | '4k'>;
  /** Seedance only — its resolution ladder. */
  resolutions?: Array<'480p' | '720p' | '1080p' | '4k'>;
  /** Allowed durations in seconds. */
  durations: number[];
  /** Allowed aspect ratios (text-to-video; image mode derives from the image). */
  aspectRatios: string[];
  features: VideoModelFeatures;
}

// Full 3–15s range for the flagship Kling generations.
const D_3_15 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const D_3_10 = [3, 4, 5, 6, 7, 8, 9, 10];
const KLING_RATIOS = ['16:9', '9:16', '1:1'];

const KF = (o: Partial<VideoModelFeatures>): VideoModelFeatures => ({
  audio: false, firstFrame: true, endFrame: false, negativePrompt: true,
  cfgScale: true, cameraControl: false, motionBrush: false, multiShot: false, ...o,
});

export const VIDEO_MODELS: VideoModelDescriptor[] = [
  // ── Seedance (unchanged backend) ─────────────────────────────────────────
  {
    id: 'seedance-2.0', apiModelId: 'dreamina-seedance-2-0-260128', label: 'Seedance 2.0', provider: 'seedance',
    blurb: 'BytePlus. Image-to-motion, first/end-frame anchors, up to 4K.',
    resolutions: ['480p', '720p', '1080p', '4k'],
    durations: [5, 10],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    features: { audio: true, firstFrame: true, endFrame: true, negativePrompt: false, cfgScale: false, cameraControl: false, motionBrush: false, multiShot: false },
  },

  // ── Kling family (Kuaishou) ──────────────────────────────────────────────
  {
    id: 'kling-3.0-turbo', apiModelId: 'kling-3.0-turbo', label: 'Kling 3.0 Turbo', provider: 'kling',
    blurb: 'Best value flagship. Native audio. 720P/1080P.',
    modes: ['std', 'pro'], durations: D_3_15, aspectRatios: KLING_RATIOS,
    features: KF({ audio: true, endFrame: true, multiShot: true }),
  },
  {
    id: 'kling-v3', apiModelId: 'kling-v3', label: 'Kling 3.0', provider: 'kling',
    blurb: 'Flagship. Multi-shot, element consistency, up to 4K.',
    modes: ['std', 'pro', '4k'], durations: D_3_15, aspectRatios: KLING_RATIOS,
    features: KF({ audio: true, endFrame: true, multiShot: true }),
  },
  {
    id: 'kling-v3-omni', apiModelId: 'kling-v3-omni', label: 'Kling 3.0 Omni', provider: 'kling',
    blurb: 'Multimodal in/out, voice-driven characters, storyboards, up to 4K.',
    modes: ['std', 'pro', '4k'], durations: D_3_15, aspectRatios: KLING_RATIOS,
    features: KF({ audio: true, endFrame: true, multiShot: true }),
  },
  {
    id: 'kling-video-o1', apiModelId: 'kling-video-o1', label: 'Kling O1', provider: 'kling',
    blurb: 'Unified model, exceptional consistency, video reference.',
    modes: ['std', 'pro'], durations: D_3_10, aspectRatios: KLING_RATIOS,
    features: KF({ audio: false, endFrame: true }),
  },
  {
    id: 'kling-v2-6', apiModelId: 'kling-v2-6', label: 'Kling 2.6', provider: 'kling',
    blurb: 'Native audio + lip-sync + motion control.',
    modes: ['std', 'pro'], durations: D_3_10, aspectRatios: KLING_RATIOS,
    features: KF({ audio: true, endFrame: true, cfgScale: false }),
  },
  {
    id: 'kling-v2-5-turbo', apiModelId: 'kling-v2-5-turbo', label: 'Kling 2.5 Turbo', provider: 'kling',
    blurb: 'Speed + value.',
    modes: ['std', 'pro'], durations: [5, 10], aspectRatios: KLING_RATIOS,
    features: KF({ audio: false, endFrame: false, cfgScale: false }),
  },
  // Legacy — selectable, conservative capabilities. cfg_scale + classic camera
  // control live here (Capability Map marks camera control off on 2.x/3.x).
  {
    id: 'kling-v1-6', apiModelId: 'kling-v1-6', label: 'Kling 1.6', provider: 'kling',
    blurb: 'Legacy. First/last-frame lock, camera control.',
    modes: ['std', 'pro'], durations: [5, 10], aspectRatios: KLING_RATIOS,
    features: KF({ endFrame: true, cameraControl: true }),
  },
  {
    id: 'kling-v2-1', apiModelId: 'kling-v2-1', label: 'Kling 2.1', provider: 'kling',
    blurb: 'Legacy value tier.',
    modes: ['std', 'pro'], durations: [5, 10], aspectRatios: KLING_RATIOS,
    features: KF({ endFrame: true, cfgScale: false }),
  },
];

export const videoModelById = (id: string): VideoModelDescriptor | undefined =>
  VIDEO_MODELS.find(m => m.id === id || m.apiModelId === id);

export const klingModels = (): VideoModelDescriptor[] => VIDEO_MODELS.filter(m => m.provider === 'kling');
