import type { Metadata } from "next";
import { AgentConsole } from "@/src/ui/components/agents/AgentConsole";
import { ConnectPanel } from "@/src/ui/components/agents/ConnectPanel";

export const metadata: Metadata = {
  title: "Agents",
  description: "Connect an AI agent to LicenseGraph over the Model Context Protocol, and watch one price a purchase. Agents can check, price and start a purchase; only a person can approve and pay.",
};

export default function Page() {
  return (
    <div className="container-wide" style={{ paddingTop: "clamp(28px, 5vw, 56px)", display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ maxWidth: 760 }}>
        <p className="eyebrow">Agents</p>
        <h1 className="display" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 10 }}>
          Agents can shop. Only people can spend.
        </h1>
        <p style={{ marginTop: 14, fontSize: 17, color: "var(--ink-2)", maxWidth: "62ch" }}>
          LicenseGraph speaks the Model Context Protocol, so any agent can check licences against a brief, find the exact cheapest bundle, explore a change of scope and start a purchase. It cannot approve or pay: that needs a person with the claim link, and PayPal moves the money.
        </p>
      </div>
      <ConnectPanel />
      <section aria-labelledby="console-title" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h2 id="console-title" style={{ margin: 0, fontSize: 22 }}>
            Watch an agent work
          </h2>
          <p className="small ink-2" style={{ margin: "6px 0 0", maxWidth: "70ch" }}>
            This runs a built-in scenario, then plays an agent that calls this server&rsquo;s own MCP endpoint, the same one you can connect to above. Every figure comes from the tools.
          </p>
        </div>
        <AgentConsole />
      </section>
    </div>
  );
}
