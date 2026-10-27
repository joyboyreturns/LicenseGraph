import type { Metadata } from "next";
import { RunTheatre } from "@/src/ui/components/run/RunTheatre";

export const metadata: Metadata = {
  title: "Run theatre",
  description: "Watch the agent propose and the rules engine verify, then approve, pay and settle.",
};

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunTheatre id={id} />;
}
