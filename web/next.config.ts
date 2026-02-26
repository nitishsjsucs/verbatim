import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disabled reactCompiler — conflicts with @react-pdf-viewer plugin instantiation
  reactCompiler: false,
  turbopack: {
    resolveAlias: {
      canvas: { browser: "" },
    },
  },
  webpack: (config) => {
    // canvas is not available in the browser — alias to false for production builds
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
};

export default nextConfig;
