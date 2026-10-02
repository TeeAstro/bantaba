// The Bantaba logo (docs/brand.md): a bantaba tree, its canopy over three
// people gathered beneath, next to the lowercase wordmark. "host" marks the
// organizer, staff and admin app. Concept artwork: swap the mark here when
// the final logo is ready; every screen uses this component.

export function LogoMark({ size = 28, canopy = '#60a5fa', trunk = '#ffffff' }: { size?: number; canopy?: string; trunk?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 76 76" aria-hidden="true" focusable="false">
      <path d="M8 34 C8 14 68 14 68 34 Z" fill={canopy} />
      <rect x="35" y="33" width="6" height="22" rx="2" fill={trunk} />
      <circle cx="16" cy="62" r="5" fill="#e11d48" />
      <circle cx="38" cy="66" r="5" fill="#e11d48" />
      <circle cx="60" cy="62" r="5" fill="#e11d48" />
    </svg>
  );
}

/** `onDark`: white wordmark for the ink sidebar and scanner; otherwise ink on light backgrounds. */
export function Logo({ host = true, size = 22, onDark = true }: { host?: boolean; size?: number; onDark?: boolean }) {
  const label = host ? 'Bantaba Host' : 'Bantaba';
  return (
    <span className={`logo ${onDark ? '' : 'logo-on-light'}`} role="img" aria-label={label}>
      <LogoMark size={Math.round(size * 1.3)} canopy={onDark ? '#60a5fa' : '#1e3a8a'} trunk={onDark ? '#ffffff' : '#0f172a'} />
      <span className="logo-word" style={{ fontSize: size }} aria-hidden="true">bantaba</span>
      {host && <span className="logo-host" style={{ fontSize: Math.round(size * 0.68) }} aria-hidden="true">host</span>}
    </span>
  );
}
