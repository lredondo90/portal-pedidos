import Link from "next/link";
import { PageHeader } from "@/components/Pills";
import { clearCart, placeOrder, updateCartLine } from "@/lib/actions";
import { apiGet, type Catalog } from "@/lib/api";
import { readCart } from "@/lib/cart";
import { diaLaborable, eur, manana } from "@/lib/format";

const round = (n: number) => Math.round(n * 100) / 100;

export default async function CarritoPage({ searchParams }: PageProps<"/carrito">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const cart = await readCart();
  const catalog = cart.customerId ? await apiGet<Catalog>(`/api/catalog?customer=${encodeURIComponent(cart.customerId)}`) : null;
  const customer = catalog?.customer ?? null;

  // Importes orientativos con la tarifa actual; el precio que vale es el que calcula la API al enviar.
  const lines = Object.entries(cart.lines).map(([materialId, quantity]) => {
    const item = catalog?.items.find((i) => i.product.erpId === materialId) ?? null;
    const net = item ? round(quantity * item.price) : 0;
    return { materialId, quantity, item, net, tax: item ? round((net * item.product.taxRate) / 100) : 0 };
  });
  const net = lines.reduce((s, l) => s + l.net, 0), tax = lines.reduce((s, l) => s + l.tax, 0);
  const error = one(sp.error);

  if (!customer || lines.length === 0) {
    return (
      <>
        <PageHeader title="Carrito" />
        <section className="panel">
          <div className="empty">
            El carrito está vacío.
            <div style={{ marginTop: 12 }}><Link className="btn primary" href="/catalogo">Ir al catálogo</Link></div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Carrito" sub={`Pedido para ${customer.name} · cliente ${customer.erpId}`}>
        <Link className="btn" href={`/catalogo?cliente=${customer.erpId}`}>Seguir añadiendo</Link>
      </PageHeader>

      {error && <div className="banner bad" role="alert" style={{ marginBottom: 12 }}>{error}</div>}

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Artículo</th><th>Cantidad</th><th className="r hide-m">Precio</th><th className="r">Importe</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.materialId}>
                  <td>
                    {l.item?.product.description ?? <span style={{ color: "var(--bad)" }}>Artículo ya no disponible</span>}
                    <div className="sub mono">{l.materialId}</div>
                  </td>
                  <td>
                    <form action={updateCartLine} className="qty-form">
                      <input type="hidden" name="material" value={l.materialId} />
                      <input className="qty" name="qty" type="number" inputMode="decimal" min={l.item?.product.minQuantity ?? 1} step="any" defaultValue={l.quantity} aria-label="Cantidad" required />
                      <span className="sub">{l.item?.product.unit}</span>
                      <button className="btn sm" type="submit">Cambiar</button>
                      <button className="btn sm" type="submit" name="remove" value="1" formNoValidate>Quitar</button>
                    </form>
                  </td>
                  <td className="r num hide-m">{l.item && eur(l.item.price)}</td>
                  <td className="r num">{eur(l.net)}</td>
                </tr>
              ))}
              <tr><td /><td className="hide-m" /><td className="r sub">Base</td><td className="r num">{eur(net)}</td></tr>
              <tr><td /><td className="hide-m" /><td className="r sub">IVA</td><td className="r num">{eur(tax)}</td></tr>
              <tr><td /><td className="hide-m" /><td className="r"><b>Total</b></td><td className="r num"><b>{eur(net + tax)}</b></td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel-b">
          <form action={clearCart}><button className="btn sm" type="submit">Vaciar carrito</button></form>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><h2>Datos del pedido</h2></div>
        <form action={placeOrder} className="panel-b grid" style={{ gap: 14 }}>
          <div className="fields">
            <label className="field">Su referencia (opcional)
              <input name="reference" maxLength={35} defaultValue={one(sp.ref)} placeholder="Nº de pedido de compra" />
            </label>
            <label className="field">Fecha de entrega deseada
              <input name="date" type="date" min={manana()} defaultValue={one(sp.fecha) || diaLaborable(3)} required />
            </label>
            <label className="field">Dirección de entrega
              <select name="shipTo" defaultValue={one(sp.destino) || catalog!.shipTos[0]?.erpId || ""}>
                {catalog!.shipTos.length === 0 && <option value="">{customer.address ?? "Dirección habitual"}</option>}
                {catalog!.shipTos.map((s) => <option key={s.erpId} value={s.erpId}>{s.name} · {s.address}</option>)}
              </select>
            </label>
          </div>
          <label className="field">Observaciones para el almacén o el transportista (opcional)
            <textarea name="notes" rows={3} maxLength={500} defaultValue={one(sp.obs)} />
          </label>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span className="sub">El pedido se envía a SAP. En cuanto lo registre verás su número y podrás seguirlo como los demás.</span>
            <button className="btn primary" type="submit">Enviar pedido · {eur(net + tax)}</button>
          </div>
        </form>
      </section>
    </>
  );
}
