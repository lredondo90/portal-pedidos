import Link from "next/link";
import { PageHeader } from "@/components/Pills";
import { addToCart } from "@/lib/actions";
import { apiGet, isStaff, type Catalog, type Customer, type Me } from "@/lib/api";
import { cartCount, readCart } from "@/lib/cart";
import { cantidad, eur } from "@/lib/format";

function Availability({ stock, unit }: { stock?: number | null; unit: string }) {
  if (stock == null) return null;
  if (stock <= 0) return <span className="pill p-prep">Bajo pedido</span>;
  return <span className="pill p-done" title={`${cantidad(stock)} ${unit} en almacén`}>Disponible</span>;
}

export default async function CatalogoPage({ searchParams }: PageProps<"/catalogo">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q), category = one(sp.categoria), added = one(sp.anadido);
  const [me, customers, cart] = await Promise.all([apiGet<Me>("/api/me"), apiGet<Customer[]>("/api/customers"), readCart()]);
  const staff = isStaff(me!.user.role);
  // El comercial elige cliente; si ya tiene un carrito empezado, se abre con ese cliente.
  const customerId = one(sp.cliente) || (staff ? cart.customerId ?? "" : "");

  const qs = new URLSearchParams();
  if (customerId) qs.set("customer", customerId);
  if (q) qs.set("q", q);
  if (category) qs.set("category", category);
  const catalog = staff && !customerId ? null : await apiGet<Catalog>(`/api/catalog?${qs}`);
  const customer = catalog?.customer ?? null;

  const link = (p: Record<string, string>) => {
    const u = new URLSearchParams();
    if (staff && customerId) u.set("cliente", customerId);
    if (q) u.set("q", q);
    for (const [k, v] of Object.entries(p)) if (v) u.set(k, v); else u.delete(k);
    const s = u.toString();
    return s ? `/catalogo?${s}` : "/catalogo";
  };
  const here = link({ categoria: category });
  const inCart = customer && cart.customerId === customer.erpId ? cart.lines : {};
  const otherCart = customer && cart.customerId && cart.customerId !== customer.erpId && cartCount(cart) > 0;
  const addedItem = catalog?.items.find((i) => i.product.erpId === added);

  return (
    <>
      <PageHeader title="Hacer un pedido" sub={customer ? `Precios para ${customer.name}` : "Elige el cliente para ver su catálogo y sus precios"}>
        {cartCount(cart) > 0 && <Link className="btn primary" href="/carrito">Ver carrito ({cartCount(cart)})</Link>}
      </PageHeader>

      {staff && (
        <form className="toolbar" action="/catalogo" style={{ marginBottom: 16 }}>
          <select name="cliente" className="search" style={{ flex: "0 1 320px" }} defaultValue={customerId} aria-label="Cliente" required>
            <option value="" disabled>Elige un cliente…</option>
            {(customers ?? []).map((c) => <option key={c.erpId} value={c.erpId}>{c.name}</option>)}
          </select>
          <button className="btn" type="submit">Ver catálogo</button>
        </form>
      )}

      {addedItem && (
        <div className="banner" role="status" style={{ marginBottom: 12 }}>
          <span className="status-dot" /> Añadido al carrito: {addedItem.product.description}
          <Link className="btn sm" href="/carrito">Ir al carrito</Link>
        </div>
      )}
      {otherCart && (
        <div className="banner" style={{ marginBottom: 12 }}>
          Tienes un carrito empezado para otro cliente. Si añades artículos aquí, se vaciará y empezará uno nuevo para {customer!.name}.
        </div>
      )}

      {catalog && customer ? (
        <section className="panel">
          <div className="panel-h" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <form className="toolbar" action="/catalogo">
              {staff && <input type="hidden" name="cliente" value={customerId} />}
              {category && <input type="hidden" name="categoria" value={category} />}
              <input name="q" className="search" type="search" defaultValue={q} placeholder="Buscar por descripción o código de artículo" aria-label="Buscar artículo" />
              <button className="btn" type="submit">Buscar</button>
            </form>
            <div className="chips" role="group" aria-label="Categoría">
              <Link className="chip" href={link({ categoria: "" })} aria-current={!category ? "true" : undefined}>Todas</Link>
              {catalog.categories.map((c) => (
                <Link key={c} className="chip" href={link({ categoria: c })} aria-current={category === c ? "true" : undefined}>{c}</Link>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Artículo</th><th className="hide-m">Disponibilidad</th><th className="r">Precio</th><th>Cantidad</th></tr></thead>
              <tbody>
                {catalog.items.length === 0 && <tr><td colSpan={4}><div className="empty">No hay artículos con esa búsqueda.</div></td></tr>}
                {catalog.items.map(({ product: p, price, specialPrice }) => (
                  <tr key={p.erpId}>
                    <td>
                      {p.description}
                      <div className="sub"><span className="mono">{p.erpId}</span>{p.category && <> · {p.category}</>}{p.minQuantity > 1 && <> · mínimo {cantidad(p.minQuantity)} {p.unit}</>}</div>
                    </td>
                    <td className="hide-m"><Availability stock={p.stock} unit={p.unit} /></td>
                    <td className="r num">
                      {eur(price)}<span className="sub"> / {p.unit}</span>
                      {specialPrice && <div className="sub" style={{ color: "var(--good)" }}>Su precio · tarifa {eur(p.basePrice)}</div>}
                    </td>
                    <td>
                      <form action={addToCart} className="qty-form">
                        <input type="hidden" name="customer" value={customer.erpId} />
                        <input type="hidden" name="material" value={p.erpId} />
                        <input type="hidden" name="back" value={here} />
                        <input className="qty" name="qty" type="number" inputMode="decimal" min={p.minQuantity} step="any" defaultValue={p.minQuantity} aria-label={`Cantidad de ${p.description}`} required />
                        <button className="btn sm" type="submit">Añadir</button>
                      </form>
                      {inCart[p.erpId] && <div className="sub">En el carrito: {cantidad(inCart[p.erpId])} {p.unit}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        staff && <div className="empty">Elige un cliente para empezar el pedido.</div>
      )}
      {!staff && !catalog?.customer && <div className="empty">Tu usuario no tiene un cliente asociado.</div>}
    </>
  );
}
