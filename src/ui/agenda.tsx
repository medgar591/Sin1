// The CEO's agenda: what needs you this month, how the quarter stands, what the board wants.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { GameState, Person, PersonId } from '../sim/types';
import { secretary, formatZuzu, fullName, isActive, monthLabel, opinionOf } from '../sim/org';
import { askProgress } from '../sim/asks';
import { NO_CONFIDENCE_LEVEL, directorSupport } from '../sim/board';
import { guidanceCredit, quarterOutlook, suggestedGuidance, type QuarterOutlook } from '../sim/economy';
import { setGuidance } from '../sim/actions';
import { ATTENTION_COST } from '../sim/attention';
import { Btn, PersonChip, Stepper, plotStage, stanceWord } from './common';
import { Portrait } from './portrait';
import { OpenAsks } from './board';
import { game, goOrg, openPerson, openSheet, run, setTab } from './store';

interface AgendaItem {
  key: string;
  /** 2 red, 1 amber, 0 neutral. */
  tone: 0 | 1 | 2;
  who?: PersonId;
  text: ComponentChildren;
  sub?: string;
  go?: () => void;
}

const MAX_ITEMS = 6;
const PROMISE_WINDOW = 2;
const TURNING_AT = -10;
/** Board confidence below these gets an amber / red row on the agenda. */
const CONFIDENCE_AMBER = 45;
const CONFIDENCE_RED = 35;
/** The rival stops being the first suggestion once they think this well of the CEO. */
const RIVAL_WON_OVER = 15;
/** An officer who thinks this well of the CEO (or better) is not worth a nudge. */
const MEET_SKIP_OPINION = 50;

const PROMISE_NOUN: Record<string, string> = { promotion: 'a promotion', raise: 'a raise', protection: 'protection', budget: 'a bigger budget' };

const monthName = (m: number) => monthLabel(m).split(' ')[0];

