"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Vuelve a pedir los datos de la página cada pocos segundos mientras está a la vista,
// para que un pedido nuevo aparezca sin tener que recargar.
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return null;
}
