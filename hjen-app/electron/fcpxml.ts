// fcpxml.ts — write a sequence as FCPXML 1.9, with real lanes.
//
// Pure, like ffmpegGraph.ts: clips in, a string out. That is what makes it
// testable and what keeps the shipped emitter at main.ts:6694 untouched — this
// one goes out on its own channel so a conformance problem in a new file can
// never break a working one.
//
// WHAT IT ADDS over the shipped flat spine:
//   · lanes — lane="1" for a video track above the base, lane="-1" and down
//     for audio, which is how FCPXML expresses "over" and "under"
//   · <gap> — a hole in the timeline is a gap element, not a silent slide-left
//   · in-points — `start` on the clip is what makes srcIn real in an NLE
//   · <asset-clip> vs <audio> — an audio-only asset is not a picture clip
//
// TIMEBASE. Integer fps only. `rt()` is a rational of the form N/FPSs, which is
// exact at 24/25/30/50/60 and silently wrong at 23.976 or 29.97 — so the UI
// does not offer them rather than emit XML that drifts a frame a minute.

export interface FcpClip {
  kind: 'video' | 'image' | 'audio';
  src: string;
  start: number;
  dur: number;
  srcIn: number;
  gain: number;
  hasAudio: boolean;
  /** 0 = the base video track, 1..n above it; negative = an audio track. */
  lane: number;
  label?: string;
}

export interface FcpOpts {
  width: number;
  height: number;
  fps: number;
  total: number;
  projectName?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildFcpxml(clips: FcpClip[], o: FcpOpts): string {
  const FPS = Math.max(1, Math.round(o.fps));
  const rt = (sec: number) => `${Math.round(sec * FPS)}/${FPS}s`;
  const total = Math.max(o.total, clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0));

  // One asset per distinct FILE — an NLE relinks by asset, so emitting the same
  // file five times as five assets makes the user relink it five times.
  const assets: string[] = [];
  const assetId = new Map<string, string>();
  const idFor = (c: FcpClip): string => {
    const hit = assetId.get(c.src);
    if (hit) return hit;
    const id = `r${assets.length + 2}`;                       // r1 is the format
    assetId.set(c.src, id);

    // ONE asset per file, described by EVERY use of it — not by whichever use
    // happened to be emitted first. A video dropped on a picture track brings
    // its sound down as a linked clip on an audio track; that file is therefore
    // both a video use and an audio use. Describing it from the audio use alone
    // writes hasVideo="0", and the picture silently vanishes on import.
    const uses = clips.filter(x => x.src === c.src);
    const anyVideo = uses.some(x => x.kind !== 'audio');
    const anyAudio = uses.some(x => x.kind === 'audio' || x.hasAudio);
    const isImg = uses.every(x => x.kind === 'image');
    // The duration must cover the longest use INCLUDING its in-point, or an NLE
    // clamps the clip on import.
    const longest = uses.reduce((m, x) => Math.max(m, x.srcIn + x.dur), 0);
    // Name it after a picture use when there is one — that is the name an
    // editor will recognise in the media pool.
    const named = uses.find(x => x.kind !== 'audio') ?? c;
    const name = esc((named.label || c.src.split('/').pop() || 'clip').replace(/\.[^.]+$/, ''));

    assets.push(
      `    <asset id="${id}" name="${name}" src="${esc(`file://${encodeURI(c.src)}`)}" `
      + `start="0s" duration="${isImg ? '0s' : rt(longest)}" `
      + `hasVideo="${anyVideo ? 1 : 0}" hasAudio="${anyAudio ? 1 : 0}"`
      + `${anyVideo ? ' format="r1"' : ''}/>`,
    );
    return id;
  };

  // The base video track owns the spine; everything else hangs off it as a
  // lane. That is the FCPXML idiom — there is no "track" element.
  const base = clips.filter(c => c.lane === 0).sort((a, b) => a.start - b.start);
  const above = clips.filter(c => c.lane > 0).sort((a, b) => a.start - b.start);
  const audio = clips.filter(c => c.lane < 0).sort((a, b) => a.start - b.start);

  const body: string[] = [];
  let cursor = 0;
  const gap = (at: number, dur: number, children: string[]) => {
    body.push(`        <gap name="Gap" offset="${rt(at)}" start="0s" duration="${rt(dur)}">`);
    body.push(...children);
    body.push('        </gap>');
  };

  // A lane child is attached to the ONE spine segment its START falls inside,
  // and only that one.
  //
  // The obvious alternative — attach it to every segment it overlaps — produces
  // a file that looks right and imports wrong: a seven-second music bed lying
  // across three base segments becomes THREE stacked copies of the music. A
  // lane item is a connected clip; its length is independent of the item it
  // hangs from and it may extend past it, which is exactly what we want.
  const startsIn = (c: FcpClip, from: number, to: number) => c.start >= from - 1e-6 && c.start < to - 1e-6;

  const laneChild = (c: FcpClip, parentStart: number, indent: string): string => {
    const off = rt(Math.max(0, c.start - parentStart));
    const name = esc(c.label || c.src.split('/').pop() || 'clip');
    const ref = idFor(c);
    const vol = c.gain < 0.999
      ? `\n${indent}  <adjust-volume amount="${(20 * Math.log10(Math.max(0.0001, c.gain))).toFixed(1)}dB"/>`
      : '';
    if (c.lane < 0 && c.kind === 'audio') {
      return `${indent}<audio ref="${ref}" lane="${c.lane}" offset="${off}" name="${name}" `
        + `start="${rt(c.srcIn)}" duration="${rt(c.dur)}" role="dialogue">${vol}${vol ? `\n${indent}` : ''}</audio>`;
    }
    return `${indent}<asset-clip ref="${ref}" lane="${c.lane}" offset="${off}" name="${name}" `
      + `start="${c.kind === 'image' ? '0s' : rt(c.srcIn)}" duration="${rt(c.dur)}">${vol}${vol ? `\n${indent}` : ''}</asset-clip>`;
  };

  const emitSegment = (from: number, to: number, isGap: boolean, baseClip?: FcpClip) => {
    const kids = [...above, ...audio]
      .filter(c => startsIn(c, from, to))
      .map(c => laneChild(c, from, '          '));
    if (isGap) { gap(from, to - from, kids); return; }
    const c = baseClip!;
    const name = esc(c.label || c.src.split('/').pop() || 'clip');
    const open = `        <asset-clip ref="${idFor(c)}" offset="${rt(c.start)}" name="${name}" `
      + `start="${c.kind === 'image' ? '0s' : rt(c.srcIn)}" duration="${rt(c.dur)}">`;
    body.push(open);
    body.push(...kids);
    body.push('        </asset-clip>');
  };

  for (const c of base) {
    if (c.start > cursor + 0.5 / FPS) { emitSegment(cursor, c.start, true); }
    emitSegment(c.start, c.start + c.dur, false, c);
    cursor = c.start + c.dur;
  }
  if (total > cursor + 0.5 / FPS) emitSegment(cursor, total, true);
  // A sequence made only of upper-lane clips still has to hang off something.
  if (!base.length && !body.length && total > 0) emitSegment(0, total, true);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="HJEN ${o.width}x${o.height}p${FPS}" frameDuration="1/${FPS}s" width="${o.width}" height="${o.height}"/>
${assets.join('\n')}
  </resources>
  <library>
    <event name="HJEN Studio">
      <project name="${esc(o.projectName || 'Sequence')}">
        <sequence format="r1" duration="${rt(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${body.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
