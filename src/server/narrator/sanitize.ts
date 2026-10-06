const MAX_WORDS = 14;

/** One clean in-character line from a model reply, or null when it doesn't qualify (then use a canned line). */
export function sanitizeLine(raw: string): string | null {
  const first = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!first) return null;
  const text = first
    .replace(/[*_`#>]/g, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/["“”]/g, '')
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/[\\/]/.test(text)) return null;
  const words = text.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  return words.slice(0, MAX_WORDS).join(' ');
}
