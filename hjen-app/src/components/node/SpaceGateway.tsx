import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { planFromAsk } from '../../lib/space/plan';
import { getNodeSpec } from '../../lib/node-engine/registry';

/**
 * THE GATEWAY — what HJEN SPACE says before anything exists.
 *
 * It asks before it offers. One question, one field, and the four make-cards
 * demoted to a single quiet line: someone who already knows what they want is
 * never forced to describe it first.
 *
 * The answer wakes the agent, which lays out the production as pipelines. From
 * that moment the rail owns the top of the space and this screen is gone until
 * the canvas is empty again.
 */

/** The ten openers. APP CHROME IS ENGLISH (house law) — Arabic lives in decks
 *  and generated copy, never in the desktop's own voice. Index 0 ships; the
 *  rest stay here because the choice was made from a set, and the set is the
 *  argument for the one. */
export const OPENERS = [
  'What are we making today?',
  "What's on your mind?",
  'Where should we start?',
  'What do you want to see?',
  'Tell me the idea.',
  'What are we shooting?',
  'Describe the frame you want.',
  'What has to exist by Sunday?',
  'Give me the rough version.',
  "What's the work?",
];

/** Signed off in the lab: 34px question, sub-line on. */
const Q_SIZE = 34;

const BLANK_TOOLS = ['source', 'frame', 'video', 'set'] as const;
const BLANK_LABEL: Record<string, string> = { source: 'Subject', frame: 'Image', video: 'Video', set: 'Set' };
const BLANK_ICON: Record<string, React.ReactNode> = {
  source: <><circle cx="8" cy="15" r="3" /><path d="M13 4l4 7h-8z" /></>,
  frame: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 18l5-4 4 3 3-2 4 3" /></>,
  video: <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="M15 10l6-3v10l-6-3z" /></>,
  set: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 3v18M4 7.5l8 4.5 8-4.5" /></>,
};

const THINKING = ['Reading the ask', 'Naming what is missing', 'Laying out the production'];

export function SpaceGateway({ onBlank }: { onBlank: (type: string) => void }) {
  const setSpacePlan = useStore(s => s.setSpacePlan);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { const t = setTimeout(() => ta.current?.focus(), 80); return () => clearTimeout(t); }, []);

  // The lines are a courtesy, not a progress bar — they cycle while the one
  // real call is out, and stop on the last one rather than looping forever
  // pretending there is more happening.
  useEffect(() => {
    if (!busy) { setLine(0); return; }
    const t = setInterval(() => setLine(l => Math.min(l + 1, THINKING.length - 1)), 1500);
    return () => clearInterval(t);
  }, [busy]);

  const submit = async () => {
    const text = ask.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const res = await planFromAsk(text);
    setBusy(false);
    if (!res.ok || !res.plan) { setError(res.message || 'The planner did not answer.'); return; }
    setSpacePlan(res.plan);
  };

  if (busy) {
    return (
      <div className="sg sg--think">
        <div className="sg__echo" dir="auto">{ask}</div>
        <div className="sg__line mono-label"><span className="sg__dot" />{THINKING[line]}</div>
      </div>
    );
  }

  return (
    <div className="sg">
      <div className="sg__q" style={{ fontSize: Q_SIZE }}>{OPENERS[0]}</div>
      <div className="sg__sub">Describe it the way you'd say it out loud. I'll lay out the production — you run it.</div>

      <div className="sg__field">
        <textarea
          ref={ta}
          rows={3}
          value={ask}
          spellCheck={false}
          dir="auto"
          onChange={e => setAsk(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
          placeholder="e.g. KV campaign for SAR. Saudi family arriving at Riyadh station. 40 frames, OOH + social, three cities."
        />
        <button className="sg__go" disabled={!ask.trim()} onClick={() => void submit()}>
          Lay it out <kbd>⌘↵</kbd>
        </button>
      </div>

      {error && <div className="sg__err" role="alert">{error}</div>}

      <div className="sg__blank">
        <span className="sg__blankLbl">or start blank —</span>
        {BLANK_TOOLS.map(t => (
          <button key={t} className="sg__chip" onClick={() => onBlank(t)}
            style={{ ['--sg-c' as string]: getNodeSpec(t)?.accent ?? '#888' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{BLANK_ICON[t]}</svg>
            {BLANK_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
