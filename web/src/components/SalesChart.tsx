import Link from "next/link";
import type { MonthFigures } from "@/lib/api";
import { eur, eurRedondo, MESES, MESES_LARGOS } from "@/lib/format";

// Barras de la base de comisión por mes con el objetivo marcado encima. SVG sin librerías;
// cada barra enlaza al detalle de su mes y muestra los importes al pasar por encima.

const W = 720, H = 220, LEFT = 52, BOTTOM = 24, TOP = 10;

function niceMax(v: number) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((n) => n >= v)!;
}

export function SalesChart({ months, selected, hrefFor }: { months: MonthFigures[]; selected: number; hrefFor: (month: number) => string }) {
  const max = niceMax(Math.max(...months.map((m) => Math.max(m.base, m.target ?? 0))));
  const slot = (W - LEFT) / 12;
  const bar = Math.min(28, slot * 0.56);
  const y = (v: number) => TOP + (H - TOP - BOTTOM) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const hasTarget = months.some((m) => m.target);

  return (
    <figure style={{ margin: 0 }}>
      <div className="chart-legend">
        <span><i className="sw-bar" /> Base de comisión</span>
        {hasTarget && <span><i className="sw-target" /> Objetivo</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Base de comisión por mes frente al objetivo">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={LEFT} x2={W} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={LEFT - 8} y={y(t) + 4} textAnchor="end" className="tick">{eurRedondo(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = LEFT + slot * i + slot / 2;
          const top = y(m.base);
          const h = Math.max(0, y(0) - top);
          const r = Math.min(4, h, bar / 2);
          const x = cx - bar / 2;
          return (
            <Link key={m.month} href={hrefFor(m.month)} className={`bar ${m.month === selected ? "on" : ""}`}>
              <title>{`${MESES_LARGOS[m.month - 1]}: ${eur(m.base)}${m.target ? ` de ${eur(m.target)} (${Math.round((m.base / m.target) * 100)} %)` : ""} · comisión ${eur(m.total)}`}</title>
              <rect x={cx - slot / 2} y={TOP} width={slot} height={H - TOP} className="hit" />
              {h > 0 && <path d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r} Q${x + bar},${top} ${x + bar},${top + r} V${y(0)} Z`} />}
              {m.target ? <line x1={cx - slot * 0.42} x2={cx + slot * 0.42} y1={y(m.target)} y2={y(m.target)} className="target" /> : null}
              <text x={cx} y={H - 6} textAnchor="middle" className="tick">{MESES[m.month - 1]}</text>
            </Link>
          );
        })}
        <line x1={LEFT} x2={W} y1={y(0)} y2={y(0)} className="axis" />
      </svg>
    </figure>
  );
}