/** Scrolls a dashboard card into view (instantly under reduced motion) and moves focus to it. */
export function scrollToCard(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

export const scrollToQuarter = () => scrollToCard('quarter-card');
const scrollToAsks = () => scrollToCard('asks-card');

export interface MeetingSuggestion {
  id: PersonId;
  opinion: number;
  /** Why this person, in a few words. */
  why: string;
}

/**
 * Who the CEO should see first: the officer passed over for the chair (the
 * briefing names them) unless they have come round, otherwise the officer who
 * thinks least of the CEO. Null when everyone is already won over.
 */
export function suggestedMeeting(g: GameState): MeetingSuggestion | null {
  const ceo = g.player.personId;
  const onStaff = (p: Person | undefined): p is Person => !!p && isActive(p) && p.unitId !== null;
  const rival = g.rivalId ? g.people[g.rivalId] : undefined;
  if (onStaff(rival)) {
    const opinion = opinionOf(g, rival.id, ceo);
    if (opinion < RIVAL_WON_OVER) return { id: rival.id, opinion, why: 'passed over for the chair' };
  }
  const worst = Object.values(g.people)
    .filter((p) => p.role === 'officer' && onStaff(p))
    .map((p) => ({ id: p.id, opinion: opinionOf(g, p.id, ceo) }))
    .sort((a, b) => a.opinion - b.opinion)[0];
  if (!worst || worst.opinion >= MEET_SKIP_OPINION) return null;
  return { ...worst, why: 'your least warm officer' };
}

export function buildAgenda(g: GameState): AgendaItem[] {
  const out: AgendaItem[] = [];
  const q = quarterOutlook(g);
  const ceo = g.player.personId;
  const name = (id: PersonId) => (g.people[id] ? fullName(g.people[id]) : 'Someone');

  if (g.company.guidance === null) {
    out.push({
      key: 'guidance', tone: 1, go: scrollToQuarter,
      text: <>Announce guidance for {q.label.split(' ')[0]}.</>,
      sub: 'The board judges the quarter against it.',
    });
  }

  const plots = Object.entries(g.plots).filter(([pid, p]) => p.known && g.people[pid] && isActive(g.people[pid]));
  for (const [pid, p] of plots.filter(([, p]) => p.targetId === ceo).slice(0, 2)) {
    out.push({ key: `plot${pid}`, tone: 2, who: pid, go: () => openPerson(pid), text: <><b>{name(pid)}</b> is moving against you ({plotStage(p.progress)}).</> });
  }

  const conf = g.company.boardConfidence;
  if (conf < CONFIDENCE_AMBER) {
    out.push({
      key: 'confidence', tone: conf < CONFIDENCE_RED ? 2 : 1, go: () => setTab('board'),
      text: <>Board confidence {Math.round(conf)}. Below {NO_CONFIDENCE_LEVEL} they can vote you out.</>,
      sub: 'Beating guidance and meeting the board’s asks raises it.',
    });
  }

  if (q.monthsLeft === 1) {
    out.push({ key: 'board', tone: 1, text: <>The board meets at the end of this month.</>, sub: 'Your guidance and the directors’ asks are judged then.' });
  }

  for (const d of g.directors) {
    if (!g.people[d.personId] || !isActive(g.people[d.personId])) continue;
    let sup = 0;
    try { sup = directorSupport(g, d.personId); } catch { sup = 0; }
    if (sup < TURNING_AT) out.push({ key: `turn${d.personId}`, tone: 2, who: d.personId, go: () => openPerson(d.personId), text: <><b>{name(d.personId)}</b> is turning against you.</>, sub: 'A director who loses faith votes you out.' });
  }

  const behind = (g.asks ?? []).filter((a) => a.state === 'open' && g.people[a.directorId] && !askProgress(g, a).met);
  if (behind.length) {
    const due = Math.min(...behind.map((a) => a.dueMonth));
    out.push({
      key: 'asks', tone: 1, go: scrollToAsks,
      text: <>{behind.length} board {behind.length === 1 ? 'ask is' : 'asks are'} not on track yet.</>,
      sub: `Due by ${monthLabel(due)}.`,
    });
  }

  if (g.company.bonusPool > 0) {
    out.push({ key: 'bonus', tone: 1, go: () => openSheet({ k: 'bonus' }), text: <>Split the bonus pool ({formatZuzu(g.company.bonusPool)}).</>, sub: 'People expect a share.' });
  }

  const waiting = g.inbox.filter((i) => i.resolution === null).length;
  if (waiting > 0) out.push({ key: 'inbox', tone: 1, go: () => setTab('inbox'), text: <>{waiting} {waiting === 1 ? 'person is' : 'people are'} waiting to see you.</> });

  const due = g.promises
    .filter((p) => p.state === 'open' && p.dueMonth - g.month <= PROMISE_WINDOW && g.people[p.personId] && isActive(g.people[p.personId]))
    .sort((a, b) => a.dueMonth - b.dueMonth)
    .slice(0, 2);
  for (const p of due) {
    out.push({ key: p.id, tone: p.dueMonth <= g.month ? 2 : 1, who: p.personId, go: () => openPerson(p.personId), text: <>You promised <b>{name(p.personId)}</b> {PROMISE_NOUN[p.kind] ?? p.kind}, due {monthLabel(p.dueMonth)}.</>, sub: p.detail });
  }

  const empty = Object.values(g.units).filter((u) => {
    if (u.kind !== 'division' && u.kind !== 'function') return false;
    const lead = u.leadId ? g.people[u.leadId] : undefined;
    return !lead || !isActive(lead);
  });
  if (empty.length) {
    const names = empty.slice(0, 2).map((u) => u.name).join(' or ');
    out.push({ key: 'vacant', tone: 1, go: () => goOrg(empty[0].id), text: <>No one runs {names}{empty.length > 2 ? ` (and ${empty.length - 2} more)` : ''}.</> });
  }

  const other = plots.find(([, p]) => p.targetId !== ceo);
  if (other) {
    const [pid, p] = other;
    out.push({ key: `plotx${pid}`, tone: 1, who: pid, go: () => openPerson(pid), text: <><b>{name(pid)}</b> is working against {name(p.targetId)} ({plotStage(p.progress)}).</> });
  }

  if (g.player.attentionLeft > 0 && !out.some((it) => it.tone === 2)) {
    const m = suggestedMeeting(g);
    if (m) {
      out.push({
        key: 'meet', tone: 0, who: m.id, go: () => openPerson(m.id),
        text: <>Suggestion: meet <b>{name(m.id)}</b> ({stanceWord(m.opinion)}, {m.why}).</>,
        sub: `${g.people[m.id].title} · a meeting costs ${ATTENTION_COST.meet} attention`,
      });
    }
  }

  out.sort((a, b) => b.tone - a.tone || 0);
  return out.slice(0, MAX_ITEMS);
}

function AgendaRow({ it }: { it: AgendaItem }) {
  const body = (
    <>
      <span class={`mark ${it.tone === 2 ? 'm2' : it.tone === 1 ? 'm1' : ''}`} />
      {it.who && <Portrait id={it.who} size={30} />}
      <span class="grow">
        <span style={{ display: 'block' }}>{it.text}</span>
        {it.sub && <span class="small dim" style={{ display: 'block' }}>{it.sub}</span>}
      </span>
      {it.go && <span class="dim" style={{ fontSize: '20px' }}>›</span>}
    </>
  );
  return it.go
    ? <button class="item agrow" onClick={it.go}>{body}</button>
    : <div class="item agrow" style={{ cursor: 'default' }}>{body}</div>;
}

export function AgendaCard() {
  const g = game();
  const sec = secretary(g);
  const items = buildAgenda(g);
  return (
    <div class="card" style={{ padding: '10px 0 0', overflow: 'hidden' }}>
      <div class="row" style={{ padding: '0 12px 8px' }}>
        {sec ? <Portrait id={sec.id} size={32} ring="var(--cyan)" onClick={() => openPerson(sec.id)} /> : null}
        <div class="grow">
          <div class="label cyan">From your secretary</div>
          <div class="small dim">{sec ? `${fullName(sec)} · ` : ''}What needs you, {monthLabel(g.month)}</div>
        </div>
      </div>
      {items.length === 0 ? (
        <div class="hint" style={{ padding: '4px 12px 14px', fontSize: '13px' }}>Nothing urgent. A good month to meet people: probe for gossip, build rapport with your officers.</div>
      ) : (
        <div class="agenda">
          {items.map((it) => <AgendaRow key={it.key} it={it} />)}
        </div>
      )}
    </div>
  );
}

// ---- Quarter ------------------------------------------------------------

/** Money on the quarter card. formatZuzu rounds millions to 0.1M, so a 3.45M guidance and a 3.55M bar would read the same. */
function formatQuarterZuzu(v: number): string {
  const a = Math.abs(v);
  if (a < 1e6 || a >= 1e9) return formatZuzu(v);
  return `${v < 0 ? '-' : ''}${(a / 1e6).toFixed(2)}Mㄓ`;
}

function Tick({ pct, color, label, below }: { pct: number; color: string; label: string; below?: boolean }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <>
      <i class="qtick" style={{ left: `${p}%`, background: color }} />
      <span class={`qlab ${below ? 'below' : 'above'}`} style={{ left: `${p}%`, transform: `translateX(-${p}%)`, color }}>{label}</span>
    </>
  );
}

