import type { Metadata } from "next";
import { PassportPage } from "@/src/ui/components/passport/PassportPage";

export const metadata: Metadata = {
  title: "Licence Passport",
  description: "A verified, approved and paid licence bundle. Re-check every hash, rule, quote and payment record in your own browser.",
  openGraph: {
    type: "article",
    title: "Licence Passport · LicenseGraph",
    description: "A verified, approved and paid licence bundle that anyone can re-verify in their own browser.",
  },
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PassportPage id={id} />;
}
