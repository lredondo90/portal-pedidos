import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const condensed = IBM_Plex_Sans_Condensed({ variable: "--font-condensed", subsets: ["latin"], weight: ["500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Portal de Pedidos",
  description: "Consulta de pedidos, entregas, facturas y pagos",
  applicationName: "Portal de Pedidos",
  appleWebApp: { capable: true, title: "Pedidos", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b6a6f" },
    { media: "(prefers-color-scheme: dark)", color: "#0f151b" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${sans.variable} ${condensed.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
