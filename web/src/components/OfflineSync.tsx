"use client";

import { useEffect, useState } from "react";
import { CHANGED, deletePack, flushOutbox, hoursOld, keepOfflinePage, listOrders, loadPack, refreshPack, setActiveUser, unsent, type QueuedOrder } from "@/lib/offline";

/** Hay red según el navegador. Con poca cobertura puede decir que sí y fallar igual: los envíos se intentan siempre. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  return online;
}

/** Pedidos guardados en el móvil del usuario, al día, y envío automático: al abrir, al volver a la app, al recuperar la red y cada 30 s. */
export function useOutbox(user: string | null) {
  const [orders, setOrders] = useState<QueuedOrder[]>([]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () => listOrders(user).then((o) => alive && setOrders(o)).catch(() => {});
    const send = () => flushOutbox(user).catch(() => {});
    const onVisible = () => document.visibilityState === "visible" && send();
    load();
    send();
    window.addEventListener(CHANGED, load);
    window.addEventListener("online", send);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(send, 30_000);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED, load);
      window.removeEventListener("online", send);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [user]);
  return orders;
}

// En el portal (con conexión): deja al día los datos del móvil para cuando no haya cobertura y envía lo pendiente.
// Muestra un aviso si quedan pedidos guardados sin enviar.
export function OfflineSync({ user, offlineOrders }: { user: string; offlineOrders: boolean }) {
  const orders = useOutbox(user);
  useEffect(() => {
    setActiveUser(user).catch(() => {});
    if (!offlineOrders) return;
    keepOfflinePage();
    loadPack(user)
      .then((p) => (!p || hoursOld(p.savedAt) > 0.5 ? refreshPack() : null))
      .catch(() => {});
  }, [user, offlineOrders]);

  const pending = unsent(orders);
  if (pending.length === 0) return null;
  const review = pending.filter((o) => o.status === "revisar").length;
  return (
    <a className={`banner${review ? " bad" : ""}`} href="/sin-conexion" style={{ marginBottom: 16, textDecoration: "none" }}>
      <span className="status-dot idle" />
      {review
        ? `${review === 1 ? "Un pedido guardado en el móvil necesita" : `${review} pedidos guardados en el móvil necesitan`} que lo revises.`
        : `${pending.length === 1 ? "Tienes 1 pedido guardado" : `Tienes ${pending.length} pedidos guardados`} en el móvil esperando cobertura. Se enviarán solos.`}
      <span className="link">Ver</span>
    </a>
  );
}

/** Al cambiar de usuario: avisa si quedan pedidos sin enviar y borra del móvil los datos de la cartera. */
export function LogoutButton({ user, action }: { user: string; action: () => Promise<void> }) {
  const pending = unsent(useOutbox(user)).length;
  return (
    <form
      action={action}
      onSubmit={async (e) => {
        if (pending > 0 && !confirm(`Tienes ${pending} ${pending === 1 ? "pedido" : "pedidos"} sin enviar. Se quedan guardados en este móvil y se enviarán cuando vuelvas a entrar con tu usuario. ¿Salir igualmente?`)) {
          e.preventDefault();
          return;
        }
        await Promise.all([setActiveUser(null), deletePack(user)]).catch(() => {});
      }}
    >
      <button className="btn sm" type="submit">Cambiar de usuario</button>
    </form>
  );
}
