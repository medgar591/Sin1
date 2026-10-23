import { clampN } from './common';

interface ChartProps {
  title: string;
  values: number[];
  format: (n: number) => string;
  color?: string;
  bars?: boolean;
  threshold?: number;
  fixedMin?: number;
  fixedMax?: number;
}

const W = 320;
const H = 96;
const PAD = 6;

export function Chart({ title, values, format, color = 'var(--cyan)', bars, threshold, fixedMin, fixedMax }: ChartProps) {
  const cur = values.length ? values[values.length - 1] : null;
  let min = Math.min(...values, ...(threshold !== undefined ? [threshold] : []));
  let max = Math.max(...values, ...(threshold !== undefined ? [threshold] : []));
  if (bars) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (fixedMin !== undefined) min = fixedMin;
  if (fixedMax !== undefined) max = fixedMax;
  if (!isFinite(min) || min === max) { min = (isFinite(min) ? min : 0) - 1; max = min + 2; }
  const y = (v: number) => PAD + (1 - (v - min) / (max - min)) * (H - PAD * 2);
  const x = (i: number) => (values.length <= 1 ? W / 2 : PAD + (i / (values.length - 1)) * (W - PAD * 2));
  const delta = values.length > 1 ? values[values.length - 1] - values[values.length - 2] : 0;
  const up = delta >= 0;
  const summary = cur === null ? title : [
    `${title}: now ${format(cur)}${values.length > 1 ? `, ${up ? 'up' : 'down'} ${format(Math.abs(delta))} on last month` : ''}`,
    `low ${format(Math.min(...values))}, high ${format(Math.max(...values))} over ${values.length} ${values.length === 1 ? 'month' : 'months'}`,
  ].join('; ') + (threshold !== undefined ? `. Dashed line at ${format(threshold)}` : '');

  return (
    <div class="card chart">
      <div class="hd">
        <span class="label">{title}</span>
        <span class="mono" style={{ color }}>
          {cur === null ? '—' : format(cur)}
          {values.length > 1 && (
            <span class={up ? 'green' : 'red'} style={{ fontSize: '11px', marginLeft: '6px' }}>
              <span aria-hidden="true">{up ? '▲' : '▼'}</span> <span class="sr-only">{up ? 'up' : 'down'} </span>{format(Math.abs(delta))}
            </span>
          )}
        </span>
      </div>
      {values.length === 0 ? (
        <div class="hint" style={{ padding: '20px 0' }}>No data yet. End a month to start the record.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
          <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="var(--rule)" />
          {bars && <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="var(--faint)" stroke-width="1" />}
          {threshold !== undefined && (
            <line x1={PAD} x2={W - PAD} y1={y(threshold)} y2={y(threshold)} stroke="var(--red)" stroke-dasharray="4 3" stroke-width="1" />
          )}
          {bars ? (
            values.map((v, i) => {
              const bw = Math.max(2, ((W - PAD * 2) / values.length) * 0.7);
              const y0 = y(0);
              const y1 = y(v);
              return (
                <rect key={i} x={x(i) - bw / 2} width={bw} y={Math.min(y0, y1)} height={Math.max(1, Math.abs(y1 - y0))} fill={v >= 0 ? 'var(--green)' : 'var(--red)'} />
              );
            })
          ) : (
            <>
              <polyline fill="none" stroke={color} stroke-width="1.8" stroke-linejoin="round" points={values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
              <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3" fill={color} />
            </>
          )}
        </svg>
      )}
      {values.length > 0 && (
        <div class="row small faint mono" aria-hidden="true" style={{ justifyContent: 'space-between' }}>
          <span>low {format(Math.min(...values))}</span>
          <span>{values.length} mo</span>
          <span>high {format(Math.max(...values))}</span>
        </div>
      )}
      {threshold !== undefined && <div class="hint">Dashed line: {format(threshold)}</div>}
    </div>
  );
}

export { clampN };
