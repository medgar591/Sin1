import { useState } from 'preact/hooks';
import type { Person, PersonId, PromiseKind, Skills } from '../sim/types';
import { chainOfCommand, fullName, hasAttention, formatZuzu, monthLabel, bossOf, isLead } from '../sim/org';
import {
  demote, fire, grantOptions, investigatePerson, meet, promote, reassign, setSalary, skipLevelInfo,
  type MeetingApproach, type SkipLevelInfo,
} from '../sim/actions';
import { ATTENTION_COST, attentionCost } from '../sim/attention';
import { Bar, Btn, ConfirmBtn, DivBar, PersonChip, PersonLink, Seg, Sheet, Stepper, intelVisible, levelClass, signed, unitLabel } from './common';
import { UnitPicker } from './pickers';
import { closeSheet, game, goOrg, openUnit, run } from './store';

const SKILLS: [keyof Skills, string][] = [
  ['work', 'Work'], ['management', 'Management'], ['operations', 'Operations'], ['finance', 'Finance'], ['guile', 'Guile'],
];

function SkipWarn({ id }: { id: PersonId }) {
  const g = game();
  let info: SkipLevelInfo | null = null;
  try { info = skipLevelInfo(g, id); } catch { info = null; }
  const p = g.people[id];
  if (!info) return null;
  if (info.waived) {
    return <div class="okbox">On your radar{p.attentionReason ? ` (${p.attentionReason})` : ''}: no skip-level penalty.</div>;
  }
  if (info.bypassed.length === 0 || info.penalty === 0) return null;
  const parts = info.bypassed.map((b, i) => `${g.people[b]?.lastName ?? '?'} −${info!.penalties?.[i] ?? info!.penalty}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return (
    <div class="warnbox">
      Skip-level: you'll go around {list} loyalty.
      {' '}Anyone on your radar is exempt.
    </div>
  );
}

type Mode = null | 'meet' | 'promote' | 'reassign' | 'salary' | 'options';

export function PersonSheet({ id }: { id: PersonId }) {
  const g = game();
  const p = g.people[id];
  const [mode, setMode] = useState<Mode>(null);
  const [approach, setApproach] = useState<MeetingApproach>('rapport');
  const [pk, setPk] = useState<PromiseKind>('raise');
  const [months, setMonths] = useState(3);
  const [detail, setDetail] = useState('');
  const [sal, setSal] = useState(p?.salary ?? 0);
  const [opt, setOpt] = useState(100);
  if (!p) return null;
  const isPlayer = id === g.player.personId;
  const active = p.status === 'active';
  const inTree = p.unitId !== null;
  const canAct = active && inTree && !isPlayer && p.role !== 'ceo';
  const chain = chainOfCommand(g, id);
  const intel = intelVisible(g, p);
  const leads = isLead(g, p);
  const direct = bossOf(g, id) === g.player.personId;
  const rels = Object.entries(g.relations[id] ?? {}).filter(([o]) => g.people[o]).sort((a, b) => Math.abs(b[1].opinion) - Math.abs(a[1].opinion));
  const toYou = g.relations[id]?.[g.player.personId];
  const clique = p.cliqueId ? g.cliques[p.cliqueId] : null;
  const promises = g.promises.filter((x) => x.personId === id && x.state === 'open');
  const hist = [...p.history].reverse();
  const tog = (m: Mode) => setMode(mode === m ? null : m);
  const salStep = Math.max(1000, Math.round(p.salary * 0.05 / 1000) * 1000);
  const unit = p.unitId ? g.units[p.unitId] : null;

  return (
    <Sheet title={fullName(p)}>
      <div class="small dim">{p.title}{p.status !== 'active' && <> · <span class="red">{p.status}</span></>}</div>
      <div class="small dim" style={{ marginTop: '2px' }}>
        {p.pronouns} · age {p.age} · {p.heritage} · hired {monthLabel(p.hiredMonth)}
        {unit && <> · <a class="link" onClick={() => goOrg(unit.id)}>{unitLabel(g, unit.id)}</a></>}
      </div>
      {!active && p.fate && <div class="warnbox" style={{ marginTop: '8px' }}>{p.fate}</div>}
      {hasAttention(g, p) && <div class="warnbox" style={{ marginTop: '8px' }}>On your radar: {p.attentionReason ?? 'noteworthy'} (until {monthLabel(p.attentionUntil!)})</div>}
      {chain.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <div class="label">Reports to</div>
          {chain.slice(0, 5).map((b) => <PersonChip key={b} id={b} />)}
        </div>
      )}

      {canAct && (
        <>
          <h2>Actions</h2>
          <div class="stack">
            <SkipWarn id={id} />
            <div class="grid2">
              <Btn onClick={() => tog('meet')} cost={ATTENTION_COST.meet}>Meet</Btn>
              <Btn onClick={() => tog('promote')} cost={ATTENTION_COST.promote}>Promote</Btn>
              <Btn onClick={() => run((s) => demote(s, id))} cost={ATTENTION_COST.demote} disabled={!leads} title={leads ? undefined : 'Only leads can be demoted'}>Demote</Btn>
              <Btn onClick={() => tog('reassign')} cost={ATTENTION_COST.reassign} disabled={leads} title={leads ? 'Leads cannot be reassigned: demote or promote instead' : undefined}>Reassign</Btn>
              <Btn onClick={() => tog('salary')}>Salary</Btn>
              <Btn onClick={() => tog('options')}>Options</Btn>
              <Btn onClick={() => run((s) => investigatePerson(s, id))} cost={ATTENTION_COST.investigatePerson}>Investigate</Btn>
              <ConfirmBtn label="Fire" cls="danger" cost={attentionCost(game(), 'fire', id)} onClick={() => run((s) => fire(s, id))} />
            </div>

            <div class="hint">{leads ? 'Leads can be promoted, demoted or fired, not reassigned.' : 'Reassign moves them as a member; Promote makes them a lead.'}</div>
            {mode === 'meet' && (
              <div class="card stack">
                <Seg value={approach} onChange={setApproach} options={[['rapport', 'Rapport'], ['promise', 'Promise'], ['threaten', 'Threaten'], ['probe', 'Probe']]} />
                <div class="hint">
                  {approach === 'rapport' && 'Build goodwill. Raises their opinion of you.'}
                  {approach === 'promise' && 'Commit to something. Promises are tracked; breaking one costs you.'}
                  {approach === 'threaten' && 'Push for performance through fear. Works, but leaves a mark.'}
                  {approach === 'probe' && 'Sound them out for information about what is going on around them.'}
                </div>
                {approach === 'promise' && (
                  <>
                    <Seg value={pk} onChange={setPk} options={[['raise', 'Raise'], ['promotion', 'Promotion'], ['protection', 'Protect'], ['budget', 'Budget']]} />
                    <input type="text" placeholder="Detail (optional)" value={detail} onInput={(e) => setDetail(e.currentTarget.value)} />
                    <Stepper value={months} step={1} min={1} max={24} format={(n) => `within ${n} mo`} onChange={setMonths} />
                  </>
                )}
                <Btn cls="primary block" cost={ATTENTION_COST.meet} onClick={() =>
                  run((s) => meet(s, id, approach, approach === 'promise' ? { kind: pk, detail: detail.trim() || `${pk} for ${fullName(p)}`, months } : undefined))}>
                  Hold meeting
                </Btn>
              </div>
            )}
            {mode === 'promote' && (
              <div class="card">
                <div class="label" style={{ marginBottom: '6px' }}>Promote to lead of…</div>
                <UnitPicker g={g} filter={(x) => x !== g.rootUnitId && g.units[x].leadId !== id} onPick={(u) => { if (run((s) => promote(s, id, u))) setMode(null); }} />
                <div class="hint">A sitting lead is moved down to a member.</div>
              </div>
            )}
            {mode === 'reassign' && (
              <div class="card">
                <div class="label" style={{ marginBottom: '6px' }}>Reassign to…</div>
                <UnitPicker g={g} filter={(x) => x !== g.rootUnitId && x !== p.unitId} onPick={(u) => { if (run((s) => reassign(s, id, u))) setMode(null); }} />
              </div>
            )}
            {mode === 'salary' && (
              <div class="card stack">
                <Stepper value={sal} step={salStep} min={0} format={formatZuzu} onChange={setSal} />
                <div class="hint">Currently {formatZuzu(p.salary)} a year.</div>
                <Btn cls="primary block" cost={ATTENTION_COST.setSalary} onClick={() => run((s) => setSalary(s, id, sal))}>Set salary</Btn>
              </div>
            )}
            {mode === 'options' && (
              <div class="card stack">
                <Stepper value={opt} step={50} min={50} format={(n) => `${n} shares`} onChange={setOpt} />
                <Btn cls="primary block" cost={ATTENTION_COST.grantOptions} onClick={() => run((s) => grantOptions(s, id, opt))}>Grant options</Btn>
              </div>
            )}
          </div>
        </>
      )}

      <h2>Standing</h2>
      <div class="stat">
        <div><span class="label">Loyalty</span><b class={levelClass(p.loyalty, 35, 25) === 'r' ? 'red' : ''}>{Math.round(p.loyalty)}</b></div>
        <div><span class="label">Satisf.</span><b class={levelClass(p.satisfaction) === 'r' ? 'red' : ''}>{Math.round(p.satisfaction)}</b></div>
        <div><span class="label">Perform.</span><b class={levelClass(p.performance, 40, 30) === 'r' ? 'red' : ''}>{Math.round(p.performance)}</b></div>
        <div><span class="label">Salary</span><b>{formatZuzu(p.salary)}</b></div>
        <div><span class="label">Options</span><b>{p.stockOptions}</b></div>
        <div><span class="label">Tenure</span><b>{Math.max(0, (p.leftMonth ?? g.month) - p.hiredMonth)} mo</b></div>
      </div>
      <h2>Skills</h2>
      {SKILLS.map(([k, l]) => (
        <div class="skill" key={k}>
          <span class="dim">{l}</span><Bar value={p.skills[k]} cls={p.skills[k] < 35 ? 'a' : ''} /><span class="mono">{Math.round(p.skills[k])}</span>
        </div>
      ))}
      <div style={{ marginTop: '8px' }}>
        {p.traits.map((t) => <span key={t} class="tag cyan" style={{ marginRight: '4px' }}>{t}</span>)}
        {intel && <span class="tag" title="ambition / greed">amb {Math.round(p.ambition)} · greed {Math.round(p.greed)}</span>}
      </div>

      {promises.length > 0 && (
        <>
          <h2>Your open promises</h2>
          {promises.map((x) => <div key={x.id} class="card warn small">{x.kind}: {x.detail} <span class="dim">· due {monthLabel(x.dueMonth)}</span></div>)}
        </>
      )}

      <h2>Relationships &amp; secrets</h2>
      {direct && toYou && <div class="small">Opinion of you: <b class="mono">{signed(toYou.opinion)}</b></div>}
      {intel ? (
        <div class="stack">
          {clique && <div class="card"><span class="tag amber">clique</span> <b>{clique.name}</b>{clique.leaderId === id && <span class="tag"> leader</span>}<div class="small dim">{clique.agenda}</div></div>}
          {rels.length === 0 ? <div class="hint">No notable relationships.</div> : (
            <div class="list">
              {rels.slice(0, 12).map(([o, r]) => (
                <div key={o} class="item" style={{ cursor: 'default' }}>
                  <div class="grow"><PersonLink id={o} /> {r.tag && <span class={`tag ${r.tag === 'rival' || r.tag === 'grudge' ? 'red' : 'green'}`}>{r.tag}</span>}</div>
                  <div style={{ width: '90px' }}><DivBar value={r.opinion} /></div>
                  <span class="mono small" style={{ width: '34px', textAlign: 'right' }}>{signed(r.opinion)}</span>
                </div>
              ))}
            </div>
          )}
          {p.secrets.filter((s) => s.revealed).map((s) => (
            <div key={s.id} class={`card ${s.severity >= 2 ? 'bad' : 'warn'}`}>
              <span class={`tag ${s.severity >= 2 ? 'red' : 'amber'}`}>{s.kind}</span> <span class="small dim">severity {s.severity}</span>
              <div>{s.description}</div>
              {s.involvedIds.map((o) => <PersonChip key={o} id={o} />)}
            </div>
          ))}
          {p.secrets.some((s) => !s.revealed) && <div class="unknown">More may still be hidden.</div>}
        </div>
      ) : (
        <div class="unknown">
          Unknown. Relationships, cliques and secrets are hidden until Security investigates {p.firstName}
          {unit && <> or <a class="link" onClick={() => openUnit(unit.id)}>their unit</a></>}.
        </div>
      )}

      <h2>History with you</h2>
      {hist.length === 0 ? <div class="hint">Nothing on record.</div> : (
        <div class="tl">
          {hist.map((e, i) => (
            <div key={i} class={e.impact > 0 ? 'pos' : e.impact < 0 ? 'neg' : ''}>
              <div class="small mono dim">{monthLabel(e.month)} {e.byPlayer && <span class="tag cyan">you</span>} <span class={e.impact > 0 ? 'green' : e.impact < 0 ? 'red' : ''}>{e.impact ? signed(e.impact) : ''}</span></div>
              <div>{e.text}</div>
            </div>
          ))}
        </div>
      )}
      <button class="btn block" style={{ marginTop: '12px' }} onClick={closeSheet}>Close</button>
    </Sheet>
  );
}

export type { Person };
