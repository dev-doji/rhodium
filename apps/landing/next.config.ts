import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The landing page is fully static — no server runtime needed to host it.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
