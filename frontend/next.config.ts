import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/": ["./data/*.csv", "./data/*.json"],
  },
};

export default nextConfig;
