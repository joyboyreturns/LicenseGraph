import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LicenseGraph",
    short_name: "LicenseGraph",
    description: "Verified, approved, paid-for creative licences, with a Licence Passport anyone can re-check.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f2ed",
    theme_color: "#f4f2ed",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
