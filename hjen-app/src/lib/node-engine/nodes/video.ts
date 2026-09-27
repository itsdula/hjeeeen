// Video node — image → motion via Seedance 2. runSeedance saves the clip and
// streams progress; we bridge that to ctx.report.

import type { NodeSpec, ImageValue, TextValue, VideoValue } from '../types';
import { runSeedance, slugifyPrompt, type SeedanceResolution, type SeedanceRatio } from '../../seedance';

const RATIOS: Array<{ value: string; label: string }> = [
  { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' }, { value: '21:9', label: '21:9' },
];

export function makeVideoSpec(): NodeSpec {
  return {
    type: 'video',
    label: 'Video',
    sub: 'Image → motion · Seedance 2',
    accent: '#E41A2F',
    flow: 'control',
    opens: 'video',
    params: [
      { name: 'image', label: 'First frame', kind: 'input', dataType: 'image', optional: true },
      { name: 'endImage', label: 'End frame', kind: 'input', dataType: 'image', optional: true },
      { name: 'promptIn', label: 'Prompt in', kind: 'input', dataType: 'text', optional: true },
      { name: 'prompt', label: 'Prompt', kind: 'property', dataType: 'text', control: 'textarea', default: '', batchable: true },
      { name: 'resolution', label: 'Resolution', kind: 'property', dataType: 'text', control: 'select', default: '720p', options: [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '4k', label: '4K' }] },
      { name: 'duration', label: 'Duration (s)', kind: 'property', dataType: 'number', control: 'number', default: 5 },
      { name: 'ratio', label: 'Ratio', kind: 'property', dataType: 'text', control: 'select', default: '16:9', options: RATIOS },
      { name: 'out', label: 'Video', kind: 'output', dataType: 'video' },
    ],
    async process(ctx) {
      const img = ctx.inputs.image as ImageValue | undefined;
      const end = ctx.inputs.endImage as ImageValue | undefined;
      const pIn = ctx.inputs.promptIn as TextValue | undefined;
      const prompt = (pIn?.text || String(ctx.props.prompt ?? '')).trim();
      if (!prompt && !img?.path) throw new Error('Video needs a prompt or a first-frame image.');

      const ratio = (String(ctx.props.ratio ?? '16:9')) as SeedanceRatio;
      const duration = Number(ctx.props.duration ?? 5);

      const res = await runSeedance(
        {
          prompt: prompt || 'cinematic motion',
          imagePath: img?.path ?? null,
          endImagePath: end?.path ?? null,
          resolution: (String(ctx.props.resolution ?? '720p')) as SeedanceResolution,
          duration,
          ratio,
          fps: 24,
        },
        {
          promptSlug: slugifyPrompt(prompt || 'video'),
          projectSlug: ctx.project?.slug,
          projectId: ctx.project?.id,
        },
        p => ctx.report(p.status || p.phase),
      );

      const out: VideoValue = {
        type: 'video',
        path: res.videoPath,
        posterPath: img?.path,
        ratio,
        seconds: duration,
      };
      return { out };
    },
  };
}
