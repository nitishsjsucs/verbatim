import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disabled reactCompiler — conflicts with @react-pdf-viewer plugin instantiation
  reactCompiler: false,
  turbopack: {
    resolveAlias: {
      canvas: { browser: "" },
    },
  },
};

export default nextConfig;
