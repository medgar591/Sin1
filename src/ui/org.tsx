import { useState } from 'preact/hooks';
import type { FunctionKind, OrgUnit, Person, UnitKind } from '../sim/types';
import { explainUnitOutput } from '../sim/economy';
import { bossOf, fullName, isActive, peopleUnder, unitAncestry, formatZuzu } from '../sim/org';
import {
  createUnit, dissolveUnit, hire, investigateUnit, mergeUnits, moveUnit, setBudget, type HireTier,
} from '../sim/actions';
import { ATTENTION_COST } from '../sim/attention';
import { Bar, Btn, ConfirmBtn, KIND_LABEL, PersonLink, Seg, Sheet, Stepper, levelClass, personFlag, stanceColor, stanceWord, unitFlag, unitIntel } from './common';
import { Portrait } from './portrait';
import { PlayersView } from './players';
import { ALLOWED_PARENTS, UnitPicker, subtreeIds } from './pickers';
import { closeSheet, game, openPerson, openUnit, run, setOrgMode, setOrgUnit, showUnit, S, type OrgMode } from './store';

function PersonRow({ p }: { p: Person }) {
  const g = game();
  const f = personFlag(g, p);
  return (
    <button class="item" onClick={() => openPerson(p.id)}>
      <span class={`mark m${f}`} />
      <Portrait id={p.id} size={32} />
      <div class="grow">
        <div class="t">{fullName(p)}</div>
        <div class="s">{p.title}</div>
      </div>
      <div style={{ width: '56px' }}>
        <div class="small mono dim" style={{ textAlign: 'right' }}>{Math.round(p.performance)}</div>
        <Bar value={p.performance} cls={levelClass(p.performance, 40, 30)} />
      </div>
    </button>
  );
}

function UnitRow({ u }: { u: OrgUnit }) {
  const g = game();
  const f = unitFlag(g, u);
  const lead = u.leadId ? g.people[u.leadId] : null;
  const hc = peopleUnder(g, u.id).filter((id) => g.people[id] && isActive(g.people[id])).length;
  return (
    <button class="item" onClick={() => setOrgUnit(u.id)}>
      <span class={`mark m${f}`} />
      <Portrait id={u.leadId} size={32} />
      <div class="grow">
        <div class="t">{u.name}</div>
        <div class="s">{KIND_LABEL[u.kind]} · {lead ? fullName(lead) : <span class="red">vacant</span>} · {hc} ppl</div>
      </div>
      <div style={{ width: '64px' }}>
        <div class="row small mono"><span class="dim grow">out</span>{Math.round(u.output)}</div>
        <Bar value={u.output} max={150} cls={levelClass(u.output, 75, 50)} />
        <div class="row small mono" style={{ marginTop: '2px' }}><span class="dim grow">mor</span>{Math.round(u.morale)}</div>
      </div>
      <span class="faint">›</span>
    </button>
  );
}

