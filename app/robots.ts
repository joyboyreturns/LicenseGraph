import type { MetadataRoute } from "next";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** Public pages are open to crawlers and agents; runs, claim links and the payment simulator are private to whoever holds the link. */
export default function robots(): MetadataRoute.Robots {
  const appUrl = getRuntime().appUrl;
  return { rules: { userAgent: "*", allow: ["/", "/api/mcp", "/api/openapi.json"], disallow: ["/api/", "/run/", "/claim/", "/simulator/", "/passport/"] }, sitemap: `${appUrl}/sitemap.xml`, host: appUrl };
}
