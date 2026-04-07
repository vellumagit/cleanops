import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack to this project root so a stray lockfile in the user's
  // home directory doesn't confuse the build.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