function UnitsView() {
  const g = game();
  const [all, setAll] = useState(false);
  const id = S.orgUnit && g.units[S.orgUnit] ? S.orgUnit : g.rootUnitId;
  const u = g.units[id];
  const crumbs = unitAncestry(g, id).reverse();
  const lead = u.leadId ? g.people[u.leadId] : null;
  const members = u.memberIds.map((m) => g.people[m]).filter((p) => p && isActive(p));
  const shown = all ? members : members.slice(0, 25);
  const hc = peopleUnder(g, id).filter((x) => g.people[x] && isActive(g.people[x])).length;
  const intel = unitIntel(g, u);
  return (
    <div>
      <div class="crumbs">
        {crumbs.map((c, i) => (
          <span key={c.id}>
            {i > 0 && <span class="sep"> › </span>}
            <button onClick={() => setOrgUnit(c.id)}>{c.kind === 'executive' ? 'CEO' : c.name}</button>
          </span>
        ))}
      </div>
      <div class="card">
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>{u.kind === 'executive' ? 'CEO office' : u.name}</h3>
            <div class="small dim">{KIND_LABEL[u.kind]} · {hc} people · budget {formatZuzu(u.budget)}/mo</div>
          </div>
          <button class="btn sm" onClick={() => openUnit(id)}>Actions</button>
        </div>
        <div class="grid2" style={{ marginTop: '8px' }}>
          <div><div class="row small"><span class="dim grow">Output</span><span class="mono">{Math.round(u.output)}</span></div><Bar value={u.output} max={150} cls={levelClass(u.output, 75, 50)} /></div>
          <div><div class="row small"><span class="dim grow">Morale</span><span class="mono">{Math.round(u.morale)}</span></div><Bar value={u.morale} cls={levelClass(u.morale)} /></div>
        </div>
        <details>
          <summary class="small">What drives output</summary>
          {(() => { try { return explainUnitOutput(g, id).map((f, i) => (
            <div key={i} class="row small"><span class="grow dim">{f.label}</span><span class={`mono ${f.effect < 0 ? 'red' : 'green'}`}>{f.effect > 0 ? '+' : ''}{f.effect}</span></div>
          )); } catch { return null; } })()}
        </details>
        <div class="small" style={{ marginTop: '8px' }}>
          {intel ? <span class="green">Intel current: investigated {g.month - (unitAncestry(g, id).map((x) => x.investigatedMonth).filter((m): m is number => m !== null).sort((a, b) => b - a)[0] ?? g.month)} mo ago</span>
            : <span class="dim">Internal dynamics unknown: <a class="link" onClick={() => openUnit(id)}>investigate</a></span>}
        </div>
      </div>

      <h2>Lead</h2>
      {lead ? <div class="list"><PersonRow p={lead} /></div> : <div class="warnbox">Seat vacant. Hire or promote a lead from Actions.</div>}

      {u.childIds.length > 0 && (
        <>
          <h2>Units <span class="mono">{u.childIds.length}</span></h2>
          <div class="list">{u.childIds.map((c) => g.units[c] && <UnitRow key={c} u={g.units[c]} />)}</div>
        </>
      )}
      {members.length > 0 && (
        <>
          <h2>Members <span class="mono">{members.length}</span></h2>
          <div class="list">{shown.map((p) => <PersonRow key={p.id} p={p} />)}</div>
          {members.length > shown.length && <button class="btn block" style={{ marginTop: '8px' }} onClick={() => setAll(true)}>Show all {members.length}</button>}
        </>
      )}
      {u.childIds.length === 0 && members.length === 0 && <div class="hint">Nobody here besides the lead.</div>}
    </div>
  );
}

// --- Chart ----------------------------------------------------------------------

/** Folded/unfolded overrides; kept across tab switches. Default: the root and the C-suite are open. */
const chartToggle = new Map<string, boolean>();
const chartOpen = (u: OrgUnit) => chartToggle.get(u.id) ?? (u.kind === 'executive' || u.kind === 'function');

function headcountOf(g: ReturnType<typeof game>, id: string): number {
  return peopleUnder(g, id).filter((x) => g.people[x] && isActive(g.people[x])).length;
}

function StaffNode({ id }: { id: string }) {
  const g = game();
  const p = g.people[id];
  const op = g.relations[id]?.[g.player.personId]?.opinion ?? 0;
  return (
    <li class="cli slim">
      <div class="cn slim f0">
        <button class="cn-face" onClick={() => openPerson(id)} aria-label={fullName(p)}>
          <Portrait id={id} size={32} dot={stanceColor(op)} />
        </button>
        <div class="cn-body" onClick={() => openPerson(id)}>
          <div class="t">{fullName(p)}</div>
          <div class="s">{p.title} · your office</div>
        </div>
      </div>
    </li>
  );
}

function UnitNode({ u, rerender }: { u: OrgUnit; rerender: () => void }) {
  const g = game();
  const me = g.player.personId;
  const root = u.kind === 'executive';
  const lead = u.leadId ? g.people[u.leadId] : null;
  const open = chartOpen(u);
  const staff = root ? u.memberIds.filter((m) => g.people[m] && isActive(g.people[m])) : [];
  const kids = u.childIds.filter((c) => g.units[c]);
  const foldable = kids.length > 0 || staff.length > 0;
  const hc = headcountOf(g, u.id);
  const direct = !!lead && !root && bossOf(g, lead.id) === me;
  const op = direct ? g.relations[lead!.id]?.[me]?.opinion ?? 0 : 0;
  const flag = unitFlag(g, u);
  const toggle = () => {
    if (!foldable) return showUnit(u.id);
    chartToggle.set(u.id, !open);
    rerender();
  };
  return (
    <li class="cli">
      <div class={`cn f${flag}`}>
        <button class="cn-face" onClick={() => (lead ? openPerson(lead.id) : showUnit(u.id))} aria-label={lead ? fullName(lead) : 'Vacant seat'}>
          <Portrait id={lead?.id} size={32} dot={direct ? stanceColor(op) : undefined} />
        </button>
        <div class="cn-body" onClick={toggle}>
          <div class="t">{root ? g.company.name : u.name}</div>
          <div class="s">
            {lead ? (
              <a class="cn-lead" onClick={(e) => { e.stopPropagation(); openPerson(lead.id); }}>{root ? `${fullName(lead)} (you)` : fullName(lead)}</a>
            ) : <span class="red">Vacant</span>}
            {direct && <span style={{ color: stanceColor(op) }}> · {stanceWord(op).toLowerCase()}</span>}
          </div>
          <div class="s2">{root ? 'CEO' : KIND_LABEL[u.kind]} · {hc} {kids.length || root ? 'people' : 'staff'}</div>
        </div>
        {foldable && <span class="cn-chev" onClick={toggle}>{open ? '▾' : '▸'}</span>}
        <button class="cn-go" onClick={() => showUnit(u.id)} aria-label={`Open ${u.name} in Units`}>›</button>
      </div>
      {foldable && open && (
        <ul>
          {staff.map((m) => <StaffNode key={m} id={m} />)}
          {kids.map((c) => <UnitNode key={c} u={g.units[c]} rerender={rerender} />)}
        </ul>
      )}
    </li>
  );
}

