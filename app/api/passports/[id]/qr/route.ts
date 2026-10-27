import QRCode from "qrcode";
import { getRuntime } from "@/src/server/runtime";
import { sessionOr404 } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** An SVG QR code that opens this run's public passport page. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!sessionOr404(id)) return new Response("Not found", { status: 404 });
  const svg = await QRCode.toString(`${getRuntime().appUrl}/passport/${encodeURIComponent(id)}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
}
