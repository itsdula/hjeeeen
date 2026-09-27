// لغة العرض — the Arabic reading line for the immersive Creative Mind scenes.
// A TRANSLATION of the English source (Settings → Content language), never the
// editable copy. Renders nothing in 'en' mode, while a translation is still in
// flight, or when the source is already Arabic — so the English never blanks.
// 'ar' mode reads as the primary line; 'both' sits as a quiet line beneath the
// source. Joined-letters law: serif, dir="rtl", letter-spacing 0 (styled dark to
// belong to the immersive scenes — see .cmind-arline in creativemind.css).
//
// A component (not a hook), so it is safe inside a list .map() — each instance
// owns its own translation subscription.

import type { FC } from 'react';
import { useAr, useLangMode } from '../../lib/lang/translate';

export const CmindAr: FC<{ text: string | null | undefined; className?: string }> = ({ text, className }) => {
  const mode = useLangMode();
  const ar = useAr(text ?? '');
  if (!ar) return null;
  return (
    <div
      className={`cmind-arline${mode === 'ar' ? ' cmind-arline--primary' : ''}${className ? ` ${className}` : ''}`}
      dir="rtl"
    >{ar}</div>
  );
};
