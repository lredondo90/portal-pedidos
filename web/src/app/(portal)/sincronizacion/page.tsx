import { redirect } from "next/navigation";
import { PageHeader } from "@/components/Pills";
import { runSync } from "@/lib/actions";
import { apiGet, type SyncInfo } from "@/lib/api";

const dt = (iso: string) => new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function SincronizacionPage() {
  const info = await apiGet<SyncInfo>("/api/sync");
  if (!info) redirect("/");
  const last = info.runs[0];
  return (
    <>
      <PageHeader title="Sincronización" sub="Conexión con el ERP de la empresa" />
      <div className="grid two">
        <section className="panel">
          <div className="panel-h">
            <h2><span className={`status-dot ${info.health.ok ? "" : "idle"}`} /> {info.connector}</h2>
            <span className={`pill ${info.health.ok ? "p-done" : "p-bad"}`}>{info.health.ok ? "Activo" : "Con problemas"}</span>
          </div>
          <div className="panel-b grid" style={{ gap: 14 }}>
            <dl className="kv">
              <dt>Estado</dt><dd>{info.health.message}</dd>
              <dt>Última importación</dt><dd>{last ? dt(last.at) : "Nunca"}</dd>
              <dt>Último fichero</dt><dd className="mono">{last?.cursor ?? ""}</dd>
              <dt>Datos en el portal</dt><dd className="num">{info.counts.orders} pedidos · {info.counts.deliveries} entregas · {info.counts.invoices} facturas · {info.counts.customers} clientes</dd>
            </dl>
            <form action={runSync}><button className="btn primary" type="submit">Sincronizar ahora</button></form>
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2><span className="status-dot idle" /> SAP ECC · RFC/BAPI</h2><span className="pill p-inv">Preparado</span></div>
          <div className="panel-b"><p style={{ margin: 0 }}>El conector en tiempo real se activará cuando se instale SAP .NET Connector. Usa el mismo modelo de datos, así que el portal no cambia.</p></div>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><h2>Últimas sincronizaciones</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Hora</th><th>Ficheros hasta</th><th className="r">Pedidos</th><th className="r">Facturas</th><th>Resultado</th></tr></thead>
            <tbody>
              {info.runs.map((r) => (
                <tr key={r.at}>
                  <td className="num">{dt(r.at)}</td>
                  <td className="mono">{r.cursor}</td>
                  <td className="r num">{r.orders}</td>
                  <td className="r num">{r.invoices}</td>
                  <td>
                    {r.error ? <span className="pill p-bad">Error</span> : r.issues.length ? <span className="pill p-prep">Con avisos</span> : <span className="pill p-done">Correcto</span>}
                    {r.error && <div className="sub">{r.error}</div>}
                    {r.issues.map((i, k) => <div className="sub" key={k}>{i.source}{i.row ? `, fila ${i.row}` : ""}: {i.message}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
