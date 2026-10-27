import { scenarios } from "@/src/demo/scenarios";
import { json } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** The built-in scenarios, with the licence text so the page can show what the agent will read. Payee emails are left out. */
export function GET() {
  return json({
    scenarios: scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      tagline: s.tagline,
      brief: s.brief,
      project: s.project,
      requiredAssetIds: s.requiredAssetIds,
      showcases: s.showcases,
      documents: s.documents.map((d) => ({ id: d.id, assetId: d.assetId, text: d.text, licensorName: d.licensor?.name })),
    })),
  });
}
