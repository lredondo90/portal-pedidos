import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/Pills";
import { apiGet, type CommissionConfig, type CommissionRule } from "@/lib/api";
import { deleteRule, saveRule, saveSettings, saveTarget } from "@/lib/comisiones";
import { eurRedondo, fecha, MESES, porcentaje } from "@/lib/format";

// Administración de comisiones: datos propios del portal que no existen en SAP.

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const OK: Record<string, string> = {
  ajustes: "Ajustes guardados.",
  regla: "Regla guardada.",
  borrada: "Regla borrada.",
  objetivo: "Objetivo guardado.",
};

export default async function ComisionesPage({ searchParams }: PageProps<"/comisiones">) {
  const sp = await searchParams;
  const year = Number(one(sp.anio)) || new Date().getFullYear();
  const cfg = await apiGet<CommissionConfig>(`/api/commissions/config?year=${year}`);
  if (!cfg) redirect("/ventas");
  const error = one(sp.error);
  const ok = OK[one(sp.ok) ?? ""];
  const editing = cfg.rules.find((r) => r.id === one(sp.editar));

  const repName = (id?: string | null) => (id ? cfg.salesReps.find((r) => r.erpId === id)?.name ?? id : null);
  const customerName = (id?: string | null) => (id ? cfg.customers.find((c) => c.erpId === id)?.name ?? id : null);
  const appliesTo = (r: CommissionRule) =>
    [repName(r.salesRepId), customerName(r.customerId), r.category && `familia ${r.category}`].filter(Boolean).join(" · ") || "Todas las ventas";
  const target = (rep: string, m: number) => cfg.targets.find((t) => t.salesRepId === rep && t.month === m)?.amount;

  return (
    <>
      <PageHeader title="Reglas y objetivos" sub="Cómo se calculan las comisiones. Estos datos son del portal, no de SAP.">
        <Link className="btn sm" href="/ventas">Ver ventas y comisiones</Link>
      </PageHeader>
      {error && <div className="banner bad" style={{ marginBottom: 16 }}>{error}</div>}
      {ok && <div className="banner" style={{ marginBottom: 16 }}>{ok}</div>}

      <div className="grid two">
        <section className="panel">
          <div className="panel-h"><h2>Porcentajes de comisión</h2></div>
          <div className="panel-b sub">Gana la regla más concreta: primero la de cliente, luego la de familia y luego la del comercial. Si ninguna encaja, se usa el porcentaje general.</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Se aplica a</th><th className="r">%</th><th className="hide-m">Vigencia</th><th></th></tr></thead>
              <tbody>
                <tr><td>Porcentaje general</td><td className="r num">{porcentaje(cfg.settings.defaultRate)}</td><td className="hide-m sub">Siempre</td><td></td></tr>
                {cfg.rules.map((r) => (
                  <tr key={r.id}>
                    <td>{appliesTo(r)}{r.note && <div className="sub">{r.note}</div>}</td>
                    <td className="r num" style={{ whiteSpace: "nowrap" }}>{porcentaje(r.rate)}</td>
                    <td className="hide-m sub">{r.validFrom || r.validTo ? `${r.validFrom ? fecha(r.validFrom) : "…"} – ${r.validTo ? fecha(r.validTo) : "…"}` : "Siempre"}</td>
                    <td className="r">
                      <form action={deleteRule} className="toolbar" style={{ justifyContent: "flex-end" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <Link className="btn sm" href={`/comisiones?editar=${encodeURIComponent(r.id)}#regla`}>Cambiar</Link>
                        <button className="btn sm" type="submit">Borrar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid" style={{ alignContent: "start" }}>
          <section className="panel">
            <div className="panel-h"><h2>Ajustes generales</h2></div>
            <form action={saveSettings} className="panel-b form">
              <div className="fields">
                <label className="field">Se paga sobre
                  <select name="basis" defaultValue={cfg.settings.basis}>
                    <option value="Cobrado">Lo cobrado</option>
                    <option value="Facturado">Lo facturado</option>
                  </select>
                </label>
                <label className="field">Porcentaje general (%)
                  <input name="defaultRate" inputMode="decimal" defaultValue={cfg.settings.defaultRate} required />
                </label>
                <label className="field">Extra al superar el objetivo (%)
                  <input name="bonusRate" inputMode="decimal" defaultValue={cfg.settings.bonusRate} required />
                </label>
              </div>
              <span className="sub">El extra se aplica solo a lo que pase del objetivo del mes.</span>
              <div><button className="btn primary" type="submit">Guardar ajustes</button></div>
            </form>
          </section>

          <section className="panel" id="regla">
            <div className="panel-h"><h2>{editing ? "Cambiar regla" : "Nueva regla"}</h2>{editing && <Link className="btn sm" href="/comisiones">Cancelar</Link>}</div>
            <form action={saveRule} className="panel-b form" key={editing?.id ?? "nueva"}>
              <input type="hidden" name="id" value={editing?.id ?? ""} />
              <div className="fields">
                <label className="field">Comercial
                  <select name="salesRepId" defaultValue={editing?.salesRepId ?? ""}>
                    <option value="">Todos</option>
                    {cfg.salesReps.map((r) => <option key={r.erpId} value={r.erpId}>{r.name}</option>)}
                  </select>
                </label>
                <label className="field">Cliente
                  <select name="customerId" defaultValue={editing?.customerId ?? ""}>
                    <option value="">Todos</option>
                    {cfg.customers.map((c) => <option key={c.erpId} value={c.erpId}>{c.name}</option>)}
                  </select>
                </label>
                <label className="field">Familia
                  <select name="category" defaultValue={editing?.category ?? ""}>
                    <option value="">Todas</option>
                    {cfg.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="field">Comisión (%)
                  <input name="rate" inputMode="decimal" defaultValue={editing?.rate ?? ""} required />
                </label>
                <label className="field">Desde (opcional)<input type="date" name="validFrom" defaultValue={editing?.validFrom ?? ""} /></label>
                <label className="field">Hasta (opcional)<input type="date" name="validTo" defaultValue={editing?.validTo ?? ""} /></label>
              </div>
              <label className="field">Nota<input name="note" defaultValue={editing?.note ?? ""} placeholder="Por qué existe esta regla" /></label>
              <div><button className="btn primary" type="submit">Guardar regla</button></div>
            </form>
          </section>
        </div>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <h2>Objetivos mensuales {year}</h2>
          <div className="chips">
            {[year - 1, year, year + 1].map((y) => <Link key={y} className="chip" aria-current={y === year ? "true" : undefined} href={`/comisiones?anio=${y}`}>{y}</Link>)}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Comercial</th>{MESES.map((m) => <th key={m} className="r">{m}</th>)}</tr></thead>
            <tbody>
              {cfg.salesReps.map((r) => (
                <tr key={r.erpId}>
                  <td>{r.name}</td>
                  {MESES.map((_, i) => <td key={i} className="r num sub">{target(r.erpId, i + 1) ? eurRedondo(target(r.erpId, i + 1)!) : "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={saveTarget} className="panel-b toolbar" style={{ borderTop: "1px solid var(--line)" }}>
          <input type="hidden" name="year" value={year} />
          <label className="field">Comercial
            <select name="salesRepId" required>{cfg.salesReps.map((r) => <option key={r.erpId} value={r.erpId}>{r.name}</option>)}</select>
          </label>
          <label className="field">Mes
            <select name="month" defaultValue="">
              <option value="">Todos los meses</option>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="field">Objetivo (€)<input name="amount" inputMode="decimal" required placeholder="0 para quitarlo" /></label>
          <button className="btn primary" type="submit" style={{ alignSelf: "flex-end" }}>Guardar objetivo</button>
        </form>
      </section>
    </>
  );
}
