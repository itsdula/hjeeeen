import type { ModelId } from '../../types/catalog';

/** Pick a funded alternate image door only when the first OpenAI call explicitly
 *  says it produced nothing and was refunded. This is transport recovery for the
 *  SAME requested take, not an extra take and never a way around safety policy. */
export function refundedImageRecoveryModel(model: ModelId, message?: string): ModelId | null {
  if (model !== 'GPT_IMAGE_2') return null;
  const text = String(message || '');
  if (!/not charged/i.test(text)) return null;
  if (/safety|moderation|content[_ -]?policy|rejected/i.test(text)) return null;
  const unavailable = /provider error\s*\(429\)/i.test(text)
    || /openai.{0,100}(?:no api quota|rate limit|credits? remaining|quota)/i.test(text);
  return unavailable ? 'NANO_BANANA_PRO' : null;
}
