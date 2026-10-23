import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { GameState, OrgUnit, Person, PersonId, UnitId, UnitKind } from '../sim/types';
import { fullName, hasAttention, unit as getUnit, unitAncestry } from '../sim/org';
import { closeSheet, openPerson, S } from './store';

export const KIND_LABEL: Record<UnitKind, string> = {
  executive: 'CEO',
  function: 'Function',
  division: 'Division',
  subdivision: 'Sub-div',
  team: 'Team',
  subteam: 'Sub-team',
};

export const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const signed = (n: number) => (n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);
export const zuzuPrice = (n: number) => `${n.toFixed(2)}ㄓ`;
export const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function levelClass(v: number, warn = 45, bad = 30): '' | 'a' | 'r' {
  return v < bad ? 'r' : v < warn ? 'a' : '';
}

export function Bar({ value, max = 100, cls = '' }: { value: number; max?: number; cls?: string }) {
  const w = clampN((value / max) * 100, 0, 100);
  return (
    <div class={`bar ${cls}`}>
      <i style={{ width: `${w}%` }} />
    </div>
  );
}

export function DivBar({ value }: { value: number }) {
  const v = clampN(value, -100, 100);
  const style: JSX.CSSProperties =
    v >= 0
      ? { left: '50%', width: `${v / 2}%`, background: 'var(--green)' }
      : { left: `${50 + v / 2}%`, width: `${-v / 2}%`, background: 'var(--red)' };
  return (
    <div class="dbar">
      <i style={style} />
    </div>
  );
}

export function Pips({ n, of }: { n: number; of: number }) {
  return (
    <span class="pips" aria-label={`${n} of ${of} attention`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} class={`pip ${i < n ? 'on' : ''}`} />
      ))}
    </span>
  );
}

interface BtnProps {
  children: ComponentChildren;
  onClick?: () => void;
  cost?: number;
  cls?: string;
  disabled?: boolean;
  title?: string;
}

/** Button that shows its attention cost and disables itself when unaffordable. */
export function Btn({ children, onClick, cost = 0, cls = '', disabled, title }: BtnProps) {
  const short = cost > (S.game?.player.attentionLeft ?? 0);
  return (
    <button class={`btn ${cls}`} disabled={disabled || short} onClick={onClick} title={short ? 'Not enough attention' : title}>
      {children}
      {cost > 0 && <span class="cost">{'●'.repeat(cost)}</span>}
    </button>
  );
}

/** Two-step button: first tap arms it, second confirms. */
export function ConfirmBtn({ label, confirmLabel, ...rest }: Omit<BtnProps, 'children'> & { label: string; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <Btn
      {...rest}
      cls={`${rest.cls ?? ''} ${armed ? 'danger' : ''}`}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 4000);
        } else {
          setArmed(false);
          rest.onClick?.();
        }
      }}
    >
      {armed ? confirmLabel ?? `Tap again: ${label}` : label}
    </Btn>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg">
      {options.map(([v, l]) => (
        <button key={v} class={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  step,
  min = 0,
  max = Infinity,
  format = (n: number) => String(n),
  small,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  max?: number;
  format?: (n: number) => string;
  small?: boolean;
}) {
  return (
    <div class={`stepper ${small ? 'sm' : ''}`}>
      <button aria-label="less" onClick={() => onChange(clampN(value - step, min, max))}>−</button>
      <div class="v">{format(value)}</div>
      <button aria-label="more" onClick={() => onChange(clampN(value + step, min, max))}>+</button>
    </div>
  );
}

export function Sheet({ title, children }: { title: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && closeSheet()}>
      <div class="sheet" role="dialog">
        <div class="hd">
          <h3 class="grow">{title}</h3>
          <button class="btn sm" onClick={closeSheet}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PersonChip({ id }: { id: PersonId }) {
  const p = S.game?.people[id];
  if (!p) return null;
  return (
    <span class="chip" onClick={() => openPerson(id)}>
      {fullName(p)}
    </span>
  );
}

export function PersonLink({ id }: { id: PersonId }) {
  const p = S.game?.people[id];
  if (!p) return <span class="dim">—</span>;
  return (
    <a class="link" onClick={() => openPerson(id)}>
      {fullName(p)}
    </a>
  );
}

/** 0 fine, 1 amber, 2 red. */
export function personFlag(state: GameState, p: Person): 0 | 1 | 2 {
  if (p.status !== 'active') return 2;
  let f = 0;
  if (p.satisfaction < 30 || p.performance < 30 || p.loyalty < 25) f = 2;
  else if (p.satisfaction < 45 || p.performance < 40 || p.loyalty < 35) f = 1;
  if (hasAttention(state, p) && f < 1) f = 1;
  return f as 0 | 1 | 2;
}

export function unitFlag(state: GameState, u: OrgUnit): 0 | 1 | 2 {
  if (!u.leadId && u.kind !== 'executive') return 2;
  if (u.morale < 30 || u.output < 50) return 2;
  if (u.morale < 45 || u.output < 75) return 1;
  void state;
  return 0;
}

/** Whether feuds, cliques, secrets and relationships of this person are visible. */
export function intelVisible(state: GameState, p: Person): boolean {
  if (p.investigatedMonth !== null) return true;
  if (p.unitId === null) return false;
  for (const u of unitAncestry(state, p.unitId)) {
    if (u.investigatedMonth !== null && state.month - u.investigatedMonth <= 6) return true;
  }
  return false;
}

export function unitIntel(state: GameState, u: OrgUnit): boolean {
  return unitAncestry(state, u.id).some((x) => x.investigatedMonth !== null && state.month - x.investigatedMonth <= 6);
}

export function unitLabel(state: GameState, id: UnitId | null): string {
  if (!id || !state.units[id]) return '—';
  const u = getUnit(state, id);
  return u.kind === 'executive' ? 'CEO office' : u.name;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="hint" style={{ padding: '14px 0' }}>{children}</div>;
}

/** Short explanation of attention and skip-level penalties; shown on first run and in Settings. */
export function Primer() {
  const n = S.game?.player.attentionPerMonth ?? 3;
  return (
    <div class="small" style={{ lineHeight: 1.5 }}>
      <p style={{ margin: '0 0 6px' }}>
        Each month you have <b>{n} attention</b> (the dots at the top). Meeting, hiring, firing, promoting, demoting, reassigning,
        investigating, restructuring, lobbying and fixer jobs each cost one. Pay, options, budgets, guidance and bonuses are free.
      </p>
      <p style={{ margin: '0 0 6px' }}>
        You can act on anyone, but acting on someone below your direct reports <b>goes around their bosses</b> and costs you their loyalty.
        People who are on your radar (a scandal, a breakthrough) are exempt for a while.
      </p>
      <p style={{ margin: 0 }}>Unspent attention does not carry over. Tap <b>End month</b> when you are done; the board meets after every third month.</p>
    </div>
  );
}
