export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-foreground">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#0f4c47" />
        <path d="M6.5 7.5l5.5 10 5.5-10" fill="none" stroke="#f0fdfa" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <span className="text-lg">Verilo</span>}
    </span>
  );
}
