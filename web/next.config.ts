import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // hide the dev overlay badge so it stays out of demo recordings;
  // compile/runtime errors still surface
  devIndicators: false,
};

export default nextConfig;