function QuarterBar({ q, pick }: { q: QuarterOutlook; pick?: number | null }) {
  const vals = [q.profitSoFar, q.projected, q.guidance ?? 0, q.expectation ?? 0, pick ?? 0, 0];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = Math.max(hi - lo, 1) * 1.08;
  const at = (v: number) => ((v - lo) / span) * 100;
  const zero = at(0);
  const book = at(q.profitSoFar);
  const proj = at(q.projected);
  const fill = (a: number, b: number) => ({ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` });
  const summary = [
    `Booked ${formatQuarterZuzu(q.profitSoFar)}`,
    `projected ${formatQuarterZuzu(q.projected)}`,
    q.guidance !== null && `guidance ${formatQuarterZuzu(q.guidance)}`,
    pick != null && `your pick ${formatQuarterZuzu(pick)}`,
    q.expectation !== null && `board’s bar ${formatQuarterZuzu(q.expectation)}`,
  ].filter(Boolean).join(', ');
  return (
    <div class="qwrap" role="img" aria-label={summary} style={{ marginTop: q.guidance !== null || q.expectation !== null ? undefined : '0' }}>
      <div class="qbar">
        <i class="qproj" style={fill(book, proj)} />
        <i class="qbook" style={fill(zero, book)} />
        {lo < 0 && <i class="qzero" style={{ left: `${zero}%` }} />}
        {q.guidance !== null && <Tick pct={at(q.guidance)} color="var(--cyan)" label="Your guidance" />}
        {q.guidance === null && pick != null && pick > 0 && <Tick pct={at(pick)} color="var(--cyan)" label="Your pick" />}
        {q.expectation !== null && <Tick pct={at(q.expectation)} color="var(--amber)" label="Board’s bar" below />}
      </div>
    </div>
  );
}

/** A gap too small to show: under half of the 0.01M the quarter card displays. */
const near = (d: number) => Math.abs(d) < 5_000;

function verdicts(q: QuarterOutlook): { tone: string; text: string }[] {
  const out: { tone: string; text: string }[] = [];
  if (q.guidance !== null) {
    const d = q.projected - q.guidance;
    out.push(near(d) ? { tone: '', text: 'Projected to land right on guidance.' } : d >= 0
      ? { tone: 'green', text: `On track to beat guidance by ${formatQuarterZuzu(d)}.` }
      : { tone: Math.abs(d) > Math.abs(q.guidance) * 0.1 ? 'red' : 'amber', text: `Projected to miss guidance by ${formatQuarterZuzu(-d)}.` });
  }
  if (q.expectation !== null) {
    const d = q.projected - q.expectation;
    out.push(near(d) ? { tone: '', text: 'Projected to land right on the board’s bar.' } : d >= 0
      ? { tone: 'green', text: `Projected to clear the board’s bar by ${formatQuarterZuzu(d)}.` }
      : { tone: 'amber', text: `Projected to miss the board’s bar by ${formatQuarterZuzu(-d)}.` });
  }
  return out;
}

interface Preset {
  key: string;
  label: string;
  value: number;
}

const to10K = (v: number) => Math.round(v / 10_000) * 10_000;
/** Stretch aims this far above the better of the projection and the board's bar. */
const STRETCH = 1.05;
/** Guidance at this share of the board's bar earns full credit (the sim's SANDBAG_FULL rule). */
const FULL_CREDIT_SHARE = 1.02;

/** The lowest guidance that earns full board credit: the bar at 102%, rounded up to the next 10K. */
function fullCreditFrom(bar: number): number {
  let x = Math.ceil((bar * FULL_CREDIT_SHARE) / 10_000) * 10_000;
  // Float rounding can leave the ratio a hair short; step up until the sim agrees.
  for (let i = 0; i < 2 && guidanceCredit(x, bar) < 1; i++) x += 10_000;
  return x;
}

/**
 * The guidance choices offered while the player picks: Safe (the sim's
 * suggestion), the board's bar (rounded up so it never lands under it) and
 * Stretch. The stepper starts on the board's bar when the run-rate already
 * covers it, and on Safe otherwise.
 */
function guidancePresets(q: QuarterOutlook, safe: number): { presets: Preset[]; start: number } {
  const bar = q.expectation === null ? null : Math.ceil(q.expectation / 10_000) * 10_000;
  const full = q.expectation === null ? 0 : fullCreditFrom(q.expectation);
  const presets: Preset[] = [{ key: 'safe', label: 'Safe', value: safe }];
  if (bar !== null) presets.push({ key: 'bar', label: 'Board’s bar', value: bar });
  // Never below the full-credit line, so a beat on Stretch earns full credit.
  presets.push({ key: 'stretch', label: 'Stretch', value: Math.max(to10K(Math.max(q.projected, q.expectation ?? 0) * STRETCH), full) });
  const usable = presets.filter((p) => p.value > 0);
  const start = bar !== null && q.projected >= bar ? bar : safe;
  return { presets: usable, start };
}

/** What a staged guidance figure is worth if beaten, and what it risks if missed, in plain words. */
function PickNotes({ q, val }: { q: QuarterOutlook; val: number }) {
  const credit = guidanceCredit(val, q.expectation);
  const reward = credit >= 1 ? { tone: 'green', text: 'If beaten: full board credit.' }
    : credit > 0 ? { tone: 'amber', text: `If beaten: partial credit (${Math.min(99, Math.round(credit * 100))}%).` }
    : { tone: 'red', text: 'If beaten: no credit. Well below the board’s bar.' };
  const full = credit < 1 && q.expectation !== null ? fullCreditFrom(q.expectation) : null;
  const d = q.projected - val;
  const outlook = near(d) ? 'The projection lands right on it.' : d > 0 ? `The projection clears it by ${formatQuarterZuzu(d)}.` : `The projection falls short by ${formatQuarterZuzu(-d)}.`;
  return (
    <div class="pickbox small" aria-live="polite" aria-atomic="true">
      <div class={reward.tone}>{reward.text}</div>
      {full !== null && <div>Full credit from {formatQuarterZuzu(full)}.</div>}
      <div>If missed: confidence and share price fall, and the bonus pool is thinner.</div>
      <div class="dim">{outlook}</div>
    </div>
  );
}

export function QuarterCard() {
  const g = game();
  const q = quarterOutlook(g);
  const [amount, setAmount] = useState<number | null>(null);
  let suggested = 0;
  try { suggested = suggestedGuidance(g); } catch { suggested = 0; }
  const { presets, start } = guidancePresets(q, suggested);
  const val = amount ?? start;
  const step = Math.max(10000, Math.round(Math.abs(suggested) * 0.05 / 10000) * 10000);
  const unannounced = q.guidance === null;
  const vs = verdicts(q);
  return (
    <div id="quarter-card" tabIndex={-1} class={`card ${unannounced ? 'warn' : ''}`} style={{ scrollMarginTop: '120px' }}>
      <div class="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div class="label">{q.label} · board meets end of {monthName(q.boardMonth)}</div>
        <span class="mono small dim" style={{ whiteSpace: 'nowrap' }}>{q.monthsLeft} mo left</span>
      </div>
      <div class="stat" style={{ margin: '8px 0 0', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div><span class="label">Booked</span><b class={q.profitSoFar < 0 ? 'red' : ''}>{formatQuarterZuzu(q.profitSoFar)}</b></div>
        <div><span class="label">Projected</span><b class={q.projected < 0 ? 'red' : ''}>{formatQuarterZuzu(q.projected)}</b></div>
        <div><span class="label">Guidance</span><b class={unannounced ? 'amber' : 'cyan'}>{unannounced ? 'none' : formatQuarterZuzu(q.guidance!)}</b></div>
      </div>
      <QuarterBar q={q} pick={unannounced ? val : null} />
      {vs.map((v, i) => <div key={i} class={v.tone} style={{ fontSize: '13px', marginTop: i ? '2px' : '0' }}>{v.text}</div>)}
      {q.monthsIn === 0 && <div class="hint" style={{ marginTop: '4px' }}>Nothing booked yet; the projection is this month’s run-rate.</div>}
      {unannounced && (
        <div style={{ marginTop: '12px', borderTop: '1px solid var(--rule)', paddingTop: '10px' }}>
          <div class="label amber" style={{ marginBottom: '4px' }}>Announce guidance</div>
          <div class="hint" style={{ marginBottom: '8px' }}>
            A profit target for this quarter. Beat it and the share price and board confidence rise; miss it and both fall.
            {q.expectation !== null && <> The board expects about <b>{formatQuarterZuzu(q.expectation)}</b>. Guiding below it earns less credit for a beat.</>}
          </div>
          <div class="presets" role="group" aria-label="Guidance presets">
            {presets.map((p) => (
              <button key={p.key} type="button" class={`btn preset ${val === p.value ? 'on' : ''}`} aria-pressed={val === p.value} onClick={() => setAmount(p.value)}>
                <span class="label">{p.label}</span>
                <b class="mono">{formatQuarterZuzu(p.value)}</b>
              </button>
            ))}
          </div>
          <div role="group" aria-label="Guidance amount" style={{ marginTop: '8px' }}>
            <Stepper value={val} step={step} onChange={setAmount} format={formatQuarterZuzu} min={-1e12} />
          </div>
          {val > 0
            ? <PickNotes q={q} val={val} />
            : <div class="pickbox small red">Guidance has to be a positive profit figure.</div>}
          <div style={{ marginTop: '8px' }}>
            <Btn cls="primary block" cost={ATTENTION_COST.setGuidance} disabled={val <= 0} onClick={() => { if (run((s) => setGuidance(s, val))) setAmount(null); }}>Announce {formatQuarterZuzu(val)}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Board asks ---------------------------------------------------------

export function AsksCard() {
  const g = game();
  const asks = (g.asks ?? []).filter((a) => a.state === 'open' && g.people[a.directorId]);
  if (asks.length === 0) return null;
  const due = Math.min(...asks.map((a) => a.dueMonth));
  return (
    <div id="asks-card" tabIndex={-1} class="card" style={{ padding: '10px 0 0', overflow: 'hidden', scrollMarginTop: '120px' }}>
      <div style={{ padding: '0 12px 6px' }}>
        <div class="label">What the board wants by {monthLabel(due)}</div>
        <div class="small dim">Meet these and the directors back you; miss them and they cool.</div>
      </div>
      <OpenAsks asks={asks} />
    </div>
  );
}

// ---- Last month ---------------------------------------------------------

export function LastMonthCard() {
  const g = game();
  const rows = g.log
    .filter((l) => l.month === g.month - 1 && l.importance >= 2)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => b.l.importance - a.l.importance || a.i - b.i)
    .slice(0, 5)
    .map((r) => r.l);
  if (rows.length === 0) return null;
  return (
    <div class="card">
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <div class="label">Last month · {monthLabel(g.month - 1)}</div>
        <button type="button" class="link small" onClick={() => setTab('more')}>Full log ›</button>
      </div>
      {rows.map((l, i) => (
        <div key={i} class="lmrow">
          <span class={`mark ${l.importance === 3 ? 'm2' : 'm1'}`} />
          <div class="grow">
            <div style={{ fontWeight: l.importance === 3 ? 600 : 400 }}>{l.text}</div>
            {l.personIds.length > 0 && <div style={{ marginTop: '4px' }}>{l.personIds.slice(0, 2).map((id) => <PersonChip key={id} id={id} />)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
