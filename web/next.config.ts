import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sql.js"],
  allowedDevOrigins: ["192.168.101.220"],
};

export default nextConfig;
