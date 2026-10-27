import type { Metadata } from "next";
import { Suspense } from "react";
import { Checkout } from "@/src/ui/components/simulator/Checkout";

export const metadata: Metadata = {
  title: "Payment simulator",
  description: "LicenseGraph's local payment simulator. No money moves.",
  robots: { index: false },
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Checkout />
    </Suspense>
  );
}
