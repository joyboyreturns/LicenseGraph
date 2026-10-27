import type { Metadata } from "next";
import { Home } from "@/src/ui/components/home/Home";

export const metadata: Metadata = {
  title: { absolute: "LicenseGraph: verified licence bundles, creators paid" },
  openGraph: {
    title: "LicenseGraph: AI moves at machine speed. Creator rights and payments should too.",
    description: "Watch an AI agent propose a licence bundle, a deterministic rules engine reject what breaks, and PayPal pay the creators of what passes.",
  },
};

export default function Page() {
  return <Home />;
}
