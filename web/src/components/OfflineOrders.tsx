"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useOnline, useOutbox } from "@/components/OfflineSync";
import { cantidad, diaLaborable, eur, fecha, manana } from "@/lib/format";
import {
  STALE_HOURS, activeUser, deleteOrder, flushOutbox, hoursOld, loadDraft, loadPack, priceOf, queueOrder, refreshPack, saveDraft, totals, updateOrder,
  type Draft, type OfflinePack, type QueuedLine, type QueuedOrder,
} from "@/lib/offline";

const STATUS: Record<QueuedOrder["status"], { label: string; pill: string }> = {
  pendiente: { label: "Esperando cobertura", pill: "p-prep" },
  enviando: { label: "Enviando…", pill: "p-ship" },
  enviado: { label: "Enviado", pill: "p-done" },
  revisar: { label: "Revisar", pill: "p-bad" },
};

function hace(iso: string | null | undefined): string {
  const h = hoursOld(iso);
  if (!Number.isFinite(h)) return "";
  if (h < 1 / 60) return "ahora mismo";
  if (h < 1) return `hace ${Math.round(h * 60)} min`;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}

const fechaHora = (iso: string) => {
  const d = new Date(iso);
  return `${fecha(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)} ${d.toTimeString().slice(0, 5)}`;
};

const emptyDraft = (customerId = ""): Draft => ({ customerId, lines: {}, customerReference: "", requestedDate: diaLaborable(3), shipToId: "", notes: "" });

