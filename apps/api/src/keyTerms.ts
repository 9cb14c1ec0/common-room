// ElevenLabs Scribe v2 accepts a `keyterms` list that biases transcription toward words the
// model would otherwise mangle. The service rejects the whole request when any term breaks its
// limits, so terms are normalized here before they ever reach the database.
export const KEY_TERM_MAX_COUNT = 1000;
export const KEY_TERM_MAX_LENGTH = 50;
export const KEY_TERM_MAX_WORDS = 5;

const ILLEGAL_CHARACTERS = /[<>{}[\]\\]/;

export function keyTermProblem(term: string): string | undefined {
  if (term.length > KEY_TERM_MAX_LENGTH) return `must be ${KEY_TERM_MAX_LENGTH} characters or fewer`;
  if (term.split(/\s+/).length > KEY_TERM_MAX_WORDS) return `must be ${KEY_TERM_MAX_WORDS} words or fewer`;
  if (ILLEGAL_CHARACTERS.test(term)) return "cannot contain < > { } [ ] or \\";
  return undefined;
}

export function normalizeKeyTerms(input: string[]): { terms: string[]; rejected: string[]; overflow: number } {
  const terms: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let overflow = 0;
  for (const entry of input) {
    const term = entry.trim();
    if (!term) continue;
    if (keyTermProblem(term)) { rejected.push(term); continue; }
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (terms.length < KEY_TERM_MAX_COUNT) terms.push(term); else overflow += 1;
  }
  return { terms, rejected, overflow };
}
