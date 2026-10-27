"use client";

import { FlaskConical, LayoutGrid, Menu, Radio, ShieldCheck, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "./Logo";
import { useConfig } from "./Providers";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./SiteHeader.module.css";

const NAV = [
  { href: "/dashboard", label: "Portfolio", icon: LayoutGrid },
  { href: "/verify", label: "Verify a passport", icon: ShieldCheck },
];

export function StatusPills({ stacked = false }: { stacked?: boolean }) {
  const { config } = useConfig();
  if (!config) return <span className={styles.pillsPlaceholder} aria-hidden />;
  const pay =
    config.paymentsMode === "simulator"
      ? { label: "Payment simulator", title: "Payments run on a local simulator. No money moves and no PayPal account is used.", icon: FlaskConical, tone: "tone-neutral" }
      : config.paymentsMode === "paypal-sandbox"
        ? { label: "PayPal Sandbox", title: "Payments use the PayPal Sandbox: test accounts, no real money.", icon: Wallet, tone: "tone-engine" }
        : { label: "Payments off", title: "No payment backend is configured on this server.", icon: Wallet, tone: "tone-neutral" };
  const model =
    config.mode === "live"
      ? { label: "Live model", title: `A live model reads licences${config.model ? ` (${config.model})` : ""}. Built-in scenarios still replay recorded output.`, tone: "tone-agent" }
      : { label: "Replayed demo", title: "No model is connected. Built-in scenarios replay recorded model output; the rules engine and payments run for real.", tone: "tone-neutral" };
  const PayIcon = pay.icon;
  return (
    <div className={`${styles.pills} ${stacked ? styles.pillsStacked : ""}`}>
      <span className={`chip chip-sm ${model.tone}`} title={model.title}>
        <Radio aria-hidden />
        {model.label}
        <span className="visually-hidden">. {model.title}</span>
      </span>
      <span className={`chip chip-sm ${pay.tone}`} title={pay.title}>
        <PayIcon aria-hidden />
        {pay.label}
        <span className="visually-hidden">. {pay.title}</span>
      </span>
    </div>
  );
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className={`${styles.header} no-print`}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <div className={`container-wide ${styles.inner}`}>
        <Link href="/" className={styles.brand} aria-label="LicenseGraph home">
          <Wordmark size={26} />
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={styles.link} aria-current={pathname.startsWith(href) ? "page" : undefined}>
              <Icon aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        <div className={styles.desktopOnly}>
          <StatusPills />
        </div>
        <ThemeToggle />
        <button type="button" className={`btn btn-ghost btn-sm btn-icon ${styles.menuBtn}`} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className={styles.mobileMenu}>
          <nav aria-label="Main (mobile)">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={styles.mobileLink} aria-current={pathname.startsWith(href) ? "page" : undefined}>
                <Icon aria-hidden />
                {label}
              </Link>
            ))}
          </nav>
          <StatusPills stacked />
        </div>
      )}
    </header>
  );
}
