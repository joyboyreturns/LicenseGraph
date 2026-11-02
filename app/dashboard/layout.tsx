import type { Metadata } from "next";
import { StatusPills } from "@/src/ui/components/SiteHeader";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Every licence run on this server, with an AG Studio dashboard for each.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <><div className="container-wide" style={{ paddingBlock: 10, borderBottom: "1px solid var(--line)" }} aria-label="Dashboard environment"><StatusPills stacked /></div>{children}</>;
}
