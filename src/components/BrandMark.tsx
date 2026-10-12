export function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <rect x="1" y="1" width="32" height="32" rx="7" fill="#ff8a3d" />
        <g transform="translate(1 1) scale(0.25)">
          <circle cx="38" cy="94" r="11" fill="none" stroke="#0d1210" strokeWidth={8} />
          <path d="M38 80V58L78 30" fill="none" stroke="#0d1210" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="92,20 82.3,37.7 72.1,22.9" fill="#0d1210" />
          <path d="M80 82L104 106M104 82L80 106" fill="none" stroke="#0d1210" strokeWidth={8} strokeLinecap="round" />
        </g>
        </svg>
      <span className="font-display text-[26px] font-extrabold tracking-[0.02em]">
        SCOUTCARD <span className="text-primary">AI</span>
      </span>
    </div>
  );
}
