"use client";

import { ArrowLeft, CheckCircle2, FlaskConical, Lock, SearchX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/src/ui/lib/api";
import { formatMoney } from "@/src/ui/lib/format";
import { LogoMark } from "../Logo";
import { Spinner } from "../bits";
import styles from "./Checkout.module.css";

interface SimOrder {
  id: string;
  amountCents: number;
  currency: string;
  approved: boolean;
  captured: boolean;
  cancelUrl?: string;
}

type Load = { status: "loading" } | { status: "ready"; order: SimOrder } | { status: "missing"; message: string } | { status: "error"; message: string };

/** Where Cancel goes: the run the order belongs to, if the simulator recorded it, else back. */
function sameOriginPath(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname.startsWith("/run/") ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

export function Checkout() {
  const orderId = useSearchParams().get("order") ?? "";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Payment simulator · LicenseGraph";
    if (!orderId) {
      setLoad({ status: "missing", message: "This checkout link has no order id." });
      return;
    }
    api<SimOrder>(`/api/simulator/orders/${encodeURIComponent(orderId)}`)
      .then((order) => setLoad({ status: "ready", order }))
      .catch((e) => setLoad(e instanceof ApiError && e.status === 404 ? { status: "missing", message: e.message } : { status: "error", message: errorMessage(e) }));
  }, [orderId]);

  const approve = async () => {
    setApproving(true);
    setApproveError(null);
    try {
      const r = await api<{ returnUrl?: string }>(`/api/simulator/orders/${encodeURIComponent(orderId)}`, { method: "POST" });
      if (r.returnUrl) window.location.assign(r.returnUrl);
      else {
        setApproving(false);
        setLoad((l) => (l.status === "ready" ? { status: "ready", order: { ...l.order, approved: true } } : l));
      }
    } catch (e) {
      setApproveError(errorMessage(e));
      setApproving(false);
    }
  };

  const cancel = () => {
    const back = load.status === "ready" ? sameOriginPath(load.order.cancelUrl) : null;
    if (back) window.location.assign(back);
    else if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  };

  return (
    <div className={styles.page}>
      <div className={styles.banner} role="note">
        <FlaskConical aria-hidden />
        <span>
          <b>LicenseGraph payment simulator.</b> No money moves, no account is charged, and this is not PayPal.
        </span>
      </div>

      <div className={styles.sheet}>
        {load.status === "loading" && (
          <div className={styles.body} aria-busy="true">
            <div className="skeleton" style={{ height: 22, width: 180 }} />
            <div className="skeleton" style={{ height: 60, width: 240, marginTop: 18 }} />
            <div className="skeleton" style={{ height: 48, marginTop: 28 }} />
          </div>
        )}

        {(load.status === "missing" || load.status === "error") && (
          <div className={styles.body}>
            <span className={styles.stateIcon} aria-hidden>
              <SearchX />
            </span>
            <h1 className={styles.h1}>{load.status === "missing" ? "Order not found" : "Could not load the order"}</h1>
            <p className={styles.text}>
              {load.status === "error" || !orderId ? `${load.message} ` : ""}Simulated orders live in the server&rsquo;s memory, so a restarted server forgets them. Go back to the run and create the order again.
            </p>
            <Link prefetch={false} href="/dashboard" className="btn">
              <ArrowLeft aria-hidden /> Find your run in the portfolio
            </Link>
          </div>
        )}

        {load.status === "ready" && (
          <div className={styles.body}>
            <h1 className="visually-hidden">Approve a simulated payment</h1>
            <div className={styles.merchant}>
              <LogoMark size={36} />
              <div>
                <p className={styles.merchantName}>LicenseGraph demo</p>
                <p className={styles.merchantSub}>Licence bundle checkout</p>
              </div>
            </div>
            <div className={styles.amountBlock}>
              <span className={styles.amountLabel}>Amount</span>
              <span className={`${styles.amount} num`}>{formatMoney(load.order.amountCents, load.order.currency)}</span>
              <span className={styles.currency}>{load.order.currency}, simulated</span>
            </div>
            <dl className={styles.details}>
              <div>
                <dt>Order</dt>
                <dd>
                  <code>{load.order.id}</code>
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{load.order.captured ? "Paid" : load.order.approved ? "Approved, waiting for capture" : "Waiting for your approval"}</dd>
              </div>
            </dl>

            {load.order.captured ? (
              <div className={styles.done}>
                <CheckCircle2 aria-hidden />
                <div>
                  <p>
                    <b>This order is already paid.</b>
                  </p>
                  <p className={styles.text}>Nothing more to do here.</p>
                </div>
              </div>
            ) : (
              <>
                {approveError && (
                  <p className="callout tone-bad" role="alert">
                    {approveError}
                  </p>
                )}
                <div className={styles.actions}>
                  <button type="button" className="btn btn-primary btn-lg btn-block" onClick={approve} disabled={approving}>
                    {approving ? <Spinner label="Approving" /> : <Lock aria-hidden />}
                    {load.order.approved ? "Approve again and return" : "Approve simulated payment"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-block" onClick={cancel} disabled={approving}>
                    Cancel and return
                  </button>
                </div>
              </>
            )}
            <p className={styles.fine}>Approving sends you back to LicenseGraph, which captures this simulated order and pays the creators on the simulator.</p>
          </div>
        )}
      </div>
    </div>
  );
}
