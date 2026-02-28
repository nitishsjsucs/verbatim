import type { NextConfig } from "next";

// Backend API URL — only used server-side for the rewrite proxy
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";

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

  // Proxy all /api/backend/* requests to the FastAPI backend.
  // This means the frontend only needs one origin (works with ngrok automatically).
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
