import { refreshPayouts, viewOf } from "@/src/app-logic/session";
import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** Every run's view for the portfolio dashboard, newest first. Licence text is left out: the dashboard does not need it. */
export async function GET() {
  const { store, deps } = getRuntime();
  // Payouts settle shortly after they are created; bring any that are still in flight up to date.
  await Promise.all(store.list().map((s) => refreshPayouts(s, deps)));
  const views = store.list().map((s) => {
    const v = viewOf(s);
    return { ...v, documents: v.documents.map((d) => ({ ...d, text: "" })) };
  });
  return json({ views });
}
