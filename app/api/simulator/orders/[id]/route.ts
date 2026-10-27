import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** What the simulated checkout page shows. Exists only when the payment simulator is running. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { simulator } = getRuntime();
  if (!simulator) return json({ error: "The payment simulator is not running." }, 404);
  const order = simulator.describeOrder((await params).id);
  return order ? json(order) : json({ error: "Order not found." }, 404);
}

/** The buyer pressing "Approve": marks the order approved and says where to send the browser. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { simulator } = getRuntime();
  if (!simulator) return json({ error: "The payment simulator is not running." }, 404);
  try {
    return json(simulator.approveOrder((await params).id));
  } catch {
    return json({ error: "Order not found." }, 404);
  }
}
