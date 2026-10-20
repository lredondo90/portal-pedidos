import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/Pills";
import { SalesChart } from "@/components/SalesChart";
import { apiGet, isAdmin, isStaff, type Me, type MonthFigures, type SalesDashboard } from "@/lib/api";
import { closeMonth, markPaid, reopenMonth } from "@/lib/comisiones";
import { eur, fecha, MESES_LARGOS, porcentaje } from "@/lib/format";

function Estado({ m, closable }: { m: MonthFigures; closable: boolean }) {
  if (m.settlement?.paidAt) return <span className="pill p-done">Pagada</span>;
  if (m.settlement) return <span className="pill p-ship">Liquidada</span>;
  return closable ? <span className="pill p-prep">Por liquidar</span> : <span className="pill p-inv">En curso</span>;
}

function Meter({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className="meter" style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div>;
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function VentasPage({ searchParams }: PageProps<"/ventas">) {
  const raw = await searchParams;
  const sp = { anio: one(raw.anio), comercial: one(raw.comercial), mes: one(raw.mes), error: one(raw.error) };
  const me = await apiGet<Me>("/api/me");
  if (!me || !isStaff(me.user.role)) redirect("/");
  const admin = isAdmin(me.user.role);

  const now = new Date();
  const thisYear = now.getFullYear();
  const year = Number(sp.anio) || thisYear;
  const rep = admin ? sp.comercial : undefined;
  const q = new URLSearchParams({ year: String(year), ...(rep ? { rep } : {}) });
  const [dash, all] = await Promise.all([
    apiGet<SalesDashboard>(`/api/sales?${q}`),
    admin && rep ? apiGet<SalesDashboard>(`/api/sales?year=${year}`) : null,
  ]);
  if (!dash) redirect("/ventas");

  const reps = (all ?? dash).reps;
  const single = dash.reps.length === 1 ? dash.reps[0] : null;
  const months = single?.months ?? dash.months;
  const sum = (k: "invoiced" | "collected" | "total") => months.reduce((s, m) => s + m[k], 0);
  const currentMonth = year === thisYear ? now.getMonth() + 1 : year < thisYear ? 12 : 0;
  const cur = currentMonth ? months[currentMonth - 1] : null;
  const pending = dash.reps.reduce((s, r) => s + r.pendingCollection, 0);
  const overdue = dash.reps.reduce((s, r) => s + r.overdue, 0);
  const basisLabel = dash.basis === "Cobrado" ? "lo cobrado" : "lo facturado";
  const lastWithSales = [...months].reverse().find((m) => m.base > 0)?.month;
  const month = Number(sp.mes) || lastWithSales || currentMonth || 1;
  const lines = dash.lines.filter((l) => Number(l.date.slice(5, 7)) === month);
  const isPast = (m: number) => year < thisYear || (year === thisYear && m < now.getMonth() + 1);
  const link = (p: Partial<Record<"anio" | "comercial" | "mes", string | number | undefined>>) => {
    const u = new URLSearchParams();
    const next = { anio: year, comercial: rep, mes: sp.mes, ...p };
    for (const [k, v] of Object.entries(next)) if (v != null && v !== "") u.set(k, String(v));
    return `/ventas?${u}`;
  };
  const back = link({});
  const maxCustomer = Math.max(1, ...dash.topCustomers.map((c) => c.amount));
  const maxCategory = Math.max(1, ...dash.categories.map((c) => c.amount));

  return (
    <>
      <PageHeader
        title="Ventas y comisiones"
        sub={`${single ? single.name : admin ? "Todos los comerciales" : "Tus ventas"} · ${year} · comisión sobre ${basisLabel}`}
      >
        <div className="toolbar">
          <div className="chips">
            {[thisYear - 1, thisYear].map((y) => (
              <Link key={y} className="chip" aria-current={y === year ? "true" : undefined} href={link({ anio: y, mes: undefined })}>{y}</Link>
            ))}
          </div>
          {admin && <Link className="btn sm" href="/comisiones">Reglas y objetivos</Link>}
        </div>
      </PageHeader>

      {sp.error && <div className="banner bad" style={{ marginBottom: 16 }}>{sp.error}</div>}

      {admin && (
        <div className="chips" style={{ marginBottom: 16 }} aria-label="Comercial">
          <Link className="chip" aria-current={!rep ? "true" : undefined} href={link({ comercial: undefined })}>Todos</Link>
          {reps.map((r) => (
            <Link key={r.salesRepId} className="chip" aria-current={rep === r.salesRepId ? "true" : undefined} href={link({ comercial: r.salesRepId })}>{r.name}</Link>
          ))}
        </div>
      )}

      <div className="grid kpis">
        <div className="kpi"><span className="label">Facturado en {year}</span><span className="v num">{eur(sum("invoiced"))}</span><span className="s">Cobrado {eur(sum("collected"))}</span></div>
        <div className="kpi"><span className="label">Comisión {year}</span><span className="v num">{eur(sum("total"))}</span><span className="s">Sobre {basisLabel}</span></div>
        <div className="kpi">
          <span className="label">{cur ? `Objetivo de ${MESES_LARGOS[cur.month - 1]}` : "Objetivo"}</span>
          {cur?.target ? (
            <>
              <span className="v num">{Math.round((cur.base / cur.target) * 100)} %</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Meter value={cur.base} max={cur.target} /><span className="sub num">{eur(cur.base)} de {eur(cur.target)}</span></div>
            </>
          ) : <><span className="v">—</span><span className="s">Sin objetivo definido</span></>}
        </div>
        <div className={`kpi ${overdue ? "alert" : ""}`}><span className="label">Pendiente de cobro</span><span className="v num">{eur(pending)}</span><span className="s">{overdue ? `${eur(overdue)} vencido` : "Nada vencido"}</span></div>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><h2>Base de comisión por mes</h2><span className="sub">{dash.basis === "Cobrado" ? "Cobrado" : "Facturado"} cada mes frente al objetivo</span></div>
        <div className="panel-b chart-wrap"><SalesChart months={months} selected={month} hrefFor={(m) => link({ mes: m })} /></div>
      </section>

      {admin && !single ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h"><h2>Por comercial</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Comercial</th><th className="r">Facturado</th><th className="r hide-m">Cobrado</th><th>Objetivo del año</th><th className="r">Comisión</th><th className="r hide-m">Pendiente</th></tr></thead>
              <tbody>
                {dash.reps.map((r) => {
                  const base = r.months.reduce((s, m) => s + m.base, 0);
                  return (
                    <tr key={r.salesRepId}>
                      <td><Link className="link" href={link({ comercial: r.salesRepId })}>{r.name}</Link></td>
                      <td className="r num">{eur(r.invoiced)}</td>
                      <td className="r num hide-m">{eur(r.collected)}</td>
                      <td>{r.target ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Meter value={base} max={r.target} /><span className="sub num">{Math.round((base / r.target) * 100)} %</span></div> : <span className="sub">Sin objetivo</span>}</td>
                      <td className="r num"><b>{eur(r.commission)}</b></td>
                      <td className="r num hide-m">{eur(r.pendingCollection)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h"><h2>Mes a mes</h2>{admin && <span className="sub">Al liquidar un mes, su comisión queda fijada</span>}</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Mes</th><th className="r hide-m">Facturado</th><th className="r">Base</th><th className="r hide-m">Objetivo</th><th className="r">Comisión</th><th>Estado</th>{admin && single && <th></th>}</tr></thead>
              <tbody>
                {months.filter((m) => m.base > 0 || m.invoiced > 0 || m.settlement || (currentMonth && m.month <= currentMonth)).map((m) => (
                  <tr key={m.month} style={m.month === month ? { background: "var(--surface-2)" } : undefined}>
                    <td><Link className="link" href={link({ mes: m.month })}>{MESES_LARGOS[m.month - 1]}</Link></td>
                    <td className="r num hide-m">{eur(m.invoiced)}</td>
                    <td className="r num">{eur(m.base)}</td>
                    <td className="r num hide-m">{m.target ? <>{eur(m.target)}<div className="sub">{Math.round((m.base / m.target) * 100)} %</div></> : <span className="sub">—</span>}</td>
                    <td className="r num">
                      <b>{eur(m.total)}</b>
                      {!m.settlement && m.bonus > 0 && <div className="sub">incl. {eur(m.bonus)} por objetivo</div>}
                      {m.settlement && Math.abs(m.settlement.commission - (m.commission + m.bonus)) >= 0.005 && <div className="sub">hoy saldría {eur(m.commission + m.bonus)}</div>}
                    </td>
                    <td><Estado m={m} closable={isPast(m.month)} /></td>
                    {admin && single && (
                      <td className="r">
                        <form className="toolbar" style={{ justifyContent: "flex-end" }}>
                          <input type="hidden" name="rep" value={single.salesRepId} />
                          <input type="hidden" name="year" value={year} />
                          <input type="hidden" name="month" value={m.month} />
                          <input type="hidden" name="back" value={back} />
                          {!m.settlement && isPast(m.month) && <button className="btn sm primary" formAction={closeMonth}>Liquidar</button>}
                          {m.settlement && !m.settlement.paidAt && <button className="btn sm" formAction={markPaid}>Marcar pagada</button>}
                          {m.settlement && !m.settlement.paidAt && <button className="btn sm" formAction={reopenMonth}>Reabrir</button>}
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid two" style={{ marginTop: 16 }}>
        <section className="panel">
          <div className="panel-h"><h2>Mejores clientes</h2><span className="sub">Facturado en {year}</span></div>
          <div className="list">
            {dash.topCustomers.length ? dash.topCustomers.map((c) => (
              <div className="li" key={c.id}>
                <div style={{ minWidth: 0, flex: 1 }}><b>{c.name}</b><Meter value={c.amount} max={maxCustomer} /></div>
                <b className="num">{eur(c.amount)}</b>
              </div>
            )) : <div className="empty">Sin ventas este año.</div>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Por familia</h2><span className="sub">Facturado en {year}</span></div>
          <div className="list">
            {dash.categories.length ? dash.categories.map((c) => (
              <div className="li" key={c.id}>
                <div style={{ minWidth: 0, flex: 1 }}><b>{c.name}</b><Meter value={c.amount} max={maxCategory} /></div>
                <b className="num">{eur(c.amount)}</b>
              </div>
            )) : <div className="empty">Sin ventas este año.</div>}
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <h2>De dónde sale la comisión de {MESES_LARGOS[month - 1]}</h2>
          <span className="sub">{lines.length} línea{lines.length === 1 ? "" : "s"} · {eur(lines.reduce((s, l) => s + l.commission, 0))}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{dash.basis === "Cobrado" ? "Cobrada" : "Fecha"}</th><th className="hide-m">Factura</th><th>Cliente</th><th className="hide-m">Familia</th><th className="r">Base</th><th className="r">%</th><th className="r">Comisión</th></tr></thead>
            <tbody>
              {lines.length ? lines.map((l, i) => (
                <tr key={`${l.invoiceId}-${l.category}-${i}`}>
                  <td className="num">{fecha(l.date)}</td>
                  <td className="mono hide-m">{l.invoiceId}</td>
                  <td>{l.customerName}{!single && <div className="sub">{reps.find((r) => r.salesRepId === l.salesRepId)?.name}</div>}</td>
                  <td className="hide-m">{l.category ?? <span className="sub">Sin familia</span>}</td>
                  <td className="r num">{eur(l.base)}</td>
                  <td className="r num">{porcentaje(l.rate)}</td>
                  <td className="r num">{eur(l.commission)}</td>
                </tr>
              )) : <tr><td colSpan={7} className="empty">No hay ventas {dash.basis === "Cobrado" ? "cobradas" : "facturadas"} en {MESES_LARGOS[month - 1]}.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
