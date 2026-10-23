import { useState } from 'preact/hooks';
import type { BoardAsk, BoardMeeting, FixerKind } from '../sim/types';
import { fullName, formatZuzu, monthLabel, shortName } from '../sim/org';
import { FAVOR_COST, lobbyDirector } from '../sim/actions';
import { ATTENTION_COST } from '../sim/attention';
import { directorSupport } from '../sim/board';
import { AGENDA_PLAIN, askProgress, type AskProgress } from '../sim/asks';
import { quoteFixerJob, startFixerJob, type FixerQuote, type FixerRequest } from '../sim/fixer';
import { Btn, ConfirmBtn, DivBar, Empty, PersonChip, PersonLink, Seg, signed, pct } from './common';
import { PersonPicker, UnitPicker } from './pickers';
import { Portrait } from './portrait';
import { game, openPerson, run, setTab } from './store';

const AGENDA: Record<string, string> = {
  growth: 'Wants growth', safety: 'Wants safety', dividends: 'Wants dividends', reform: 'Wants reform', oldGuard: 'Old guard',
};

const MOTION: Record<string, string> = {
  noConfidence: 'No confidence', replaceOfficer: 'Replace officer', cutBudget: 'Budget cut', commend: 'Commendation',
};

/** "Solomona", "Solomona & Dasgupta", "Solomona, Dasgupta & Okafor" as a row of name buttons. */
function Names({ ids }: { ids: string[] }) {
  const g = game();
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && (i === ids.length - 1 ? ' & ' : ', ')}
          <button type="button" class="link" onClick={() => openPerson(id)}>{shortName(g.people[id])}</button>
        </span>
      ))}
    </>
  );
}

/** Where an open ask stands, in words as well as colour: on track, missed for good (a purge cannot be undone), or not yet. */
function AskTag({ pr }: { pr: AskProgress }) {
  const [tone, text] = pr.lost ? ['red', '✗ missed'] : pr.met ? ['green', '✓ on track'] : ['amber', 'not yet'];
  return <span class={`tag ${tone}`} style={{ flex: 'none' }}>{text}</span>;
}

/** Open board asks with the director's face, what they want, and how it stands. Tap for the director. Directors who carry the same ask share one row. */
export function OpenAsks({ asks }: { asks: BoardAsk[] }) {
  const g = game();
  const groups: BoardAsk[][] = [];
  for (const a of asks) {
    if (!g.people[a.directorId]) continue;
    const same = groups.find((x) => x[0].text === a.text);
    if (same) same.push(a); else groups.push([a]);
  }
  return (
    <div class="agenda">
      {groups.map((grp) => {
        const a = grp[0];
        const pr = askProgress(g, a);
        const tag = <AskTag pr={pr} />;
        if (grp.length === 1) {
          return (
            <button key={a.id} class="item agrow" onClick={() => openPerson(a.directorId)}>
              <Portrait id={a.directorId} size={28} />
              <span class="grow">
                <span class="small dim" style={{ display: 'block' }}>{fullName(g.people[a.directorId])}</span>
                <span style={{ display: 'block' }}>{a.text}</span>
                <span class="small dim mono" style={{ display: 'block', marginTop: '2px' }}>{pr.label}</span>
              </span>
              {tag}
            </button>
          );
        }
        return (
          <div key={a.id} class="item agrow multi">
            <span class="pstack">{grp.map((x) => <Portrait key={x.id} id={x.directorId} size={28} />)}</span>
            <span class="grow">
              <span class="small dim" style={{ display: 'block' }}><Names ids={grp.map((x) => x.directorId)} /> want:</span>
              <span style={{ display: 'block' }}>{a.text}</span>
              <span class="small dim mono" style={{ display: 'block', marginTop: '2px' }}>{pr.label}</span>
            </span>
            {tag}
          </div>
        );
      })}
    </div>
  );
}

