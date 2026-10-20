import type { MetadataRoute } from "next";

// Permite instalar el portal como app (Android, iPhone, escritorio) y es la base del paquete de Google Play.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Portal de Pedidos",
    short_name: "Pedidos",
    description: "Consulta de pedidos, entregas, facturas y pagos",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f5f7",
    theme_color: "#0b6a6f",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Hacer pedido", url: "/catalogo" },
      { name: "Mis pedidos", url: "/pedidos" },
      { name: "Facturas", url: "/facturas" },
    ],
  };
}
