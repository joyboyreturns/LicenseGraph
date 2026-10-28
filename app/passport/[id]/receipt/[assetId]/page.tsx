import type { Metadata } from "next";
import { Receipt } from "@/src/ui/components/passport/Receipt";

export const metadata: Metadata = {
  title: "Licence receipt",
  description: "What one creator was paid for one licence, the terms it was bought on, and how to re-check the full Licence Passport.",
};

export default async function Page({ params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  return <Receipt id={id} assetId={decodeURIComponent(assetId)} />;
}
