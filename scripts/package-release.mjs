// Assembles a small, self-contained release folder from a finished `next build` and `build:ops`:
//   release/app     the standalone Next.js server with its static files (run: node server.js)
//   release/ops     worker and database commands as single files (run: node ops/worker.mjs)
//   release/migrations, release/deploy   SQL migrations and the service/compose templates
// Copy the folder (or release.tar.gz) to the server; it needs only Node 22, not npm or the source tree.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

for (const need of [".next/standalone/server.js", "dist/ops/worker.mjs"])
  if (!existsSync(need)) throw new Error(`${need} is missing. Run "npm run build && npm run build:ops" first.`);
rmSync("release", { recursive: true, force: true });
mkdirSync("release/app/.next", { recursive: true });
// Next copies files the build touched, which can include local secrets and data. A release must carry none of them.
const local = (path) => /(^|\/)(\.env[^/]*|\.data[^/]*|\.sandbox-run|\.data-private-tests|release|test-results)$/.test(path);
cpSync(".next/standalone", "release/app", { recursive: true, filter: (source) => !local(source) });
cpSync(".next/static", "release/app/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", "release/app/public", { recursive: true });
cpSync("dist/ops", "release/ops", { recursive: true });
cpSync("migrations", "release/migrations", { recursive: true });
cpSync("deploy", "release/deploy", { recursive: true });
cpSync("infra", "release/infra", { recursive: true });
const leaked = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (local(path) || /\.(pem|key)$/.test(entry.name)) leaked.push(path);
    else if (entry.isDirectory()) walk(path);
  }
};
walk("release");
if (leaked.length) {
  rmSync("release", { recursive: true, force: true });
  throw new Error(`Refusing to package local secrets or data: ${leaked.join(", ")}`);
}
execFileSync("tar", ["-czf", "release.tar.gz", "release"], { stdio: "inherit" });
console.log("release/ and release.tar.gz are ready.");