export function OfflineOrders() {
  const online = useOnline();
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [pack, setPack] = useState<OfflinePack | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const orders = useOutbox(user ?? null);

  // Primero lo que hay en el móvil (funciona sin red); luego, si hay conexión, se actualiza.
  useEffect(() => {
    (async () => {
      const u = await activeUser().catch(() => null);
      setUser(u);
      if (u) {
        setPack(await loadPack(u));
        const d = await loadDraft(u);
        if (d) setDraft(d);
      }
      const fresh = await refreshPack();
      if (fresh) {
        setUser(fresh.userId);
        setPack(fresh);
        if (fresh.userId !== u) setDraft((await loadDraft(fresh.userId)) ?? emptyDraft());
      }
    })().catch(() => setUser(null));
  }, []);

  const change = (patch: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (user) saveDraft(user, next).catch(() => {});
      return next;
    });
  };

  const entry = pack?.customers.find((c) => c.customer.erpId === draft.customerId) ?? null;
  const products = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = pack?.products ?? [];
    return t ? all.filter((p) => p.description.toLowerCase().includes(t) || p.erpId.includes(t) || p.category?.toLowerCase().includes(t)) : all;
  }, [pack, q]);

  const lines: QueuedLine[] = useMemo(() => {
    if (!pack || !entry) return [];
    return Object.entries(draft.lines).flatMap(([id, quantity]) => {
      const p = pack.products.find((x) => x.erpId === id);
      return p ? [{ materialId: id, description: p.description, quantity, unit: p.unit, price: priceOf(pack, entry.customer.erpId, p).price, taxRate: p.taxRate }] : [];
    });
  }, [pack, entry, draft.lines]);
  const sum = totals(lines);

  const setQty = (id: string, n: number) => {
    const next = { ...draft.lines };
    if (n > 0) next[id] = n; else delete next[id];
    change({ lines: next });
  };

  async function refresh() {
    setBusy(true);
    const fresh = await refreshPack();
    setBusy(false);
    if (fresh) { setPack(fresh); setUser(fresh.userId); setNotice({ text: "Datos actualizados." }); }
    else setNotice({ text: "No se han podido actualizar: no hay cobertura o tienes que volver a entrar en el portal.", bad: true });
  }

  async function save() {
    if (!user || !entry) return;
    const errors: string[] = [];
    if (lines.length === 0) errors.push("Añade algún artículo.");
    if (!draft.requestedDate || draft.requestedDate < manana()) errors.push("La fecha de entrega tiene que ser posterior a hoy.");
    for (const l of lines) {
      const p = pack!.products.find((x) => x.erpId === l.materialId)!;
      if (l.quantity < p.minQuantity) errors.push(`${p.description}: la cantidad mínima es ${cantidad(p.minQuantity)} ${p.unit}.`);
    }
    if (errors.length) { setNotice({ text: errors.join(" "), bad: true }); return; }
    setBusy(true);
    await queueOrder({
      userId: user, customerId: entry.customer.erpId, customerName: entry.customer.name, lines,
      customerReference: draft.customerReference.trim() || null, requestedDate: draft.requestedDate,
      shipToId: draft.shipToId || entry.shipTos[0]?.erpId || null, notes: draft.notes.trim() || null,
    });
    setDraft(emptyDraft());
    await saveDraft(user, null);
    setQ("");
    await flushOutbox(user);
    setBusy(false);
    setNotice({ text: "Pedido guardado en el móvil. Si hay cobertura ya se ha enviado; si no, se enviará solo cuando vuelva la señal." });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (user === undefined) return <div className="empty">Cargando…</div>;

  if (!user || !pack) {
    return (
      <section className="panel">
        <div className="empty">
          {online
            ? "Todavía no hay datos guardados en este móvil. Entra en el portal con tu usuario y vuelve a esta página."
            : "Todavía no hay datos guardados en este móvil. Ábrelo una vez con cobertura y entra con tu usuario: a partir de ahí podrás hacer pedidos sin señal."}
          <div style={{ marginTop: 12 }}><Link className="btn primary" href="/">Ir al portal</Link></div>
        </div>
      </section>
    );
  }

  const age = hoursOld(pack.dataAt ?? pack.generatedAt);
  const stale = age > STALE_HOURS;
  const waiting = orders.filter((o) => o.status !== "enviado");

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className={`banner${stale ? " bad" : ""}`} role="status">
        <span className={`status-dot${online ? "" : " idle"}`} />
        <span style={{ flex: "1 1 220px" }}>
          <b>{online ? "Con conexión" : "Sin cobertura"}</b>
          {" · "}Precios y stock del {fechaHora(pack.dataAt ?? pack.generatedAt)} ({hace(pack.dataAt ?? pack.generatedAt)}).
          {stale && " Pueden haber cambiado: el precio final lo pone SAP al recibir el pedido."}
        </span>
        <button className="btn sm" type="button" onClick={refresh} disabled={busy || !online}>Actualizar datos</button>
      </div>

      {notice && <div className={`banner${notice.bad ? " bad" : ""}`} role="alert">{notice.text}</div>}

      {orders.length > 0 && (
        <section className="panel">
          <div className="panel-h">
            <h2>Pedidos guardados en el móvil</h2>
            {waiting.length > 0 && (
              <button className="btn sm" type="button" onClick={() => flushOutbox(user)} disabled={busy}>Enviar ahora</button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cliente</th><th className="hide-m">Hecho</th><th className="r">Importe</th><th>Estado</th></tr></thead>
              <tbody>
                {orders.map((o) => <QueuedRow key={o.clientId} order={o} />)}
              </tbody>
            </table>
          </div>
          <div className="panel-b sub">
            Los pedidos se envían solos en cuanto hay cobertura, aunque cambies de pantalla. En iPhone, abre la app de vez en cuando para que salgan.
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-h"><h2>Nuevo pedido</h2></div>
        <div className="panel-b grid" style={{ gap: 12 }}>
          <label className="field">Cliente
            <select value={draft.customerId} onChange={(e) => change({ ...emptyDraft(e.target.value), requestedDate: draft.requestedDate })}>
              <option value="" disabled>Elige un cliente…</option>
              {pack.customers.map((c) => <option key={c.customer.erpId} value={c.customer.erpId}>{c.customer.name}</option>)}
            </select>
          </label>
          {pack.customers.length === 0 && <div className="empty">No tienes clientes en tu cartera.</div>}
        </div>

        {entry && (
          <>
            <div className="panel-b" style={{ paddingTop: 0 }}>
              <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar artículo por nombre o código" aria-label="Buscar artículo" style={{ width: "100%" }} />
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Artículo</th><th className="r">Precio</th><th>Cantidad</th></tr></thead>
                <tbody>
                  {products.length === 0 && <tr><td colSpan={3}><div className="empty">No hay artículos con esa búsqueda.</div></td></tr>}
                  {products.map((p) => {
                    const { price, special } = priceOf(pack, entry.customer.erpId, p);
                    return (
                      <tr key={p.erpId}>
                        <td>
                          {p.description}
                          <div className="sub">
                            <span className="mono">{p.erpId}</span>
                            {p.stock != null && <> · {p.stock > 0 ? "Disponible" : "Bajo pedido"}</>}
                            {p.minQuantity > 1 && <> · mínimo {cantidad(p.minQuantity)} {p.unit}</>}
                          </div>
                        </td>
                        <td className="r num">
                          {eur(price)}<span className="sub"> / {p.unit}</span>
                          {special && <div className="sub" style={{ color: "var(--good)" }}>Su precio</div>}
                        </td>
                        <td>
                          <QtyInput key={draft.lines[p.erpId] ?? 0} value={draft.lines[p.erpId]} min={p.minQuantity} label={p.description} onChange={(n) => setQty(p.erpId, n)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="panel-b grid" style={{ gap: 14, borderTop: "1px solid var(--line)" }}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Resumen · {lines.length} {lines.length === 1 ? "artículo" : "artículos"}</h2>
              {lines.map((l) => (
                <div key={l.materialId} className="toolbar" style={{ justifyContent: "space-between" }}>
                  <span>{l.description} <span className="sub">· {cantidad(l.quantity)} {l.unit}</span></span>
                  <span className="num">{eur(Math.round(l.quantity * l.price * 100) / 100)} <button className="btn sm" type="button" onClick={() => setQty(l.materialId, 0)}>Quitar</button></span>
                </div>
              ))}
              <div className="fields">
                <label className="field">Su referencia (opcional)
                  <input value={draft.customerReference} maxLength={35} onChange={(e) => change({ customerReference: e.target.value })} placeholder="Nº de pedido de compra" />
                </label>
                <label className="field">Fecha de entrega deseada
                  <input type="date" value={draft.requestedDate} min={manana()} onChange={(e) => change({ requestedDate: e.target.value })} required />
                </label>
                <label className="field">Dirección de entrega
                  <select value={draft.shipToId || entry.shipTos[0]?.erpId || ""} onChange={(e) => change({ shipToId: e.target.value })}>
                    {entry.shipTos.length === 0 && <option value="">{entry.customer.address ?? "Dirección habitual"}</option>}
                    {entry.shipTos.map((s) => <option key={s.erpId} value={s.erpId}>{s.name} · {s.address}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">Observaciones (opcional)
                <textarea rows={2} maxLength={500} value={draft.notes} onChange={(e) => change({ notes: e.target.value })} />
              </label>
              <div className="toolbar" style={{ justifyContent: "space-between" }}>
                <span className="sub">Importe orientativo: base {eur(sum.net)} + IVA {eur(sum.tax)}. El precio final lo calcula el portal al recibirlo.</span>
                <button className="btn primary" type="button" onClick={save} disabled={busy || lines.length === 0}>
                  {online ? "Enviar pedido" : "Guardar pedido"} · {eur(sum.total)}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function QtyInput({ value, min, label, onChange }: { value?: number; min: number; label: string; onChange: (n: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  const n = Number(text.replace(",", "."));
  return (
    <div className="qty-form">
      <input className="qty" type="number" inputMode="decimal" min={min} step="any" value={text} placeholder={cantidad(min)} onChange={(e) => setText(e.target.value)} aria-label={`Cantidad de ${label}`} />
      <button className="btn sm" type="button" onClick={() => onChange(Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : text ? 0 : min)}>
        {value ? "Cambiar" : "Añadir"}
      </button>
    </div>
  );
}

function QueuedRow({ order: o }: { order: QueuedOrder }) {
  const [date, setDate] = useState(o.requestedDate);
  const s = STATUS[o.status];
  return (
    <tr>
      <td>
        {o.customerName}
        <div className="sub">
          {o.lines.length} {o.lines.length === 1 ? "artículo" : "artículos"} · entrega {fecha(o.requestedDate)}
          {o.customerReference && <> · ref. {o.customerReference}</>}
        </div>
      </td>
      <td className="hide-m">{fechaHora(o.capturedAt)}</td>
      <td className="r num">{eur(totals(o.lines).total)}</td>
      <td>
        <span className={`pill ${s.pill}`}>{s.label}</span>
        {o.message && <div className="sub" style={o.status === "revisar" ? { color: "var(--bad)" } : undefined}>{o.message}</div>}
        {o.status === "enviado" && o.result && (
          <div className="sub"><a className="link" href={`/pedidos-web/${encodeURIComponent(o.result.tenantId)}/${encodeURIComponent(o.result.id)}`}>Ver pedido {o.result.id}</a></div>
        )}
        {o.status === "revisar" && (
          <div className="qty-form" style={{ marginTop: 6 }}>
            <input className="qty" style={{ width: 150, textAlign: "left" }} type="date" min={manana()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Nueva fecha de entrega" />
            <button className="btn sm" type="button" onClick={async () => { await updateOrder(o.clientId, { requestedDate: date, status: "pendiente", message: undefined }); await flushOutbox(o.userId); }}>Reenviar</button>
          </div>
        )}
        {(o.status === "pendiente" || o.status === "revisar") && (
          <div style={{ marginTop: 6 }}>
            <button className="btn sm" type="button" onClick={() => confirm("¿Borrar este pedido del móvil? No se enviará.") && deleteOrder(o.clientId)}>Borrar</button>
          </div>
        )}
      </td>
    </tr>
  );
}
