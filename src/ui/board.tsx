import { useState } from 'preact/hooks';
import type { BoardMeeting, FixerKind } from '../sim/types';
import { fullName, formatZuzu, monthLabel } from '../sim/org';
import { ATTENTION_COST, lobbyDirector } from '../sim/actions';
import { directorSupport } from '../sim/board';
import { quoteFixerJob, startFixerJob, type FixerQuote, type FixerRequest } from '../sim/fixer';
import { Btn, DivBar, Empty, PersonChip, PersonLink, Seg, signed, pct } from './common';
import { PersonPicker, UnitPicker } from './pickers';
import { game, run } from './store';

const AGENDA: Record<string, string> = {
  growth: 'Wants growth', safety: 'Wants safety', dividends: 'Wants dividends', reform: 'Wants reform', oldGuard: 'Old guard',
};

export function MeetingView({ m }: { m: BoardMeeting }) {
  const g = game();
  return (
    <div class="card">
      <div class="label">Board meeting · {monthLabel(m.month)}</div>
      <div style={{ margin: '4px 0 8px' }}>{m.summary}</div>
      {m.motions.length === 0 && <div class="hint">No motions raised.</div>}
      {m.motions.map((mo) => {
        const votes = Object.entries(mo.votes);
        const yes = votes.filter(([, v]) => v);
        const no = votes.filter(([, v]) => !v);
        return (
          <div key={mo.id} style={{ borderTop: '1px solid var(--rule)', padding: '8px 0' }}>
            <div class="row"><b class="grow">{mo.summary}</b><span class={`tag ${mo.passed ? 'red' : 'green'}`}>{mo.passed ? 'passed' : 'failed'}</span></div>
            <div class="small dim">{mo.kind} · proposed by {g.people[mo.proposerId] ? fullName(g.people[mo.proposerId]) : '?'}</div>
            <div class="small mono">{yes.length} for · {no.length} against</div>
            <div class="small dim">
              {votes.map(([id, v]) => `${g.people[id]?.lastName ?? '?'} ${v ? '✓' : '✗'}`).join('  ')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BoardView() {
  const g = game();
  const [sub, setSub] = useState<'board' | 'fixer'>('board');
  return (
    <div>
      <div style={{ margin: '12px 0 4px' }}>
        <Seg value={sub} onChange={setSub} options={[['board', 'Board'], ['fixer', 'Fixer']]} />
      </div>
      {sub === 'board' ? (
        <>
          <h2>Directors <span class="mono">confidence {Math.round(g.company.boardConfidence)}</span></h2>
          {g.directors.map((d) => {
            const p = g.people[d.personId];
            if (!p) return null;
            let sup = 0;
            try { sup = directorSupport(g, d.personId); } catch { sup = 0; }
            return (
              <div class="card" key={d.personId}>
                <div class="row" style={{ justifyContent: 'space-between' }}>
                  <div><PersonLink id={d.personId} /> {p.role === 'chair' && <span class="tag cyan">chair</span>}</div>
                  <span class="mono small" style={{ color: sup < 0 ? 'var(--red)' : 'var(--green)' }}>{signed(sup)}</span>
                </div>
                <div class="small dim" style={{ marginBottom: '6px' }}>{AGENDA[d.agenda] ?? d.agenda}</div>
                <DivBar value={sup} />
                <div class="grid2" style={{ marginTop: '10px', gridTemplateColumns: 'repeat(3,1fr)' }}>
                  <Btn cls="sm" cost={ATTENTION_COST.lobbyDirector} onClick={() => run((s) => lobbyDirector(s, d.personId, 'persuade'))}>Persuade</Btn>
                  <Btn cls="sm" cost={ATTENTION_COST.lobbyDirector} onClick={() => run((s) => lobbyDirector(s, d.personId, 'favor'))}>Favor</Btn>
                  <Btn cls="sm warn" cost={ATTENTION_COST.lobbyDirector} onClick={() => run((s) => lobbyDirector(s, d.personId, 'pressure'))}>Pressure</Btn>
                </div>
              </div>
            );
          })}
          <h2>Meetings</h2>
          {g.boardMeetings.length === 0 && <Empty>No board meeting yet. They meet at the close of each quarter.</Empty>}
          {[...g.boardMeetings].reverse().slice(0, 4).map((m, i) => <MeetingView key={i} m={m} />)}
        </>
      ) : <Fixer />}
    </div>
  );
}

function Fixer() {
  const g = game();
  const [kind, setKind] = useState<FixerKind>('materials');
  const [unitId, setUnitId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [clean, setClean] = useState(false);

  const req: FixerRequest = {
    kind,
    targetUnitId: kind === 'dirt' ? null : unitId,
    targetPersonId: kind === 'dirt' ? personId : null,
    budget: budget ?? 0,
    clean,
  };
  let quote: FixerQuote | null = null;
  let qerr = '';
  let min = 10000;
  const ready = kind === 'dirt' ? !!personId : !!unitId;
  if (ready) {
    try {
      const q0 = quoteFixerJob(g, { ...req, budget: budget ?? 0 });
      min = q0.minBudget;
      quote = budget === null ? quoteFixerJob(g, { ...req, budget: min }) : q0;
    } catch (e) { qerr = e instanceof Error ? e.message : String(e); }
  }
  const b = budget ?? min;
  const jobs = [...g.fixerJobs].reverse();
  const target = (j: typeof jobs[number]) =>
    j.targetPersonId && g.people[j.targetPersonId] ? fullName(g.people[j.targetPersonId]) : j.targetUnitId && g.units[j.targetUnitId] ? g.units[j.targetUnitId].name : '—';
  return (
    <div>
      <h2>Request a job</h2>
      <div class="card stack">
        <Seg value={kind} onChange={(k) => { setKind(k); setUnitId(null); setPersonId(null); setBudget(null); }} options={[['materials', 'Materials'], ['specialHire', 'Special hire'], ['dirt', 'Dirt']]} />
        <div class="hint">
          {kind === 'materials' && 'Scarce inputs for a unit, sourced off the books. Lifts its output for a while.'}
          {kind === 'specialHire' && 'Extract a standout hire from elsewhere into a unit.'}
          {kind === 'dirt' && 'Find something on a person. Secrets surface in their file.'}
        </div>
        {kind === 'dirt' ? (
          personId ? <div>Target: <PersonChip id={personId} /> <a class="link small" onClick={() => setPersonId(null)}>change</a></div>
            : <PersonPicker g={g} onPick={setPersonId} />
        ) : (
          unitId ? <div>Into: <b>{g.units[unitId].name}</b> <a class="link small" onClick={() => setUnitId(null)}>change</a></div>
            : <UnitPicker g={g} onPick={setUnitId} />
        )}
        {ready && (
          <>
            <div>
              <div class="row"><span class="label grow">Budget</span><span class="mono">{formatZuzu(b)}</span></div>
              <input type="range" min={min} max={Math.max(min * 8, min + 1)} step={Math.max(1000, Math.round(min / 20 / 1000) * 1000)} value={b} onInput={(e) => setBudget(Number(e.currentTarget.value))} />
            </div>
            <label class="row" style={{ minHeight: '44px' }}>
              <input type="checkbox" checked={clean} onChange={(e) => setClean(e.currentTarget.checked)} style={{ width: 22, height: 22 }} />
              <span>Clean: leave no trace (costs more, lower blowback)</span>
            </label>
            {quote && (
              <div class="stat">
                <div><span class="label">Success</span><b class={quote.successChance < 0.4 ? 'red' : quote.successChance < 0.7 ? 'amber' : 'green'}>{pct(quote.successChance)}</b></div>
                <div><span class="label">Time</span><b>{quote.months} mo</b></div>
                <div><span class="label">Blowback</span><b class={quote.blowbackRisk > 0.4 ? 'red' : quote.blowbackRisk > 0.2 ? 'amber' : 'green'}>{pct(quote.blowbackRisk)}</b></div>
              </div>
            )}
            {qerr && <div class="warnbox">{qerr}</div>}
            <Btn cls="primary block" cost={ATTENTION_COST.fixer} disabled={!quote || b > g.company.cash} onClick={() => { if (run((s) => startFixerJob(s, { ...req, budget: b }))) { setUnitId(null); setPersonId(null); setBudget(null); } }}>
              Start job · {formatZuzu(b)}
            </Btn>
            {b > g.company.cash && <div class="hint red">Not enough cash.</div>}
          </>
        )}
      </div>
      <h2>Jobs</h2>
      {jobs.length === 0 && <Empty>No jobs yet.</Empty>}
      {jobs.map((j) => (
        <div key={j.id} class="card">
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <b>{j.kind} · {target(j)}</b>
            <span class={`tag ${j.state === 'pending' ? 'amber' : j.state === 'success' ? 'green' : j.state === 'partial' ? 'cyan' : 'red'}`}>{j.state}</span>
          </div>
          <div class="small dim">{formatZuzu(j.budget)}{j.clean ? ' · clean' : ''} · started {monthLabel(j.startedMonth)} · {j.state === 'pending' ? `report due ${monthLabel(j.resolveMonth)}` : 'closed'}</div>
          {j.report && <div style={{ marginTop: '6px' }}>{j.report}</div>}
        </div>
      ))}
    </div>
  );
}
