import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestPill } from "@/components/Pills";
import { apiGet, type Customer, type OrderRequest } from "@/lib/api";
import { cantidad, eur, fecha, hora } from "@/lib/format";

export default async function PedidoWebPage({ params, searchParams }: PageProps<"/pedidos-web/[tenant]/[id]">) {
  const { tenant, id } = await params;
  const sp = await searchParams;
  const [r, customers] = await Promise.all([
    apiGet<OrderRequest>(`/api/order-requests/${encodeURIComponent(tenant)}/${encodeURIComponent(id)}`),
    apiGet<Customer[]>("/api/customers"),
  ]);
  if (!r) notFound();
  const customer = customers?.find((c) => c.erpId === r.customerId);

  return (
    <div className="detail">
      <Link className="back" href="/pedidos">← Pedidos</Link>
      {sp.nuevo && r.status === "PendienteErp" && (
        <div className="banner" role="status">
          <span className="status-dot" /> Pedido enviado. SAP lo registrará en unos minutos y aquí aparecerá su número de pedido.
        </div>
      )}
      <div className="drawer-h">
        <div>
          <div className="label">Pedido hecho en el portal</div>
          <h2 className="mono">{r.id}</h2>
          <div className="sub">
            {customer?.name ?? r.customerId}
            {r.customerReference && <> · su referencia <span className="mono">{r.customerReference}</span></>}
          </div>
        </div>
        <RequestPill status={r.status} />
      </div>

      {r.status === "Creado" && r.erpOrderId && (
        <div className="banner">
          SAP ha creado el pedido de venta <Link className="link mono" href={`/pedidos/${r.tenantId}/${r.erpOrderId}`}>{r.erpOrderId}</Link>. Desde ahí puedes seguir la entrega y la factura.
        </div>
      )}
      {r.status === "Rechazado" && (
        <div className="banner bad" role="alert">SAP no ha podido crear el pedido{r.message ? `: ${r.message}` : "."} Tu comercial se pondrá en contacto contigo.</div>
      )}

      <section className="panel">
        <div className="panel-b">
          <dl className="kv">
            <dt>Enviado</dt><dd className="num">{fecha(r.createdAt)} {hora(r.createdAt)}{r.createdByName && <> · por {r.createdByName}</>}</dd>
            <dt>Entrega deseada</dt><dd className="num">{fecha(r.requestedDate)}</dd>
            <dt>Dirección de entrega</dt><dd>{r.shipTo ? <>{r.shipTo.name}<div className="sub">{r.shipTo.address}</div></> : customer?.address}</dd>
            {r.notes && <><dt>Observaciones</dt><dd>{r.notes}</dd></>}
          </dl>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Líneas</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Artículo</th><th className="r">Cant.</th><th className="r hide-m">Precio</th><th className="r">Importe</th></tr></thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.position}>
                  <td>{l.description}<div className="sub mono">{l.materialId}</div></td>
                  <td className="r num">{cantidad(l.quantity)} {l.unit}</td>
                  <td className="r num hide-m">{eur(l.unitPrice)}</td>
                  <td className="r num">{eur(l.netAmount)}</td>
                </tr>
              ))}
              <tr><td className="hide-m" /><td /><td className="r sub">Base</td><td className="r num">{eur(r.netAmount)}</td></tr>
              <tr><td className="hide-m" /><td /><td className="r sub">IVA</td><td className="r num">{eur(r.taxAmount)}</td></tr>
              <tr><td className="hide-m" /><td /><td className="r"><b>Total</b></td><td className="r num"><b>{eur(r.total)}</b></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
