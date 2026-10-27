/**
 * The LicenseGraph mark: a check drawn as a tiny graph. Two licence nodes link into a verified node,
 * which is the one lit node: the product in one glyph.
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="var(--logo-tile, var(--primary))" />
      <path d="M8 16.5 L13.5 22 L24 10.5" fill="none" stroke="var(--logo-ink, var(--primary-ink))" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.92" />
      <path d="M8 16.5 L18 9" fill="none" stroke="var(--logo-ink, var(--primary-ink))" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="1.6 2.4" opacity="0.5" />
      <circle cx="8" cy="16.5" r="2.6" fill="var(--logo-tile, var(--primary))" stroke="var(--logo-ink, var(--primary-ink))" strokeWidth="1.8" />
      <circle cx="13.5" cy="22" r="2.6" fill="var(--logo-tile, var(--primary))" stroke="var(--logo-ink, var(--primary-ink))" strokeWidth="1.8" />
      <circle cx="24" cy="10.5" r="3.4" fill="var(--ok-solid)" />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoMark size={size} />
      <span style={{ fontWeight: 650, fontSize: Math.round(size * 0.62), letterSpacing: "-0.02em", lineHeight: 1 }}>
        License<span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 400, fontSize: "1.12em", letterSpacing: "-0.01em" }}>Graph</span>
      </span>
    </span>
  );
}
