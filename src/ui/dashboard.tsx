import { useEffect, useState } from 'preact/hooks';
import type { GameState, PersonId } from '../sim/types';
import { formatZuzu, peopleUnder, fullName, isActive } from '../sim/org';
import { bonusWeights } from '../sim/economy';
import { allocateBonus } from '../sim/actions';
import { ATTENTION_COST } from '../sim/attention';
import { Bar, Btn, Sheet, Stepper, levelClass, zuzuPrice } from './common';
import { AgendaCard, AsksCard, LastMonthCard, QuarterCard, scrollToQuarter, suggestedMeeting } from './agenda';
import { introSeen } from './intro';
import { Chart } from './charts';
import { closeSheet, game, goOrg, openPerson, openSheet, run, S, setTab } from './store';

// ---- First steps ----------------------------------------------------------

/** The checklist is for the opening quarter only. */
const FIRST_STEPS_UNTIL = 3;

const stepKey = (what: 'hide' | 'met' | 'pool', seed: number) => `sin1.steps.${what}.${seed}`;
// Flags survive a reload through localStorage; the set covers a browser that blocks it.
const flagged = new Set<string>();

function hasFlag(key: string): boolean {
  if (flagged.has(key)) return true;
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function setFlag(key: string): void {
  flagged.add(key);
  try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
}

function clearFlag(key: string): void {
  flagged.delete(key);
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

interface Step {
  key: string;
  label: string;
  /** Attention it costs. */
  cost?: number;
  done: boolean;
  go: () => void;
}

/** A short checklist for a new game, ticked from game state; hides itself when finished or dismissed. */
function FirstSteps() {
  const g = game();
  const [hidden, setHidden] = useState(() => hasFlag(stepKey('hide', g.seed)));
  const hideKey = stepKey('hide', g.seed);
  const metKey = stepKey('met', g.seed);
  const poolKey = stepKey('pool', g.seed);
  // A meeting leaves no trace in the game once the month turns, so remember it here.
  // A game still untouched at the start can't have met anyone: drop a flag left by an earlier game on this seed.
  const spent = g.player.attentionLeft < g.player.attentionPerMonth;
  const pristine = g.month === 0 && !spent && g.company.guidance === null;
  const hadPool = g.company.bonusPool > 0;
  useEffect(() => {
    if (spent) setFlag(metKey);
    else if (pristine) clearFlag(metKey);
    if (hadPool) setFlag(poolKey);
  });
  if (hidden || g.gameOver || g.month >= FIRST_STEPS_UNTIL) return null;

  const meeting = suggestedMeeting(g);
  const steps: Step[] = [
    { key: 'guidance', label: 'Announce guidance', done: g.company.guidance !== null, go: scrollToQuarter },
  ];
  if (hadPool || hasFlag(poolKey)) steps.push({ key: 'bonus', label: 'Split the bonus pool', done: g.company.bonusPool <= 0, go: () => openSheet({ k: 'bonus' }) });
  steps.push(
    {
      key: 'meet', label: 'Meet one of your officers', cost: ATTENTION_COST.meet, done: spent || (!pristine && hasFlag(metKey)),
      go: () => (meeting ? openPerson(meeting.id) : setTab('org')),
    },
    { key: 'end', label: 'End the month', done: g.month > 0, go: () => openSheet({ k: 'endMonth' }) },
  );
  const left = steps.filter((x) => !x.done).length;
  if (left === 0) return null;
  return (
    <section class="card steps" aria-label="First steps">
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <div class="label cyan">First steps · {steps.length - left} of {steps.length}</div>
        <button type="button" class="link small stepsHide" onClick={() => { setFlag(hideKey); setHidden(true); }}>Hide</button>
      </div>
      <ul class="stepslist">
        {steps.map((x) => (
          <li key={x.key}>
            {x.done ? (
              <div class="step done"><span class="tick green" aria-hidden="true">✓</span><span class="sr-only">Done: </span><span class="grow">{x.label}</span></div>
            ) : (
              <button type="button" class="step" onClick={x.go}>
                <span class="tick dim" aria-hidden="true">○</span>
                <span class="grow">{x.label}</span>
                {x.cost ? <span class="cost">{'●'.repeat(x.cost)}<span class="sr-only"> costs {x.cost} attention</span></span> : null}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div class="hint">Attention: you get {g.player.attentionPerMonth} a month (the dots at the top); <span class="cyan">●</span> marks what costs it. Unspent attention is lost.</div>
    </section>
  );
}

// ---- Dashboard ------------------------------------------------------------

export function Dashboard() {
  const g = game();
  const h = g.company.history.slice(-24);
  useEffect(() => {
    if (g.month === 0 && !introSeen(g.seed) && !S.sheets.some((x) => x.k === 'intro')) openSheet({ k: 'intro' });
  }, []);
  return (
    <div>
      <div style={{ height: '10px' }} />
      <FirstSteps />
      <AgendaCard />
      <QuarterCard />
      <AsksCard />
      {g.company.bonusPool > 0 && (
        <div class="card warn">
          <div class="label amber">Bonus pool</div>
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <div class="mono" style={{ fontSize: '20px' }}>{formatZuzu(g.company.bonusPool)}</div>
            <div class="row">
              <button type="button" class="btn" disabled={!bonusCandidates(g).length} onClick={payFairSplit}>Fair split &amp; pay</button>
              <button type="button" class="btn warn" onClick={() => openSheet({ k: 'bonus' })}>Allocate</button>
            </div>
          </div>
          <div class="hint">Fair split pays everyone who expects a share, weighted by seniority. Unallocated money returns to company cash.</div>
        </div>
      )}
      <LastMonthCard />
      <h2>Divisions</h2>
      {Object.values(g.divisions).map((d) => {
        const u = g.units[d.unitId];
        if (!u) return null;
        const margin = d.revenue > 0 ? (d.revenue - d.costs) / d.revenue : 0;
        const hc = peopleUnder(g, u.id).filter((id) => g.people[id] && isActive(g.people[id])).length;
        return (
          <div key={u.id} class="card dcard">
            <div class="row" style={{ justifyContent: 'space-between' }}>
              <div class="grow">
                <b>{u.name}</b> <span class="tag cyan">{d.industry}</span>
              </div>
              <button type="button" class="link small opener" aria-label={`Open ${u.name}`} onClick={() => goOrg(u.id)}>Open <span aria-hidden="true">›</span></button>
            </div>
            <div class="stat" style={{ marginTop: '8px' }}>
              <div><span class="label">Revenue</span><b>{formatZuzu(d.revenue)}</b></div>
              <div><span class="label">Costs</span><b>{formatZuzu(d.costs)}</b></div>
              <div><span class="label">Margin</span><b class={margin < 0 ? 'red' : margin < 0.1 ? 'amber' : 'green'}>{(margin * 100).toFixed(0)}%</b></div>
            </div>
            <div class="grid2" style={{ marginTop: '8px' }}>
              <div>
                <div class="row small"><span class="dim grow">Output</span><span class="mono">{Math.round(u.output)}</span></div>
                <Bar value={u.output} max={150} cls={levelClass(u.output, 75, 50)} />
              </div>
              <div>
                <div class="row small"><span class="dim grow">Morale</span><span class="mono">{Math.round(u.morale)}</span></div>
                <Bar value={u.morale} cls={levelClass(u.morale)} />
              </div>
            </div>
            <div class="small dim" style={{ marginTop: '6px' }}>{hc} people · market x{d.market.toFixed(2)} · growth {(d.growth * 100).toFixed(1)}%/mo</div>
          </div>
        );
      })}
      <h2>Trends</h2>
      <Chart title="Cash" values={h.map((r) => r.cash)} format={formatZuzu} />
      <Chart title="Profit / month" values={h.map((r) => r.profit)} format={formatZuzu} bars />
      <Chart title="Share price" values={h.map((r) => r.sharePrice)} format={zuzuPrice} color="var(--amber)" />
      <Chart title="Board confidence" values={h.map((r) => r.boardConfidence)} format={(n) => n.toFixed(0)} color="var(--green)" threshold={30} fixedMin={0} fixedMax={100} />
    </div>
  );
}

interface Cand { id: PersonId; why: string; w: number }

/** Who expects a share and how much, straight from the sim (officers, division heads, high performers). */
function bonusCandidates(g: GameState): Cand[] {
  return [...bonusWeights(g)]
    .map(([id, w]) => ({ id, w, why: g.people[id].role === 'officer' ? 'Officer' : g.people[id].role === 'divisionHead' ? 'Division head' : 'High performer' }))
    .sort((a, b) => b.w - a.w || g.people[b.id].performance - g.people[a.id].performance);
}

/** Each expecting person's exact share of the pool, weighted by seniority: what the sim counts as fair. */
function fairSplit(g: GameState): Record<PersonId, number> {
  const cands = bonusCandidates(g);
  const sum = cands.reduce((a, c) => a + c.w, 0);
  return Object.fromEntries(cands.map((c) => [c.id, (g.company.bonusPool * c.w) / sum]));
}

/** Pays the whole pool out in the fair split, in one tap. Returns whether it went through. */
function payFairSplit(): boolean {
  return run((s) => allocateBonus(s, fairSplit(s)));
}

export function BonusSheet() {
  const g = game();
  const pool = g.company.bonusPool;
  const step = Math.max(1000, Math.round(pool / 40 / 1000) * 1000);
  const [alloc, setAlloc] = useState<Record<PersonId, number>>({});
  const cands = bonusCandidates(g);
  const [all, setAll] = useState(false);
  const shown = all ? cands : cands.slice(0, 14);
  const total = Object.values(alloc).reduce((a, b) => a + b, 0);
  const left = pool - total;
  return (
    <Sheet title="Allocate bonus pool">
      <div class="hint" style={{ marginBottom: '8px' }}>Officers, division heads and high performers (70+) expect a share. Anyone left with almost nothing resents it. Fair split pays everyone their expected share, weighted by seniority. Unspent money returns to cash.</div>
      <div class="stat">
        <div><span class="label">Pool</span><b>{formatZuzu(pool)}</b></div>
        <div><span class="label">Allocated</span><b>{formatZuzu(total)}</b></div>
        <div><span class="label">Left</span><b class={left < 0 ? 'red' : ''}>{formatZuzu(left)}</b></div>
      </div>
      <div style={{ marginTop: '10px' }}>
        <button type="button" class="btn primary block" disabled={!cands.length} onClick={() => { if (payFairSplit()) closeSheet(); }}>Fair split &amp; pay out</button>
      </div>
      <div class="hint" style={{ margin: '10px 0 6px' }}>Or set each share yourself:</div>
      <div class="list">
        {shown.map(({ id, why }) => {
          const p = g.people[id];
          const v = alloc[id] ?? 0;
          return (
            <div key={id} class="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <button type="button" class="grow namebtn" onClick={() => openPerson(id)}>
                <span class="t" style={{ display: 'block' }}>{fullName(p)}</span>
                <span class="s" style={{ display: 'block', whiteSpace: 'normal' }}>{why} · perf {Math.round(p.performance)} · loyalty {Math.round(p.loyalty)}</span>
              </button>
              <div role="group" aria-label={`Bonus for ${fullName(p)}`} style={{ width: '180px' }}>
                <Stepper small value={v} step={step} min={0} max={v + Math.max(0, left)} format={formatZuzu} onChange={(n) => setAlloc({ ...alloc, [id]: n })} />
              </div>
            </div>
          );
        })}
      </div>
      {cands.length > shown.length && <button type="button" class="btn block" style={{ marginTop: '8px' }} onClick={() => setAll(true)}>Show all {cands.length} who expect a share</button>}
      <div class="grid2" style={{ marginTop: '12px' }}>
        <button type="button" class="btn" onClick={() => setAlloc(fairSplit(g))}>Fair split</button>
        <button type="button" class="btn" onClick={() => setAlloc({})}>Clear</button>
      </div>
      <div style={{ marginTop: '8px' }}>
        <Btn cls={`block ${total > 0 ? 'primary' : ''}`} cost={ATTENTION_COST.allocateBonus} disabled={left < 0} onClick={() => { if (run((s) => allocateBonus(s, Object.fromEntries(Object.entries(alloc).filter(([, n]) => n > 0))))) closeSheet(); }}>
          Pay out {formatZuzu(total)}
        </Btn>
      </div>
    </Sheet>
  );
}
