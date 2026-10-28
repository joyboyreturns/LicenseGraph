import type { Metadata } from "next";
import { ClaimRun } from "@/src/ui/components/run/ClaimRun";

export const metadata: Metadata = {
  title: "Take control of a purchase",
  description: "An AI agent started a licence purchase for you. Review it, then take control to approve or decline it.",
  robots: { index: false },
};

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const [{ id }, { token }] = await Promise.all([params, searchParams]);
  return <ClaimRun id={id} token={token ?? ""} />;
}
