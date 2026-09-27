// ffmpegGraph.ts — turn a flattened sequence into ONE ffmpeg filter graph.
//
// No Electron imports, no filesystem, no side effects: it takes clips and gives
// back arguments and a filter script. That is deliberate — the graph is the one
// part of the export that cannot be verified by reading, so it must be runnable
// from plain node against real fixture files before any UI exists.
//
// WHY ONE PASS. The shipped exporter normalises each clip to its own temp mp4
// and `concat -c copy`s them. That cannot overlay, cannot mix, cannot insert a
// gap, and throws the in-point away. Grafting those on means a per-track pass,
// a mix pass and an overlay pass — three to five full encodes, three to five
// times the wait, and generation loss at every hop. One graph is one decode,
// one encode, one progress stream, one thing to cancel.
//
// THE SHAPE. Per video track: a strict left-to-right `concat` of gap and clip
// segments, so the graph's working set is one clip per track. Then one
// `overlay` per upper track, gated by an `enable` expression that ORs that
// track's clip windows.
//
// The tempting alternative — one black canvas plus one overlay per CLIP,
// PTS-shifted — puts every decoder into a single framesync chain, and each one
// runs ahead buffering frames the chain will not consume until its enable
// window opens. On a sixty-clip timeline that is a memory cliff.
//
// Audio: a silence bed of exactly `total`, plus one delayed, gained branch per
// audio clip, into a single `amix`.

export interface GraphClip {
  kind: 'video' | 'image' | 'audio';
  src: string;
  start: number;
  dur: number;
  srcIn: number;
  gain: number;
  hasAudio: boolean;
  /** 0 = the bottom video track, 1..n above it; negative = an audio track. */
  lane: number;
}

export interface GraphOpts {
  width: number;
  height: number;
  fps: number;
  total: number;
}

export interface BuiltGraph {
  /** Every `-i` group, in input-index order. */
  inputArgs: string[];
  /** The filter graph, newline-separated, for -filter_complex_script. */
  script: string;
  /** Whether [aout] exists. Always true today — the silence bed guarantees an
   *  audio stream, which every NLE prefers to a video-only file. */
  hasAudio: boolean;
  /** For the caller's log line. */
  inputCount: number;
}

/** Three decimals is a hundredth of a frame at 30fps — below any audible or
 *  visible difference, and it keeps the script short enough to read. */
const q = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);

