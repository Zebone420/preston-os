import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo: widen the Turbopack root to the repo root so the shared
  // safety guards in packages/guards resolve (files outside the root
  // are not resolved otherwise).
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
