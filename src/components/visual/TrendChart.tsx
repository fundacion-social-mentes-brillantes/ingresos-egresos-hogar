import { formatCOP } from '../../types';
import type { MonthlyTrendPoint } from '../../lib/reporting';

// Grafica de barras (ingresos vs gastos por mes) hecha con SVG puro: sin
// librerias externas, responsive por viewBox, y con tooltip nativo por barra.
export function TrendChart({ points }: { points: MonthlyTrendPoint[] }) {
  if (!points.length) return null;
  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.expenses]));
  const W = 360;
  const H = 168;
  const padX = 10;
  const padTop = 10;
  const padBottom = 24;
  const chartH = H - padTop - padBottom;
  const baseY = padTop + chartH;
  const groupW = (W - padX * 2) / points.length;
  const barW = Math.max(6, Math.min(16, groupW / 2 - 3));

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-4 text-[11px] font-black">
        <span className="flex items-center gap-1.5 text-green-300"><span className="h-2.5 w-2.5 rounded-sm bg-green-400" />Ingresos</span>
        <span className="flex items-center gap-1.5 text-red-300"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" />Gastos</span>
      </div>
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[320px]" role="img" aria-label="Tendencia de ingresos y gastos por mes">
          <line x1={padX} y1={baseY} x2={W - padX} y2={baseY} stroke="rgba(148,163,184,0.25)" strokeWidth="1" />
          {points.map((p, i) => {
            const center = padX + i * groupW + groupW / 2;
            const incH = (p.income / max) * chartH;
            const expH = (p.expenses / max) * chartH;
            return (
              <g key={i}>
                <rect x={center - barW - 1} y={baseY - incH} width={barW} height={incH} rx={2} fill="#34d399">
                  <title>{`${p.label}: ingresos ${formatCOP(p.income)}`}</title>
                </rect>
                <rect x={center + 1} y={baseY - expH} width={barW} height={expH} rx={2} fill="#f87171">
                  <title>{`${p.label}: gastos ${formatCOP(p.expenses)}`}</title>
                </rect>
                <text x={center} y={H - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="rgba(148,163,184,0.9)">{p.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