export function MeetingView({ m }: { m: BoardMeeting }) {
  const g = game();
  // The summary string repeats every motion after its headline; show only the headline.
  const cut = m.motions.length ? m.summary.indexOf(m.motions[0].summary) : -1;
  let headline = cut > 0 ? m.summary.slice(0, cut).trim() : m.summary;
  // The asks are listed below; drop the sim's one-line tally of them.
  if (m.asks?.length) headline = headline.replace(/\s*Directors' asks:[^.]*\.?/, '').trim();
  // Directors who carried the same ask and met or missed it together share a line.
  const askGroups: NonNullable<BoardMeeting['asks']>[] = [];
  for (const a of m.asks ?? []) {
    const same = askGroups.find((x) => x[0].text === a.text && x[0].met === a.met);
    if (same) same.push(a); else askGroups.push([a]);
  }
  return (
    <div class="card">
      <div class="label">Board meeting · {monthLabel(m.month)}</div>
      <div style={{ margin: '4px 0 8px' }}>{headline}</div>
      {m.asks && m.asks.length > 0 && (
        <div style={{ borderTop: '1px solid var(--rule)', padding: '8px 0' }}>
          <div class="label" style={{ marginBottom: '4px' }}>Directors’ asks</div>
          {askGroups.map((grp) => (
            <div key={grp[0].directorId + grp[0].text} class="row" style={{ alignItems: 'flex-start', margin: '4px 0' }}>
              <span class={`tag ${grp[0].met ? 'green' : 'red'}`} style={{ flex: 'none' }}>{grp[0].met ? '✓ met' : '✗ missed'}</span>
              <div class="grow small"><b>{grp.map((a) => (g.people[a.directorId] ? shortName(g.people[a.directorId]) : '?')).join(' & ')}</b>: {grp[0].text}</div>
            </div>
          ))}
        </div>
      )}
      {m.motions.length === 0 && <div class="hint">No motions raised.</div>}
      {m.motions.map((mo) => {
        const votes = Object.entries(mo.votes);
        const yes = votes.filter(([, v]) => v).map(([id]) => id);
        const no = votes.filter(([, v]) => !v).map(([id]) => id);
        const names = (ids: string[]) => (ids.length ? ids.map((id) => (g.people[id] ? shortName(g.people[id]) : '?')).join(', ') : 'nobody');
        // Commendations help the CEO when they pass; every other motion helps when it is defeated.
        const good = mo.passed === (mo.kind === 'commend');
        const sense = mo.kind === 'commend'
          ? (mo.passed ? 'Good for you: the board commended you.' : 'Against you: the board withheld the commendation.')
          : (mo.passed ? 'Against you: the motion carried.' : 'Good for you: the motion was defeated.');
        return (
          <div key={mo.id} style={{ borderTop: '1px solid var(--rule)', padding: '8px 0' }}>
            <div class="row"><b class="grow">{mo.summary}</b><span class={`tag ${good ? 'green' : 'red'}`} style={{ flex: 'none' }}>{mo.passed ? 'passed' : 'defeated'}</span></div>
            <div class="small dim">{MOTION[mo.kind] ?? mo.kind} · proposed by {g.people[mo.proposerId] ? fullName(g.people[mo.proposerId]) : '?'}</div>
            <div class="small"><span class={good ? 'green' : 'red'}>{sense}</span></div>
            <div class="small mono">Vote {yes.length}–{no.length}{yes.length === no.length ? ', the chair broke the tie' : ''}</div>
            <div class="small dim">For: {names(yes)}. Against: {names(no)}.</div>
          </div>
        );
      })}
    </div>
  );
}

/** The three ways to work a director, with what each will do to this one. */
function Lobby({ id }: { id: string }) {
  const g = game();
  const d = g.people[id];
  const cost = ATTENTION_COST.lobbyDirector;
  const name = shortName(d);
  const cash = g.player.personalCash;
  const broke = cash < FAVOR_COST;
  const secret = d.secrets.filter((x) => x.revealed).sort((a, b) => b.severity - a.severity)[0];
  const pressure = () => run((s) => lobbyDirector(s, id, 'pressure'));
  return (
    <>
      <div class="lobbybtns">
        <Btn cls="sm" cost={cost} onClick={() => run((s) => lobbyDirector(s, id, 'persuade'))}>Persuade</Btn>
        <Btn cls="sm" cost={cost} disabled={broke} title={broke ? 'Not enough personal cash' : undefined} onClick={() => run((s) => lobbyDirector(s, id, 'favor'))}>Favor</Btn>
        {secret
          ? <Btn cls="sm warn" cost={cost} onClick={pressure}>Pressure</Btn>
          : <ConfirmBtn label="Pressure" confirmLabel="Confirm" cls="sm warn" cost={cost} onClick={pressure} />}
      </div>
      <div class="lobby small dim">
        <div><b>Persuade:</b> walk {name} through the numbers. Builds goodwill, and more of it after good results.</div>
        <div>
          <b>Favor:</b> costs {formatZuzu(FAVOR_COST)} of your own cash{broke ? ` (you have ${formatZuzu(cash)})` : ''}.{' '}
          {d.traits.includes('principled')
            ? <span class="amber">{name} is principled: expect it to be taken as a bribe, and support to drop.</span>
            : 'Works best on a greedy director.'}
        </div>
        <div>
          <b>Pressure:</b>{' '}
          {secret
            ? <>uses what you hold on {name}. Leverage: {secret.description}</>
            : <span class="amber">you hold nothing on {name}. It will backfire: support drops and board confidence falls. Find leverage first (Fixer, Dirt).</span>}
        </div>
      </div>
    </>
  );
}

/** The sub-view the Board tab opens on next; it reverts to the directors after. */
let openOn: 'board' | 'fixer' = 'board';

/** Goes to the Board tab's fixer jobs (where reports land). */
export function showFixerJobs(): void {
  openOn = 'fixer';
  setTab('board');
}

export function BoardView() {
  const g = game();
  const [sub, setSub] = useState<'board' | 'fixer'>(() => {
    const first = openOn;
    openOn = 'board';
    return first;
  });
  return (
    <div>
      <div style={{ margin: '12px 0 4px' }}>
        <Seg value={sub} onChange={setSub} options={[['board', 'Board'], ['fixer', 'Fixer']]} />
      </div>
      {sub === 'board' ? (
        <>
          <h2>Directors <span class="mono">confidence {Math.round(g.company.boardConfidence)}</span></h2>
          <div class="hint" style={{ marginBottom: '8px' }}>Support: how each director leans in a vote, −100 to 100. Confidence is the board’s overall view of you.</div>
          {g.directors.map((d) => {
            const p = g.people[d.personId];
            if (!p) return null;
            let sup = 0;
            try { sup = directorSupport(g, d.personId); } catch { sup = 0; }
            const ask = (g.asks ?? []).find((a) => a.state === 'open' && a.directorId === d.personId);
            const pr = ask ? askProgress(g, ask) : null;
            return (
              <div class="card" key={d.personId}>
                <div class="row" style={{ justifyContent: 'space-between' }}>
                  <Portrait id={d.personId} size={40} onClick={() => openPerson(d.personId)} />
                  <div class="grow">
                    <div><PersonLink id={d.personId} /> {p.role === 'chair' && <span class="tag cyan">chair</span>}</div>
                    <div class="small dim">{AGENDA[d.agenda] ?? d.agenda} · {p.title}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div class="mono" style={{ color: sup < 0 ? 'var(--red)' : 'var(--green)' }}>{signed(sup)}</div>
                    <div class="small dim">support</div>
                  </div>
                </div>
                <div class="small" style={{ margin: '8px 0 6px', color: 'var(--text)', opacity: 0.85 }}>{shortName(p)} {AGENDA_PLAIN[d.agenda] ?? ''}.</div>
                {ask && pr && (
                  <div class="askbox" style={{ marginBottom: '8px' }}>
                    <div class="row" style={{ alignItems: 'flex-start' }}>
                      <div class="grow">
                        <div class="label">Asks this quarter · by {monthLabel(ask.dueMonth)}</div>
                        <div style={{ fontSize: '13px', marginTop: '2px' }}>{ask.text}</div>
                        <div class="small dim mono" style={{ marginTop: '2px' }}>{pr.label}</div>
                      </div>
                      <AskTag pr={pr} />
                    </div>
                  </div>
                )}
                <DivBar value={sup} />
                <Lobby id={d.personId} />
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
  const b = Math.max(budget ?? min, min);
  const jobs = [...g.fixerJobs].reverse();
  const target = (j: typeof jobs[number]) =>
    j.targetPersonId && g.people[j.targetPersonId] ? fullName(g.people[j.targetPersonId]) : j.targetUnitId && g.units[j.targetUnitId] ? g.units[j.targetUnitId].name : '—';
  return (
    <div>
      <h2>Request a job</h2>
      <div class="card stack">
        <Seg value={kind} onChange={(k) => { setKind(k); setUnitId(null); setPersonId(null); setBudget(null); }} options={[['materials', 'Materials'], ['specialHire', 'Special hire'], ['dirt', 'Dirt']]} />
        <div class="hint">
          {kind === 'materials' && 'Scarce inputs for a division, sourced off the books. Pick a division or one of its units.'}
          {kind === 'specialHire' && 'Extract a standout hire from elsewhere into a unit.'}
          {kind === 'dirt' && 'Find something on a person. Secrets surface in their file.'}
        </div>
        {kind === 'dirt' ? (
          personId ? <div>Target: <PersonChip id={personId} /> <button type="button" class="link small" onClick={() => setPersonId(null)}>change</button></div>
            : <PersonPicker g={g} onPick={setPersonId} />
        ) : (
          unitId ? <div>Into: <b>{g.units[unitId].name}</b> <button type="button" class="link small" onClick={() => setUnitId(null)}>change</button></div>
            : <UnitPicker g={g} filter={(x) => x !== g.rootUnitId && (kind !== 'materials' || !!g.divisions[x] || !!g.units[x].divisionId)} onPick={setUnitId} />
        )}
        {ready && (
          <>
            <div>
              <div class="row"><label class="label grow" for="fixer-budget">Budget</label><span class="mono">{formatZuzu(b)}</span></div>
              <input id="fixer-budget" type="range" aria-valuetext={formatZuzu(b)} min={min} max={Math.max(min * 8, min + 1)} step={Math.max(1000, Math.round(min / 20 / 1000) * 1000)} value={b} onInput={(e) => setBudget(Number(e.currentTarget.value))} />
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
