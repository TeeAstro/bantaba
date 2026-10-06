// Where to go after signing in, from ?next=. Only a path on this site:
// security review (Phase 21b) found "/\evil.com" got through the old check
// (browsers read the backslash as "//", another site).
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const u = new URL(next, 'https://bantaba.invalid');
    return u.origin === 'https://bantaba.invalid' ? `${u.pathname}${u.search}${u.hash}` : fallback;
  } catch {
    return fallback;
  }
}
