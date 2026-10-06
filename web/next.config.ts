import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@k2x/relayer"],
  reactStrictMode: true,
};

export default config;
