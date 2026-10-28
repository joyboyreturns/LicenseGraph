import type { MetadataRoute } from "next";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = getRuntime().appUrl;
  return ["", "/tour", "/agents", "/rules", "/verify"].map((path) => ({ url: `${appUrl}${path}` }));
}
