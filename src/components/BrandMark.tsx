export function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <rect x="1" y="1" width="32" height="32" rx="7" fill="#ff8a3d" />
        <circle cx="12" cy="20" r="5" fill="none" stroke="#0d1210" strokeWidth={2.6} />
        <path d="M19 8L27 16M27 8L19 16" stroke="#0d1210" strokeWidth={2.6} strokeLinecap="round" />
      </svg>
      <span className="font-display text-[26px] font-extrabold tracking-[0.02em]">
        SCOUTCARD <span className="text-primary">AI</span>
      </span>
    </div>
  );
}
