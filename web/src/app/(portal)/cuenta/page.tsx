import { PageHeader } from "@/components/Pills";
import { apiGet, type Customer } from "@/lib/api";
import { eur } from "@/lib/format";

export default async function CuentaPage() {
  const customers = await apiGet<Customer[]>("/api/customers");
  const c = customers?.[0];
  return (
    <>
      <PageHeader title="Mi cuenta" sub="Datos de cliente tal como figuran en SAP" />
      {c ? (
        <section className="panel" style={{ maxWidth: 720 }}>
          <div className="panel-h"><h2>Datos de empresa</h2></div>
          <div className="panel-b">
            <dl className="kv">
              <dt>Razón social</dt><dd>{c.name}</dd>
              <dt>Nº de cliente</dt><dd className="mono">{c.erpId}</dd>
              {c.taxId && <><dt>NIF</dt><dd className="mono">{c.taxId}</dd></>}
              {c.address && <><dt>Dirección</dt><dd>{c.address}</dd></>}
              {c.paymentTerms && <><dt>Condiciones de pago</dt><dd>{c.paymentTerms}</dd></>}
              {c.creditLimit != null && <><dt>Límite de crédito</dt><dd className="num">{eur(c.creditLimit)}</dd></>}
            </dl>
          </div>
        </section>
      ) : <div className="empty">No hay datos de cliente asociados a tu usuario.</div>}
    </>
  );
}
