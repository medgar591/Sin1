// The CEO's agenda: what needs you this month, how the quarter stands, what the board wants.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { GameState, PersonId } from '../sim/types';
import { chiefOfStaff, formatZuzu, fullName, isActive, monthLabel } from '../sim/org';
import { askProgress } from '../sim/asks';
import { directorSupport } from '../sim/board';
import { quarterOutlook, suggestedGuidance, type QuarterOutlook } from '../sim/economy';
import { setGuidance } from '../sim/actions';
import { ATTENTION_COST } from '../sim/attention';
import { Btn, PersonChip, Stepper, plotStage } from './common';
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

const PROMISE_NOUN: Record<string, string> = { promotion: 'a promotion', raise: 'a raise', protection: 'protection', budget: 'a bigger budget' };

const monthName = (m: number) => monthLabel(m).split(' ')[0];

function scrollToQuarter() {
  document.getElementById('quarter-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  if (q.monthsLeft === 1) {
    out.push({ key: 'board', tone: 1, text: <>The board meets at the end of this month.</>, sub: 'Your guidance and the directors’ asks are judged then.' });
  }

  for (const d of g.directors) {
    if (!g.people[d.personId] || !isActive(g.people[d.personId])) continue;
    let sup = 0;
    try { sup = directorSupport(g, d.personId); } catch { sup = 0; }
    if (sup < TURNING_AT) out.push({ key: `turn${d.personId}`, tone: 2, who: d.personId, go: () => openPerson(d.personId), text: <><b>{name(d.personId)}</b> is turning against you.</>, sub: 'A director who loses faith votes you out.' });
  }

  for (const a of g.asks ?? []) {
    if (a.state !== 'open' || !g.people[a.directorId]) continue;
    const pr = askProgress(g, a);
    if (pr.met) continue;
    out.push({ key: `ask${a.id}`, tone: 1, who: a.directorId, go: () => setTab('board'), text: <><b>{g.people[a.directorId].lastName}</b> wants: {a.text}</>, sub: `So far: ${pr.label}` });
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
  const cos = chiefOfStaff(g);
  const items = buildAgenda(g);
  return (
    <div class="card" style={{ padding: '10px 0 0', overflow: 'hidden' }}>
      <div class="row" style={{ padding: '0 12px 8px' }}>
        {cos ? <Portrait id={cos.id} size={32} ring="var(--cyan)" onClick={() => openPerson(cos.id)} /> : null}
        <div class="grow">
          <div class="label cyan">From your chief of staff</div>
          <div class="small dim">{cos ? `${fullName(cos)} · ` : ''}What needs you, {monthLabel(g.month)}</div>
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

function Tick({ pct, color, label, below }: { pct: number; color: string; label: string; below?: boolean }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <>
      <i class="qtick" style={{ left: `${p}%`, background: color }} />
      <span class={`qlab ${below ? 'below' : 'above'}`} style={{ left: `${p}%`, transform: `translateX(-${p}%)`, color }}>{label}</span>
    </>
  );
}

function QuarterBar({ q }: { q: QuarterOutlook }) {
  const vals = [q.profitSoFar, q.projected, q.guidance ?? 0, q.expectation ?? 0, 0];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = Math.max(hi - lo, 1) * 1.08;
  const at = (v: number) => ((v - lo) / span) * 100;
  const zero = at(0);
  const book = at(q.profitSoFar);
  const proj = at(q.projected);
  const fill = (a: number, b: number) => ({ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` });
  return (
    <div class="qwrap" style={{ marginTop: q.guidance !== null || q.expectation !== null ? undefined : '0' }}>
      <div class="qbar">
        <i class="qproj" style={fill(book, proj)} />
        <i class="qbook" style={fill(zero, book)} />
        {lo < 0 && <i class="qzero" style={{ left: `${zero}%` }} />}
        {q.guidance !== null && <Tick pct={at(q.guidance)} color="var(--cyan)" label="Your guidance" />}
        {q.expectation !== null && <Tick pct={at(q.expectation)} color="var(--amber)" label="Board’s bar" below />}
      </div>
    </div>
  );
}

/** A gap too small to call (under 1% of the bar, or under 10K). */
const near = (d: number, bar: number) => Math.abs(d) < Math.max(10_000, Math.abs(bar) * 0.01);

function verdicts(q: QuarterOutlook): { tone: string; text: string }[] {
  const out: { tone: string; text: string }[] = [];
  if (q.guidance !== null) {
    const d = q.projected - q.guidance;
    out.push(near(d, q.guidance) ? { tone: '', text: 'Projected to land right on guidance.' } : d >= 0
      ? { tone: 'green', text: `On track to beat guidance by ${formatZuzu(d)}.` }
      : { tone: Math.abs(d) > Math.abs(q.guidance) * 0.1 ? 'red' : 'amber', text: `Projected to miss guidance by ${formatZuzu(-d)}.` });
  }
  if (q.expectation !== null) {
    const d = q.projected - q.expectation;
    out.push(near(d, q.expectation) ? { tone: '', text: 'Projected to land right on the board’s bar.' } : d >= 0
      ? { tone: 'green', text: `Projected to clear the board’s bar by ${formatZuzu(d)}.` }
      : { tone: 'amber', text: `Projected to miss the board’s bar by ${formatZuzu(-d)}.` });
  }
  return out;
}

export function QuarterCard() {
  const g = game();
  const q = quarterOutlook(g);
  const [amount, setAmount] = useState<number | null>(null);
  let suggested = 0;
  try { suggested = suggestedGuidance(g); } catch { suggested = 0; }
  const val = amount ?? suggested;
  const step = Math.max(10000, Math.round(Math.abs(suggested) * 0.05 / 10000) * 10000);
  const unannounced = q.guidance === null;
  const vs = verdicts(q);
  return (
    <div id="quarter-card" class={`card ${unannounced ? 'warn' : ''}`} style={{ scrollMarginTop: '120px' }}>
      <div class="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div class="label">{q.label} · board meets end of {monthName(q.boardMonth)}</div>
        <span class="mono small dim" style={{ whiteSpace: 'nowrap' }}>{q.monthsLeft} mo left</span>
      </div>
      <div class="stat" style={{ margin: '8px 0 0', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div><span class="label">Booked</span><b class={q.profitSoFar < 0 ? 'red' : ''}>{formatZuzu(q.profitSoFar)}</b></div>
        <div><span class="label">Projected</span><b class={q.projected < 0 ? 'red' : ''}>{formatZuzu(q.projected)}</b></div>
        <div><span class="label">Guidance</span><b class={unannounced ? 'amber' : 'cyan'}>{unannounced ? 'none' : formatZuzu(q.guidance!)}</b></div>
      </div>
      <QuarterBar q={q} />
      {vs.map((v, i) => <div key={i} class={v.tone} style={{ fontSize: '13px', marginTop: i ? '2px' : '0' }}>{v.text}</div>)}
      {q.monthsIn === 0 && <div class="hint" style={{ marginTop: '4px' }}>Nothing booked yet; the projection is this month’s run-rate.</div>}
      {unannounced && (
        <div style={{ marginTop: '12px', borderTop: '1px solid var(--rule)', paddingTop: '10px' }}>
          <div class="label amber" style={{ marginBottom: '4px' }}>Announce guidance</div>
          <div class="hint" style={{ marginBottom: '8px' }}>
            A profit target for this quarter. Beat it and the stock rises; miss it and confidence falls.
            {q.expectation !== null && <> The board expects about <b>{formatZuzu(q.expectation)}</b>. Guiding below it earns little credit.</>}
          </div>
          <Stepper value={val} step={step} onChange={setAmount} format={formatZuzu} min={-1e12} />
          <div style={{ marginTop: '8px' }}>
            <Btn cls="primary block" cost={ATTENTION_COST.setGuidance} onClick={() => run((s) => setGuidance(s, val))}>Announce {formatZuzu(val)}</Btn>
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
    <div class="card" style={{ padding: '10px 0 0', overflow: 'hidden' }}>
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
        <a class="link small" onClick={() => setTab('more')}>Full log ›</a>
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
