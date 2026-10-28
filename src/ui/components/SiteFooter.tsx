"use client";

import Link from "next/link";
import { LogoMark } from "./Logo";
import { useConfig } from "./Providers";
import styles from "./SiteFooter.module.css";

export const REPO_URL = "https://github.com/joyboyreturns/licensegraph";

export function SiteFooter() {
  const { config } = useConfig();
  const payments =
    config?.paymentsMode === "paypal-sandbox"
      ? "Payments run on the PayPal Sandbox: test accounts and test money only."
      : config?.paymentsMode === "simulator"
        ? "Payments on this server run on a local payment simulator. No money moves and no PayPal account is involved."
        : "Payments use the PayPal Sandbox or a local simulator. No real money moves.";

  return (
    <footer className={`${styles.footer} no-print`}>
      <div className={`container ${styles.grid}`}>
        <div className={styles.brand}>
          <div className={styles.brandRow}>
            <LogoMark size={22} />
            <strong>LicenseGraph</strong>
          </div>
          <p className="serif" style={{ fontSize: 20, lineHeight: 1.25, marginTop: 12 }}>
            AI moves at machine speed. Creator rights and payments should too.
          </p>
        </div>
        <div className={styles.notes}>
          <h2 className="eyebrow">How it is built</h2>
          <ul>
            <li>A model reads licences and proposes bundles. It never verifies its own work and never pays.</li>
            <li>The rules engine is deterministic code: the same terms always get the same verdict.</li>
            <li>{payments}</li>
            <li>Built-in scenarios replay recorded model output, and say so. Every number shown comes from the licences.</li>
          </ul>
        </div>
        <nav className={styles.links} aria-label="Footer">
          <h2 className="eyebrow">Explore</h2>
          <Link prefetch={false} href="/">Home</Link>
          <Link prefetch={false} href="/dashboard">Portfolio</Link>
          <Link prefetch={false} href="/agents">Agents</Link>
          <Link prefetch={false} href="/verify">Verify a passport</Link>
          <Link prefetch={false} href="/rules">How the rules work</Link>
          <a href={REPO_URL} rel="noreferrer">
            Source code (MIT)
          </a>
        </nav>
      </div>
      <div className={`container ${styles.base}`}>
        <span>Open source under the MIT licence.</span>
        <span>Not legal advice. Check important licences with a lawyer.</span>
      </div>
    </footer>
  );
}
