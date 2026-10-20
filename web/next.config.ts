import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera un servidor autónomo en .next/standalone para la imagen Docker.
  output: "standalone",
  async headers() {
    return [
      {
        // El navegador debe comprobar siempre si hay un service worker nuevo.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
