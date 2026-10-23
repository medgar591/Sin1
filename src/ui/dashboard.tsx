import { useState } from 'preact/hooks';
import type { GameState, PersonId } from '../sim/types';
import { formatZuzu, peopleUnder, fullName, isActive } from '../sim/org';
import { allocateBonus, ATTENTION_COST, setGuidance } from '../sim/actions';
import { suggestedGuidance } from '../sim/economy';
import { Bar, Btn, Sheet, Stepper, levelClass, zuzuPrice } from './common';
import { Chart } from './charts';
import { closeSheet, game, goOrg, openPerson, openSheet, run } from './store';

export function Dashboard() {
  const g = game();
  const h = g.company.history.slice(-24);
  return (
    <div>
      <Guidance />
      {g.company.bonusPool > 0 && (
        <div class="card warn">
          <div class="label amber">Bonus pool</div>
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <div class="mono" style={{ fontSize: '20px' }}>{formatZuzu(g.company.bonusPool)}</div>
            <button class="btn warn" onClick={() => openSheet({ k: 'bonus' })}>Allocate</button>
          </div>
          <div class="hint">Unallocated money returns to company cash.</div>
        </div>
      )}
      <h2>Divisions</h2>
      {Object.values(g.divisions).map((d) => {
        const u = g.units[d.unitId];
        if (!u) return null;
        const margin = d.revenue > 0 ? (d.revenue - d.costs) / d.revenue : 0;
        const hc = peopleUnder(g, u.id).filter((id) => g.people[id] && isActive(g.people[id])).length;
        return (
          <div key={u.id} class="card" onClick={() => goOrg(u.id)} style={{ cursor: 'pointer' }}>
            <div class="row" style={{ justifyContent: 'space-between' }}>
              <div class="grow">
                <b>{u.name}</b> <span class="tag cyan">{d.industry}</span>
              </div>
              <span class="link small">Open ›</span>
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

function Guidance() {
  const g = game();
  const [amount, setAmount] = useState<number | null>(null);
  const cur = g.company.guidance;
  if (cur !== null) {
    return (
      <div class="card">
        <div class="label">Quarterly guidance</div>
        <div class="mono" style={{ fontSize: '18px' }}>Profit target {formatZuzu(cur)}</div>
        <div class="hint">Announced. The board and the market will judge this quarter against it.</div>
      </div>
    );
  }
  let suggested = 0;
  try { suggested = suggestedGuidance(g); } catch { suggested = 0; }
  const val = amount ?? suggested;
  const step = Math.max(10000, Math.round(Math.abs(suggested) * 0.05 / 10000) * 10000);
  return (
    <div class="card warn">
      <div class="label amber">Announce guidance</div>
      <div class="hint" style={{ marginBottom: '8px' }}>Set a profit target for this quarter. Beat it and the stock rises; miss it and confidence falls.</div>
      <Stepper value={val} step={step} onChange={setAmount} format={formatZuzu} min={-1e12} />
      <div style={{ marginTop: '8px' }}>
        <Btn cls="primary block" cost={ATTENTION_COST.setGuidance} onClick={() => run((s) => setGuidance(s, val))}>Announce {formatZuzu(val)}</Btn>
      </div>
    </div>
  );
}

interface Cand { id: PersonId; why: string }

function bonusCandidates(g: GameState): Cand[] {
  const out: Cand[] = [];
  const seen = new Set<string>();
  const add = (id: PersonId | null, why: string) => {
    if (!id || seen.has(id) || !g.people[id] || !isActive(g.people[id]) || id === g.player.personId) return;
    seen.add(id);
    out.push({ id, why });
  };
  for (const c of g.units[g.rootUnitId].childIds) {
    const u = g.units[c];
    if (u.kind === 'function') add(u.leadId, 'Officer');
  }
  for (const d of Object.values(g.divisions)) add(g.units[d.unitId]?.leadId ?? null, 'Division head');
  Object.values(g.people)
    .filter((p) => isActive(p) && p.unitId !== null && p.id !== g.player.personId && p.role !== 'director' && p.role !== 'chair')
    .sort((a, b) => b.performance - a.performance)
    .slice(0, 12)
    .forEach((p) => add(p.id, 'Top performer'));
  return out;
}

export function BonusSheet() {
  const g = game();
  const pool = g.company.bonusPool;
  const step = Math.max(1000, Math.round(pool / 40 / 1000) * 1000);
  const [alloc, setAlloc] = useState<Record<PersonId, number>>({});
  const cands = bonusCandidates(g);
  const total = Object.values(alloc).reduce((a, b) => a + b, 0);
  const left = pool - total;
  return (
    <Sheet title="Allocate bonus pool">
      <div class="stat">
        <div><span class="label">Pool</span><b>{formatZuzu(pool)}</b></div>
        <div><span class="label">Allocated</span><b>{formatZuzu(total)}</b></div>
        <div><span class="label">Left</span><b class={left < 0 ? 'red' : ''}>{formatZuzu(left)}</b></div>
      </div>
      <div class="list" style={{ marginTop: '10px' }}>
        {cands.map(({ id, why }) => {
          const p = g.people[id];
          const v = alloc[id] ?? 0;
          return (
            <div key={id} class="item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
              <div class="grow" onClick={() => openPerson(id)} style={{ cursor: 'pointer' }}>
                <div class="t">{fullName(p)}</div>
                <div class="s">{why} · perf {Math.round(p.performance)} · loyalty {Math.round(p.loyalty)}</div>
              </div>
              <div style={{ width: '180px' }}>
                <Stepper small value={v} step={step} min={0} max={v + Math.max(0, left)} format={formatZuzu} onChange={(n) => setAlloc({ ...alloc, [id]: n })} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: '12px' }}>
        <Btn cls="primary block" cost={ATTENTION_COST.allocateBonus} disabled={left < 0} onClick={() => { if (run((s) => allocateBonus(s, Object.fromEntries(Object.entries(alloc).filter(([, n]) => n > 0))))) closeSheet(); }}>
          Pay out {formatZuzu(total)}
        </Btn>
      </div>
    </Sheet>
  );
}
