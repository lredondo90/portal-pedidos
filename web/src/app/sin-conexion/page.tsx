import type { Metadata } from "next";
import Link from "next/link";
import { OfflineOrders } from "@/components/OfflineOrders";

export const metadata: Metadata = { title: "Pedidos sin cobertura · Portal de Pedidos" };

// Página estática: no pide nada al servidor al abrirse, así el service worker la puede servir sin red.
// Los datos salen del móvil (IndexedDB) y los pedidos se envían cuando hay cobertura (lib/offline.ts).
export default function SinConexionPage() {
  return (
    <main className="main" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div className="topbar">
        <div>
          <h1>Pedidos sin cobertura</h1>
          <p>Haz pedidos aunque no haya señal. Se guardan en el móvil y se envían solos cuando vuelve la conexión.</p>
        </div>
        <Link className="btn" href="/">Volver al portal</Link>
      </div>
      <OfflineOrders />
    </main>
  );
}
