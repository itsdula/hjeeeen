import assert from 'node:assert/strict';
import { refundedImageRecoveryModel } from '../src/lib/reference-maker/providerRecovery';

assert.equal(
  refundedImageRecoveryModel('GPT_IMAGE_2', 'Provider error (429) — you were not charged.'),
  'NANO_BANANA_PRO',
);
assert.equal(
  refundedImageRecoveryModel('GPT_IMAGE_2', "HJEN's OpenAI image provider account has no API quota. Your HJEN credits were not charged."),
  'NANO_BANANA_PRO',
);
assert.equal(
  refundedImageRecoveryModel('GPT_IMAGE_2', "OpenAI's shared image rate limit stayed busy. Your HJEN credits were not charged."),
  'NANO_BANANA_PRO',
);
assert.equal(refundedImageRecoveryModel('GPT_IMAGE_2', 'Provider error (429).'), null, 'never recover unless the first call was explicitly refunded');
assert.equal(refundedImageRecoveryModel('NANO_BANANA_PRO', 'Provider error (429) — you were not charged.'), null, 'never bounce back to OpenAI');
assert.equal(refundedImageRecoveryModel('GPT_IMAGE_2', 'The safety filter rejected this request — you were not charged.'), null, 'a provider fallback must not bypass a safety rejection');

console.log('reference maker provider recovery: 6/6 passed');
