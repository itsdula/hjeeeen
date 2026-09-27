import { useState } from 'react';
import type { StageStatus } from '../../../types/hjen-bridge';

interface Warning {
  body: string;
  /** Optional click handler — typically scrolls/focuses the offending field. */
  onJump?: () => void;
}

interface Props {
  status: StageStatus;
  warnings: Warning[];
  onSign: () => void | Promise<void>;
  onUnsign?: () => void | Promise<void>;
  /** Label on the primary button while in draft. */
  label?: string;
}

/** Advisory Sign button (per plan: gating is soft).
 *  - Always allows signing.
 *  - Warnings are listed in a confirm dialog so the user *sees* what they're
 *    skipping past — visible discipline, not blocking discipline.
 *  - Once signed, the button flips to a status pill + "Unsign" affordance. */
export function SignButton({ status, warnings, onSign, onUnsign, label = 'Sign this stage' }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (status === 'signed') {
    return (
      <div className="stage-sign stage-sign--signed">
        <span className="stage-sign__pill">Signed</span>
        {onUnsign && (
          <button className="stage-sign__unsign" onClick={() => onUnsign()}>Reopen</button>
        )}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="stage-sign stage-sign--confirm" role="dialog" aria-label="Confirm sign">
        {warnings.length === 0 ? (
          <p className="stage-sign__clean">Nothing to flag. Sign and lock the stage?</p>
        ) : (
          <>
            <p className="stage-sign__warntitle">{warnings.length} thing{warnings.length === 1 ? '' : 's'} worth noting:</p>
            <ol className="stage-sign__warnlist">
              {warnings.map((w, i) => (
                <li key={i}>
                  <span>{w.body}</span>
                  {w.onJump && <button className="stage-sign__jump" onClick={() => { setConfirming(false); w.onJump?.(); }}>show me</button>}
                </li>
              ))}
            </ol>
            <p className="stage-sign__advisory">Signing anyway is fine — the warnings are filed in the ledger.</p>
          </>
        )}
        <div className="stage-sign__actions">
          <button className="stage-sign__cancel" onClick={() => setConfirming(false)}>Cancel</button>
          <button className="stage-sign__commit" onClick={async () => { await onSign(); setConfirming(false); }}>Sign and lock</button>
        </div>
      </div>
    );
  }

  return (
    <button className="stage-sign__primary" onClick={() => setConfirming(true)}>
      {label}
      {warnings.length > 0 && <span className="stage-sign__count">{warnings.length}</span>}
    </button>
  );
}