function OrgChart() {
  const g = game();
  const [, setN] = useState(0);
  const rerender = () => setN((n) => n + 1);
  const ops = Object.values(g.units).find((x) => x.functionKind === 'operations');
  const coo = ops?.leadId ? g.people[ops.leadId] : null;
  return (
    <div>
      <div class="chartkey">
        Officers report to you.{ops && <> Divisions report to the COO{coo ? <> (<a class="link" onClick={() => openPerson(coo.id)}>{fullName(coo)}</a>)</> : ''}.</>}
      </div>
      <div class="hint" style={{ marginBottom: '8px' }}>Dot on a face: how they see you. Coloured edge: unit health. Tap a row to fold it; › opens the unit.</div>
      <ul class="ctree top"><UnitNode u={g.units[g.rootUnitId]} rerender={rerender} /></ul>
    </div>
  );
}

export function OrgView() {
  return (
    <div>
      <div style={{ margin: '10px 0 2px' }}>
        <Seg<OrgMode> value={S.orgMode} onChange={setOrgMode} options={[['chart', 'Chart'], ['players', 'Players'], ['units', 'Units']]} />
      </div>
      {S.orgMode === 'chart' && <OrgChart />}
      {S.orgMode === 'players' && <PlayersView />}
      {S.orgMode === 'units' && <UnitsView />}
    </div>
  );
}

type UMode = null | 'budget' | 'hire' | 'move' | 'merge' | 'create' | 'dissolve';

