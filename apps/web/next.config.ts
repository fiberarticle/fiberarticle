import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production runs from the self-contained .next/standalone bundle on the
  // VM (node server.js), so deploys copy artifacts instead of node_modules.
  output: "standalone",
};

export default nextConfig;
