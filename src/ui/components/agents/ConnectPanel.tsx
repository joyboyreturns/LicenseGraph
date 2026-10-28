"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "../bits";
import styles from "./Agents.module.css";

interface Tool {
  name: string;
  description?: string;
}

/** How to connect an agent to this very server, and the tools it would find there (listed live over MCP). */
export function ConnectPanel() {
  const [origin, setOrigin] = useState("http://localhost:3000");
  const [tools, setTools] = useState<Tool[] | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })
      .then((r) => r.json())
      .then((b) => setTools(b.result?.tools ?? []))
      .catch(() => setTools([]));
  }, []);

  const http = JSON.stringify({ mcpServers: { licensegraph: { url: `${origin}/api/mcp` } } }, null, 2);
  const stdio = JSON.stringify({ mcpServers: { licensegraph: { command: "npx", args: ["tsx", "scripts/mcp-server.ts"], env: { LICENSEGRAPH_URL: origin } } } }, null, 2);
  return (
    <div className={styles.grid}>
      <section className={styles.block} aria-labelledby="connect-title">
        <h2 id="connect-title">Connect an agent</h2>
        <p className="small ink-2" style={{ margin: 0 }}>
          Any MCP client can use this server. Over HTTP, nothing needs installing:
        </p>
        <pre className={styles.snippet} tabIndex={0} aria-label="MCP over HTTP: configuration to copy">{http}</pre>
        <CopyButton text={http} label="Copy HTTP configuration" announce="Configuration copied" className="btn btn-sm">
          Copy HTTP configuration
        </CopyButton>
        <p className="small ink-2" style={{ margin: "6px 0 0" }}>
          Or run it locally over stdio from a clone of the repository:
        </p>
        <pre className={styles.snippet} tabIndex={0} aria-label="MCP over stdio: configuration to copy">{stdio}</pre>
        <CopyButton text={stdio} label="Copy stdio configuration" announce="Configuration copied" className="btn btn-sm">
          Copy stdio configuration
        </CopyButton>
      </section>
      <section className={styles.block} aria-labelledby="tools-title">
        <h2 id="tools-title">What it finds there</h2>
        {tools === null ? (
          <div className="skeleton" style={{ height: 180, borderRadius: 10 }} />
        ) : (
          <ul className={styles.tools}>
            {tools.map((t) => (
              <li key={t.name}>
                <code>{t.name}</code>
                <span className="small ink-2">{(t.description ?? "").split(". ")[0]!.replace(/\.$/, "")}.</span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          It also offers a <code>buy_licences</code> prompt with the order to work in. Agents can check, price and start a purchase; approval and payment stay with a person.
        </p>
      </section>
    </div>
  );
}
