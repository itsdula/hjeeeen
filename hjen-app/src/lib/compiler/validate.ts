// Saudi DNA Layer — output validation. Cheap deterministic checks on the
// compiled prompt; catches drift the LLM let through. Fixes are additive
// (append explicit negatives) so we never mangle the compiled text.
import { normalizeArabic } from './retrieve';

interface DriftRule {
  /** Pattern that indicates drift IF the user never asked for it. */
  pattern: RegExp;
  /** Only fires when the user's own prompt does NOT mention it. */
  userException: RegExp | null;
  fix: string;
}

const DRIFT_RULES: DriftRule[] = [
  {
    pattern: /falcon/i,
    userException: /falcon|صقر/i,
    fix: ' No falcon in frame.',
  },
  {
    pattern: /traditional (saudi|arab) (outfit|dress|clothing)/i,
    userException: null,
    fix: ' Specify garments precisely: Saudi thobe with standing two-button collar; red-white shemagh or white ghutra with black igal — never generic "traditional outfit".',
  },
  {
    pattern: /middle.?eastern/i,
    userException: null,
    fix: ' This is SAUDI, not generic "Middle Eastern" — keep it local and specific.',
  },
];

export interface ValidationResult {
  prompt: string;
  flags: string[];
}

export function validateCompiledPrompt(compiled: string, userPrompt: string): ValidationResult {
  let out = compiled;
  const flags: string[] = [];
  const userNorm = normalizeArabic(userPrompt);

  for (const rule of DRIFT_RULES) {
    const userAskedForIt = rule.userException ? rule.userException.test(userPrompt) || rule.userException.test(userNorm) : false;
    if (rule.pattern.test(out) && !userAskedForIt) {
      out = out + rule.fix;
      flags.push(rule.pattern.source);
    }
  }
  return { prompt: out, flags };
}