export function UnitSheet({ id }: { id: string }) {
  const g = game();
  const u = g.units[id];
  const [mode, setMode] = useState<UMode>(null);
  const [budget, setB] = useState(u?.budget ?? 0);
  const [tier, setTier] = useState<HireTier>('standard');
  const [asLead, setAsLead] = useState(!u?.leadId);
  const [newKind, setNewKind] = useState<UnitKind | 'function'>('team');
  const [fk, setFk] = useState<FunctionKind>('operations');
  const [name, setName] = useState('');
  if (!u) return null;
  const root = u.kind === 'executive';
  const step = Math.max(5000, Math.round(u.budget * 0.1 / 5000) * 5000);
  const LABELS: Record<string, string> = { function: 'Function', subdivision: 'Sub-division', team: 'Team', subteam: 'Sub-team' };
  const takenFns = new Set(Object.values(g.units).map((x) => x.functionKind).filter(Boolean));
  const freeFns = (['operations', 'finance', 'security', 'personnel', 'legal'] as FunctionKind[]).filter((f) => !takenFns.has(f));
  const kinds: [string, string][] = (Object.keys(LABELS) as UnitKind[])
    .filter((k) => ALLOWED_PARENTS[k].includes(u.kind) && (k !== 'function' || freeFns.length > 0))
    .map((k) => [k, LABELS[k]]);
  const kind = kinds.some(([k]) => k === newKind) ? newKind : (kinds[0]?.[0] as UnitKind | undefined) ?? 'team';
  const fnSel = freeFns.includes(fk) ? fk : freeFns[0];
  const movable = !root && u.kind !== 'function';
  const mergeable = !root && u.kind !== 'division' && u.kind !== 'function';
  const bad = subtreeIds(g, id);
  const tog = (m: UMode) => setMode(mode === m ? null : m);

  return (
    <Sheet title={u.kind === 'executive' ? 'CEO office' : u.name}>
      <div class="small dim">{KIND_LABEL[u.kind]} · budget {formatZuzu(u.budget)}/mo · output {Math.round(u.output)} · morale {Math.round(u.morale)}</div>
      <div class="stack" style={{ marginTop: '10px' }}>
        <div class="grid2">
          <button class="btn" onClick={() => tog('budget')}>Budget</button>
          <button class="btn" onClick={() => tog('hire')}>Hire</button>
          {movable && <button class="btn" onClick={() => tog('move')}>Move unit</button>}
          {mergeable && <button class="btn" onClick={() => tog('merge')}>Merge into…</button>}
          {kinds.length > 0 && <button class="btn" onClick={() => tog('create')}>New sub-unit</button>}
          {mergeable && <button class="btn danger" onClick={() => tog('dissolve')}>Dissolve</button>}
        </div>
        <Btn cls="block" cost={ATTENTION_COST.investigateUnit} onClick={() => run((s) => investigateUnit(s, id))}>Investigate unit (Security)</Btn>

        {mode === 'budget' && (
          <div class="card">
            <div class="label">Monthly budget on top of salaries</div>
            <Stepper value={budget} step={step} min={0} format={formatZuzu} onChange={setB} />
            <Btn cls="primary block" cost={ATTENTION_COST.setBudget} onClick={() => run((s) => setBudget(s, id, budget))}>Set budget</Btn>
          </div>
        )}
        {mode === 'hire' && (
          <div class="card stack">
            <div class="label">Quality tier</div>
            <Seg value={tier} onChange={setTier} options={[['cheap', 'Cheap'], ['standard', 'Standard'], ['premium', 'Premium']]} />
            {!u.leadId ? (
              <>
                <div class="hint">The lead seat is empty.</div>
                <Seg value={asLead ? 'lead' : 'member'} onChange={(v) => setAsLead(v === 'lead')} options={[['member', 'As member'], ['lead', 'As lead']]} />
              </>
            ) : <div class="hint">Joins as a member; the seat is held by {g.people[u.leadId] ? fullName(g.people[u.leadId]) : 'the lead'}. To change the lead, promote someone.</div>}
            <div class="warnbox">Hiring directly goes around the unit's leads, who lose some loyalty. Premium hires cost a recruiter fee.</div>
            <Btn cls="primary block" cost={ATTENTION_COST.hire} onClick={() => run((s) => hire(s, id, asLead && !u.leadId, tier))}>Hire {tier}</Btn>
          </div>
        )}
        {mode === 'move' && (
          <div class="card">
            <div class="label" style={{ marginBottom: '6px' }}>Move under…</div>
            <UnitPicker g={g} exclude={bad} filter={(x) => x !== u.parentId && ALLOWED_PARENTS[u.kind].includes(g.units[x].kind)} onPick={(p) => { if (run((s) => moveUnit(s, id, p))) closeSheet(); }} />
            <div class="hint">Only compatible parents are listed. Costs {ATTENTION_COST.restructure} attention.</div>
          </div>
        )}
        {mode === 'merge' && (
          <div class="card">
            <div class="label" style={{ marginBottom: '6px' }}>Fold {u.name} into…</div>
            <UnitPicker g={g} exclude={bad} filter={(x) => x !== g.rootUnitId && x !== u.parentId && u.childIds.every((c) => ALLOWED_PARENTS[g.units[c].kind].includes(g.units[x].kind))} onPick={(keep) => { if (run((s) => mergeUnits(s, keep, id))) closeSheet(); }} />
            <div class="hint">Its people and sub-units move over; its lead becomes a member. Costs {ATTENTION_COST.restructure} attention.</div>
          </div>
        )}
        {mode === 'create' && (
          <div class="card stack">
            {kinds.length > 1 && <Seg value={kind as string} onChange={(v) => setNewKind(v as UnitKind)} options={kinds} />}
            {kind === 'function' && (
              <select value={fnSel} onChange={(e) => setFk(e.currentTarget.value as FunctionKind)}>
                {freeFns.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            )}
            <input type="text" placeholder="Unit name" value={name} onInput={(e) => setName(e.currentTarget.value)} />
            <Btn cls="primary block" cost={ATTENTION_COST.restructure} disabled={!name.trim()} onClick={() =>
              run((s) => createUnit(s, id, kind as Exclude<UnitKind, 'executive' | 'function'> | 'function', name.trim(), kind === 'function' ? fnSel : undefined))}>
              Create
            </Btn>
          </div>
        )}
        {mode === 'dissolve' && (
          <div class="card stack">
            <div class="hint">People and sub-units move up to the parent. Their lead loses the seat.</div>
            <ConfirmBtn label="Dissolve unit" cls="block" cost={ATTENTION_COST.restructure} onClick={() => { if (run((s) => dissolveUnit(s, id))) { closeSheet(); if (S.orgUnit === id) setOrgUnit(u.parentId ?? g.rootUnitId); } }} />
          </div>
        )}
        {u.leadId && <div class="small">Lead: <PersonLink id={u.leadId} /></div>}
      </div>
    </Sheet>
  );
}
