// Model registry the MCP advertises — the abstraction layer:
// one make-tool + a `model` param the agent resolves from here, instead of a
// tool per model. Mirrors app/src/lib/models.ts (image) + the Seedance video
// backend. House rule: costs are estimates, not promises.

export interface ModelInfo {
  id: string;              // agent-facing id used as the `model` param
  label: string;
  provider: 'openai' | 'google' | 'bytedance' | 'kling';
  apiModelId: string;
  capability: 'make-frame' | 'make-video';
  nativeMaxMP?: number;
  notes?: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'GPT_IMAGE_2', label: 'ChatGPT Image 2.0', provider: 'openai',
    apiModelId: 'gpt-image-2', capability: 'make-frame', nativeMaxMP: 8.3,
    notes: 'Default frame model. Photoreal, strong typography, up to 3840px long edge; supports reference images (edit).',
  },
  {
    id: 'NANO_BANANA_PRO', label: 'Nano Banana Pro', provider: 'google',
    apiModelId: 'imagen-3.0-generate-002', capability: 'make-frame', nativeMaxMP: 8.3,
    notes: 'Alt frame model (Google). Multi-image blend + character consistency.',
  },
  {
    id: 'SEEDANCE_2', label: 'Seedance 2.0', provider: 'bytedance',
    apiModelId: 'seedance-2.0', capability: 'make-video',
    notes: 'HJEN video backend (BytePlus ModelArk). Image-to-motion, first/end-frame anchors, 5/10s, up to 4K. Async — returns a jobId.',
  },
  // Kling (Kuaishou) — direct API. `model` values on hjen_video_make map to these.
  {
    id: 'KLING_3', label: 'Kling 3.0', provider: 'kling',
    apiModelId: 'kling-v3', capability: 'make-video',
    notes: 'Kling flagship. Text/image-to-video, 3–15s, up to 4K, native audio, multi-shot. mode: std=720P/pro=1080P/4k. Async — returns a jobId.',
  },
  {
    id: 'KLING_3_TURBO', label: 'Kling 3.0 Turbo', provider: 'kling',
    apiModelId: 'kling-3.0-turbo', capability: 'make-video',
    notes: 'Best-value Kling flagship with native audio, 720P/1080P, 3–15s.',
  },
  {
    id: 'KLING_3_OMNI', label: 'Kling 3.0 Omni', provider: 'kling',
    apiModelId: 'kling-v3-omni', capability: 'make-video',
    notes: 'Kling multimodal (voice-driven, storyboards), up to 4K, 3–15s.',
  },
  {
    id: 'KLING_2_6', label: 'Kling 2.6', provider: 'kling',
    apiModelId: 'kling-v2-6', capability: 'make-video',
    notes: 'Kling native-audio + lip-sync + motion control. 720P/1080P, 3–10s.',
  },
  {
    id: 'KLING_2_5_TURBO', label: 'Kling 2.5 Turbo', provider: 'kling',
    apiModelId: 'kling-v2-5-turbo', capability: 'make-video',
    notes: 'Kling speed/value tier. 720P/1080P, 5/10s.',
  },
];

export const listModels = (capability?: ModelInfo['capability']) =>
  capability ? MODELS.filter(m => m.capability === capability) : MODELS;
