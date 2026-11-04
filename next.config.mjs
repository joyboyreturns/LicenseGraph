/** Headers that cost nothing and close off common abuse: no content-type guessing, no framing by other sites, no plugin content, no referrer leaking run addresses to other origins. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Only directives that restrict what this site may do to others, so nothing the app loads is affected.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A self-contained server folder (only the files the app uses) for the deployed copy: `node .next/standalone/server.js`.
  output: "standalone",
  // Never let the build trace local secrets, data or test output into the standalone folder.
  outputFileTracingExcludes: { "*": [".env*", ".data*/**", ".sandbox-run/**", ".data-private-tests/**", "test-results/**", "release/**", "release.tar.gz", "graphify-out/**"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
