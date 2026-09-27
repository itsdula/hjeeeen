// لغة العرض — the Arabic reading line for the preprod prose views (Treatment ·
// Story). A TRANSLATION of the English source (Settings → Content language),
// never the editable copy. Renders nothing in 'en' mode, while a translation is
// still in flight, or when the source is already Arabic — so the English source
// never blanks. In 'ar' mode it reads as the primary line; in 'both' it sits as
// a quiet reading line beneath the source. Joined-letters law: serif face,
// dir="rtl", never a mono/tracked class (styled in preprod.css).
//
// Rendered as a component (not a hook), so it is safe to place inside a list
// .map() — each instance owns its own translation subscription.

import type { FC } from 'react';
import { useAr, useLangMode } from '../../lib/lang/translate';

export const ArText: FC<{ text: string | null | undefined; className?: string }> = ({ text, className }) => {
  const mode = useLangMode();
  const ar = useAr(text ?? '');
  if (!ar) return null;
  return (
    <div
      className={`pp-arline${mode === 'ar' ? ' pp-arline--primary' : ''}${className ? ` ${className}` : ''}`}
      dir="rtl"
    >{ar}</div>
  );
};
