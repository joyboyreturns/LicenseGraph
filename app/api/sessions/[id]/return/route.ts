import { completePayment } from "@/src/app-logic/session";
import { sessionOr404 } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";
import { ownsRun } from "@/src/server/owner";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** PayPal sends the buyer here after approval. We capture the order we created, then show the result. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const session = sessionOr404(id);
  const back = new URL(`/run/${encodeURIComponent(id)}`, process.env.APP_URL ?? req.url);
  if (session && ownsRun(session, req)) {
    // Capture only the order this session created, whatever token the redirect carries.
    await completePayment(session, getRuntime().deps).catch(() => undefined);
  }
  return NextResponse.redirect(back);
}
