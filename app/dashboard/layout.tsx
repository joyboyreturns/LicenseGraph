import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Every licence run on this server, with an AG Studio dashboard for each.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
