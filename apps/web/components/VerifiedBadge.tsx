// The blue tick for organizers the platform has confirmed are who they say
// they are (docs/payouts.md, "Verified badge"). Used next to an
// organizer's name wherever buyers see it; the storefront will reuse it.
export function VerifiedBadge({ size = 18, label = 'Verified organizer' }: { size?: number; label?: string }) {
  return (
    <span className="verified" title={`${label}: confirmed by the platform team`} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 1.5l2.4 1.8 3-.2.9 2.9 2.5 1.7-.9 2.9.9 2.9-2.5 1.7-.9 2.9-3-.2L12 20.5l-2.4-1.8-3 .2-.9-2.9-2.5-1.7.9-2.9-.9-2.9 2.5-1.7.9-2.9 3 .2z"
        />
        <path fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M7.8 11.6l2.8 2.8 5.6-5.6" />
      </svg>
    </span>
  );
}