export function buildGraph(clips: GraphClip[], o: GraphOpts): BuiltGraph {
  const W = Math.max(2, Math.round(o.width));
  const H = Math.max(2, Math.round(o.height));
  const F = Math.max(1, Math.round(o.fps));
  const T = Math.max(1 / F, o.total);

  // One `-i` group per decoded FILE WINDOW. A linked A/V pair with identical
  // in and out therefore decodes the file ONCE and takes [i:v] and [i:a] from
  // the same input.
  const groups: string[][] = [];
  const seen = new Map<string, number>();
  const input = (args: string[], key: string): number => {
    const hit = seen.get(key);
    if (hit !== undefined) return hit;
    const i = groups.length;
    groups.push(args);
    seen.set(key, i);
    return i;
  };

  const L: string[] = [];

  // Every video segment is normalised to the SAME size, sar, pixel format and
  // rate — `concat` refuses anything else. Identical to the shipped vf, plus
  // the setpts that concat needs.
  const VN = `scale=${W}:${H}:force_original_aspect_ratio=decrease,`
    + `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${F},format=yuv420p`;

  // ── one continuous stream per video track ────────────────────────────────
  const videoLanes = [...new Set(clips.filter(c => c.lane >= 0).map(c => c.lane))].sort((a, b) => a - b);
  const built: Array<{ label: string; windows: Array<[number, number]> }> = [];

  for (const lane of videoLanes) {
    const lc = clips.filter(c => c.lane === lane).sort((a, b) => a.start - b.start);
    const segs: string[] = [];
    const windows: Array<[number, number]> = [];
    let cursor = 0;
    let n = 0;

    const gap = (d: number) => {
      const l = `g${lane}_${n++}`;
      L.push(`color=c=black:s=${W}x${H}:r=${F}:d=${q(d)},format=yuv420p,setsar=1[${l}]`);
      segs.push(`[${l}]`);
    };

    for (const c of lc) {
      // Half a frame of slack: a gap thinner than one frame is rounding, not a hole.
      if (c.start > cursor + 0.5 / F) gap(c.start - cursor);
      const l = `c${lane}_${n++}`;
      if (c.kind === 'image') {
        const i = input(['-loop', '1', '-framerate', String(F), '-t', q(c.dur), '-i', c.src],
          `${c.src}|img|${q(c.dur)}`);
        L.push(`[${i}:v]${VN},trim=duration=${q(c.dur)},setpts=PTS-STARTPTS[${l}]`);
      } else {
        // -ss and -t BEFORE -i: fast input seek, and the decoder reads only the
        // window this clip needs.
        const i = input(['-ss', q(c.srcIn), '-t', q(c.dur), '-i', c.src],
          `${c.src}|${q(c.srcIn)}|${q(c.dur)}`);
        // tpad clones the last frame. A source that lands a few milliseconds
        // short of `dur` would otherwise shorten its segment — and because the
        // track is a concat, that slides EVERYTHING after it earlier.
        L.push(`[${i}:v]${VN},setpts=PTS-STARTPTS,`
          + `tpad=stop_mode=clone:stop_duration=${q(c.dur)},`
          + `trim=duration=${q(c.dur)},setpts=PTS-STARTPTS[${l}]`);
      }
      segs.push(`[${l}]`);
      windows.push([c.start, c.start + c.dur]);
      cursor = c.start + c.dur;
    }

    // Pad the track out to the full length so every overlay input exists from
    // 0 to T and framesync never waits on a stream that ended early.
    if (T > cursor + 0.5 / F) gap(T - cursor);
    if (!segs.length) continue;

    const out = `V${lane}`;
    L.push(segs.length === 1
      ? `${segs[0]}null[${out}]`
      : `${segs.join('')}concat=n=${segs.length}:v=1:a=0[${out}]`);
    built.push({ label: out, windows });
  }

  // ── composite: one overlay per UPPER track, gated by its clip windows ─────
  let cur = built[0]?.label;
  if (!cur) {
    L.push(`color=c=black:s=${W}x${H}:r=${F}:d=${q(T)},format=yuv420p,setsar=1[VBASE]`);
    cur = 'VBASE';
  }
  for (const b of built.slice(1)) {
    // '+' acts as OR on 0/1 terms. Half-open windows [s, e) so a butt cut never
    // double-enables on the boundary frame.
    const en = b.windows.map(([s, e]) => `(gte(t\\,${q(s)})*lt(t\\,${q(e)}))`).join('+') || '0';
    const out = `${cur}x`;
    L.push(`[${cur}][${b.label}]overlay=x=0:y=0:shortest=0:eof_action=pass:enable='${en}'[${out}]`);
    cur = out;
  }
  L.push(`[${cur}]trim=duration=${q(T)},setpts=PTS-STARTPTS,format=yuv420p[vout]`);

  // ── audio ────────────────────────────────────────────────────────────────
  // The silence bed makes amix's `duration=first` give an exact-length mix, and
  // guarantees an audio stream even on a silent timeline.
  const ac = clips.filter(c => c.lane < 0 && c.hasAudio !== false).sort((a, b) => a.start - b.start);
  const A: string[] = ['[abed]'];
  L.push(`anullsrc=r=48000:cl=stereo:d=${q(T)},asetpts=PTS-STARTPTS[abed]`);
  ac.forEach((c, k) => {
    const i = input(['-ss', q(c.srcIn), '-t', q(c.dur), '-i', c.src], `${c.src}|${q(c.srcIn)}|${q(c.dur)}`);
    const ms = Math.round(c.start * 1000);
    L.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,`
      + `atrim=duration=${q(c.dur)},asetpts=PTS-STARTPTS,`
      + `volume=${c.gain.toFixed(4)},`
      + `adelay=${ms}|${ms}:all=1,`
      + `apad=whole_dur=${q(T)},atrim=duration=${q(T)},asetpts=PTS-STARTPTS[a${k}]`);
    A.push(`[a${k}]`);
  });
  // normalize=0 is MANDATORY. The default divides every input by the input
  // count, so adding a second audio clip would silently halve the first.
  L.push(`${A.join('')}amix=inputs=${A.length}:duration=first:dropout_transition=0:normalize=0,`
    + `alimiter=level_in=1:level_out=1:limit=0.97,`
    + `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`);

  const script = L.join(';\n');
  // Newlines in a filter script are fine. '#' COMMENTS ARE NOT — comment support
  // landed after ffmpeg 6.0 and the bundled binary is 6.0, so the parser would
  // choke on one. Assert rather than discover it in a user's failed render.
  if (script.includes('#')) throw new Error('ffmpegGraph: "#" is not legal in a filter script on ffmpeg 6.0');

  return { inputArgs: groups.flat(), script, hasAudio: true, inputCount: groups.length };
}

/** The encode arguments that go around the graph. Split out so the fixture
 *  harness renders with exactly what the app renders with. */
export function encodeArgs(fps: number): string[] {
  return [
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-r', String(Math.max(1, Math.round(fps))),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
  ];
}
