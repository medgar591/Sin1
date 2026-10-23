import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { GameState, OrgUnit, Person, PersonId, Trait, UnitId, UnitKind } from '../sim/types';
import { fullName, hasAttention, unit as getUnit, unitAncestry } from '../sim/org';
import { closeSheet, openPerson, S } from './store';
import { Portrait } from './portrait';

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
    <span class="pips" role="img" aria-label={`${n} of ${of} attention`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} class={`pip ${i < n ? 'on' : ''}`} aria-hidden="true" />
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
    <button type="button" class={`btn ${cls}`} disabled={disabled || short} onClick={onClick} title={short ? 'Not enough attention' : title}>
      {children}
      {cost > 0 && <span class="cost" aria-hidden="true">{'●'.repeat(cost)}</span>}
      {cost > 0 && <span class="sr-only">, costs {cost} attention</span>}
      {short && <span class="sr-only">, not enough attention</span>}
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
        <button type="button" key={v} class={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>
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
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  max?: number;
  format?: (n: number) => string;
  small?: boolean;
  /** What the value is, for screen readers: "Decrease <label>". */
  label?: string;
}) {
  return (
    <div class={`stepper ${small ? 'sm' : ''}`}>
      <button type="button" aria-label={label ? `Decrease ${label}` : 'Decrease'} onClick={() => onChange(clampN(value - step, min, max))}>−</button>
      <div class="v" aria-live="polite">{format(value)}</div>
      <button type="button" aria-label={label ? `Increase ${label}` : 'Increase'} onClick={() => onChange(clampN(value + step, min, max))}>+</button>
    </div>
  );
}

/** Moves inert onto the page behind open sheets: the page, and every sheet except the top one. */
function syncPageInert(): void {
  const scrims = document.querySelectorAll('.scrim');
  const open = scrims.length > 0;
  document.querySelectorAll('.topbar, .main, .tabbar').forEach((el) => (open ? el.setAttribute('inert', '') : el.removeAttribute('inert')));
  scrims.forEach((el, i) => (i < scrims.length - 1 ? el.setAttribute('inert', '') : el.removeAttribute('inert')));
}

if (typeof document !== 'undefined') {
  // Escape closes the top sheet.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.sheets.length > 0) closeSheet();
  });
}

/** Keeps Tab and Shift+Tab cycling inside the sheet. */
function trapTab(e: KeyboardEvent): void {
  if (e.key !== 'Tab') return;
  const sheet = e.currentTarget as HTMLElement;
  const all = [...sheet.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
  if (!all.length) return;
  const first = all[0];
  const last = all[all.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function Sheet({ title, children }: { title: ComponentChildren; children: ComponentChildren }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const was = document.activeElement;
    closeRef.current?.focus();
    syncPageInert();
    return () => {
      // Deferred: the sheet's DOM is still there now, and the next sheet down must be live before focus goes back to it.
      setTimeout(() => {
        syncPageInert();
        // Back to the opener. If it has gone: the sheet below, else the page heading (not End month, where a second Enter would end another month).
        const opener = was instanceof HTMLElement && was !== document.body && was.isConnected && !was.closest('[inert]') ? was : null;
        const scrims = document.querySelectorAll('.scrim');
        const below = scrims.length ? scrims[scrims.length - 1].querySelector<HTMLElement>('.hd .btn') : null;
        (opener ?? below ?? document.querySelector<HTMLElement>('.main h1'))?.focus();
      }, 0);
    };
  }, []);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && closeSheet()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapTab}>
        <div class="hd">
          <h2 class="grow" id={titleId}>{title}</h2>
          <button type="button" class="btn sm" ref={closeRef} onClick={closeSheet}>Close</button>
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
    <button type="button" class="chip" onClick={() => openPerson(id)}>
      <Portrait id={id} size={20} />
      <span class="nm">{fullName(p)}</span>
    </button>
  );
}

export function PersonLink({ id }: { id: PersonId }) {
  const p = S.game?.people[id];
  if (!p) return <span class="dim">—</span>;
  return (
    <button type="button" class="link" onClick={() => openPerson(id)}>
      {fullName(p)}
    </button>
  );
}

/** Plain words for how a person feels about the CEO (-100..100). */
export function stanceWord(opinion: number): string {
  return opinion <= -50 ? 'Hostile' : opinion <= -15 ? 'Wary' : opinion < 15 ? 'Neutral' : opinion < 50 ? 'Warm' : 'Devoted';
}

/** CSS colour for a stance. */
export function stanceColor(opinion: number): string {
  return opinion <= -50 ? 'var(--red)' : opinion <= -15 ? 'var(--amber)' : opinion < 15 ? 'var(--dim)' : opinion < 50 ? 'var(--green)' : 'var(--cyan)';
}

export function stanceTone(opinion: number): 'red' | 'amber' | '' | 'green' | 'cyan' {
  return opinion <= -50 ? 'red' : opinion <= -15 ? 'amber' : opinion < 15 ? '' : opinion < 50 ? 'green' : 'cyan';
}

export function loyaltyWord(loyalty: number): string {
  return loyalty < 25 ? 'Fragile' : loyalty < 40 ? 'Shaky' : loyalty < 60 ? 'Steady' : loyalty < 80 ? 'Firm' : 'Devoted';
}

/** What a trait means, in one line. */
export const TRAIT_TEXT: Record<Trait, string> = {
  principled: 'Keeps to their values; hard to bribe or bully.',
  paranoid: 'Suspects everyone; hard to win over.',
  vain: 'Craves recognition and status.',
  ruthless: 'Will step on others to get ahead.',
  charming: 'Wins people over; makes allies easily.',
  diligent: 'Works hard and reliably.',
  lazy: 'Does the minimum unless pushed.',
  gossip: 'Talks too much; secrets around them leak.',
  cautious: 'Avoids risk; slow to act or scheme.',
  reckless: 'Acts first; takes big risks.',
  generous: 'Shares credit and looks after their people.',
  petty: 'Holds grudges over small slights.',
};

/** How far along a campaign against someone is, in words. */
export function plotStage(progress: number): string {
  return progress < 40 ? 'whispering' : progress < 75 ? 'courting allies' : 'close to moving';
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
        <b>Your job:</b> hit the guidance you announce, satisfy the directors' quarterly asks, and keep board confidence above 30.
        Your secretary's agenda on the dashboard lists what needs you.
      </p>
      <p style={{ margin: '0 0 6px' }}>
        Each month you have <b>{n} attention</b> (the dots at the top). Meeting, hiring, firing, promoting, demoting, reassigning,
        investigating, restructuring, lobbying and fixer jobs each cost one. Pay, options, budgets, guidance and bonuses are free.
      </p>
      <p style={{ margin: '0 0 6px' }}>
        You can act on anyone, but acting on someone below your direct reports <b>goes around their bosses</b> and costs you their loyalty.
        People who are on your radar (a scandal, a breakthrough) are exempt for a while.
      </p>
      <p style={{ margin: '0 0 6px' }}>
        People come to you: your inbox is who is waiting to see you. The Org tab's Chart shows who reports to whom; Players shows who matters.
      </p>
      <p style={{ margin: 0 }}>Unspent attention does not carry over. Tap <b>End month</b> when you are done; the board meets after every third month.</p>
    </div>
  );
}
