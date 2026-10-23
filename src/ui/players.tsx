// The cast: who matters right now, grouped by how they touch the CEO.
import type { ComponentChildren } from 'preact';
import type { Person, PersonId } from '../sim/types';
import { bossOf, fullName, hasAttention, isActive, monthLabel } from '../sim/org';
import { directorSupport } from '../sim/board';
import { Bar, DivBar, intelVisible, loyaltyWord, plotStage, signed, stanceColor, stanceWord } from './common';
import { Portrait } from './portrait';
import { game, openPerson } from './store';

const AGENDA: Record<string, string> = {
  growth: 'Wants growth', safety: 'Wants safety', dividends: 'Wants dividends', reform: 'Wants reform', oldGuard: 'Old guard',
};

function Group({ title, count, hint, children }: { title: string; count: number; hint: string; children: ComponentChildren }) {
  return (
    <section>
      <h2>{title} <span class="mono">{count}</span></h2>
      {count === 0 ? <div class="unknown">{hint}</div> : children}
    </section>
  );
}

/** One person: portrait, name, a subtitle and anything on the right. Tap opens their sheet. */
function Row({ id, sub, right }: { id: PersonId; sub: ComponentChildren; right?: ComponentChildren }) {
  const p = game().people[id];
  if (!p) return null;
  return (
    <button type="button" class="item" onClick={() => openPerson(id)}>
      <Portrait id={id} size={32} />
      <div class="grow">
        <div class="t">{fullName(p)}</div>
        <div class="s">{sub}</div>
      </div>
      {right}
    </button>
  );
}

/** "Warm · loyal" in the stance colour, or a dash when the player has no read on them. */
function Stance({ p }: { p: Person }) {
  const g = game();
  const me = g.player.personId;
  const visible = bossOf(g, p.id) === me || intelVisible(g, p);
  if (!visible) return <span class="faint small">no read</span>;
  const op = g.relations[p.id]?.[me]?.opinion ?? 0;
  return (
    <div class="stancecol">
      <b style={{ color: stanceColor(op) }}>{stanceWord(op)}</b>
      <span>{loyaltyWord(p.loyalty).toLowerCase()}</span>
    </div>
  );
}

function Board() {
  const g = game();
  const dirs = g.directors.map((d) => ({ d, p: g.people[d.personId] })).filter((x) => x.p && isActive(x.p));
  return (
    <Group title="The board" count={dirs.length} hint="No directors are seated.">
      <div class="list">
        {dirs.map(({ d, p }) => {
          const sup = directorSupport(g, p.id);
          return (
            <Row
              key={p.id}
              id={p.id}
              sub={<>{p.role === 'chair' ? 'Chair · ' : ''}{AGENDA[d.agenda] ?? d.agenda}</>}
              right={
                <div class="supcol">
                  <div class="mono small" style={{ textAlign: 'right', color: sup < -15 ? 'var(--red)' : sup > 15 ? 'var(--green)' : 'var(--dim)' }}>{signed(sup)}</div>
                  <DivBar value={sup} />
                </div>
              }
            />
          );
        })}
      </div>
    </Group>
  );
}

function DirectReports() {
  const g = game();
  const me = g.player.personId;
  const ids = Object.values(g.people).filter((p) => isActive(p) && p.id !== me && p.unitId !== null && bossOf(g, p.id) === me);
  return (
    <Group title="Your direct reports" count={ids.length} hint="Nobody reports to you directly. Fill the officer seats.">
      <div class="list">
        {ids.map((p) => <Row key={p.id} id={p.id} sub={p.title} right={<Stance p={p} />} />)}
      </div>
    </Group>
  );
}

function DivisionHeads() {
  const g = game();
  const me = g.player.personId;
  const heads = Object.values(g.units)
    .filter((u) => u.kind === 'division')
    .map((u) => ({ u, p: u.leadId ? g.people[u.leadId] : null }))
    .filter((x): x is { u: typeof x.u; p: Person } => !!x.p && isActive(x.p) && bossOf(g, x.p.id) !== me);
  return (
    <Group title="Division heads" count={heads.length} hint="No division has a head right now.">
      <div class="list">
        {heads.map(({ u, p }) => (
          <Row
            key={p.id}
            id={p.id}
            sub={u.name}
            right={
              <div class="stancecol">
                <Stance p={p} />
                <span class="mono">out {Math.round(u.output)}</span>
              </div>
            }
          />
        ))}
      </div>
    </Group>
  );
}

function Threats() {
  const g = game();
  const me = g.player.personId;
  const plots = Object.entries(g.plots).filter(([pid, pl]) => pl.known && g.people[pid] && g.people[pl.targetId] && isActive(g.people[pid]));
  return (
    <Group title="Known threats" count={plots.length} hint="Nobody is known to be plotting. Investigate units or probe people in meetings to learn about campaigns.">
      {plots.map(([pid, pl]) => {
        const who = g.people[pid];
        const tgt = g.people[pl.targetId];
        const cls = pl.progress >= 75 ? 'r' : pl.progress >= 40 ? 'a' : '';
        return (
          <div key={pid} class="card bad">
            <div class="plotline">
              <button type="button" class="pl" onClick={() => openPerson(pid)}>
                <Portrait id={pid} size={40} ring="var(--red)" />
                <span class="t">{fullName(who)}</span>
              </button>
              <span class="arrow" aria-hidden="true">→</span>
              <button type="button" class="pl" onClick={() => openPerson(tgt.id)}>
                <Portrait id={tgt.id} size={40} ring={tgt.id === me ? 'var(--cyan)' : undefined} />
                <span class="t">{tgt.id === me ? 'You' : fullName(tgt)}</span>
              </button>
            </div>
            <div class="row small" style={{ marginTop: '8px' }}>
              <span class="grow"><Bar value={pl.progress} cls={cls} /></span>
              <span class={cls === 'r' ? 'red' : cls === 'a' ? 'amber' : 'dim'}>{plotStage(pl.progress)}</span>
            </div>
          </div>
        );
      })}
    </Group>
  );
}

function Factions() {
  const g = game();
  const cliques = Object.values(g.cliques).filter((c) => c.known);
  return (
    <Group title="Factions you know of" count={cliques.length} hint="Investigate units or probe people in meetings to learn about factions.">
      {cliques.map((c) => {
        const members = c.memberIds.filter((m) => g.people[m] && isActive(g.people[m]));
        const leader = g.people[c.leaderId];
        return (
          <div key={c.id} class="card">
            <div class="row"><span class="tag amber">faction</span><b class="grow clip">{c.name}</b><span class="mono small dim">{members.length}</span></div>
            <div class="small dim" style={{ margin: '4px 0 8px' }}>{c.agenda}</div>
            {leader && (
              <button type="button" class="pbadge tap" onClick={() => openPerson(leader.id)}>
                <Portrait id={leader.id} size={28} />
                <span class="grow"><span class="t">{fullName(leader)}</span><span class="s">Leader · {leader.title}</span></span>
              </button>
            )}
            <div class="faces">
              {members.slice(0, 8).map((m) => (
                <button key={m} type="button" aria-label={fullName(g.people[m]!)} onClick={() => openPerson(m)}>
                  <Portrait id={m} size={30} />
                </button>
              ))}
              {members.length > 8 && <span class="mono small dim">+{members.length - 8}</span>}
            </div>
          </div>
        );
      })}
    </Group>
  );
}

function Radar() {
  const g = game();
  const rows = Object.values(g.people).filter((p) => isActive(p) && hasAttention(g, p));
  return (
    <Group title="On your radar" count={rows.length} hint="Nobody is in the spotlight. Scandals and breakthroughs put people here, and you can deal with them directly.">
      <div class="list">
        {rows.map((p) => (
          <Row key={p.id} id={p.id} sub={<>{p.attentionReason ?? 'noteworthy'}</>} right={<span class="mono small dim">to {monthLabel(p.attentionUntil!)}</span>} />
        ))}
      </div>
    </Group>
  );
}

function Promises() {
  const g = game();
  const open = g.promises.filter((x) => x.state === 'open' && g.people[x.personId]).sort((a, b) => a.dueMonth - b.dueMonth);
  return (
    <Group title="Your promises" count={open.length} hint="You owe nobody anything. Promises made in meetings are tracked here; breaking one costs you.">
      <div class="list">
        {open.map((x) => {
          const soon = x.dueMonth <= g.month + 1;
          return (
            <Row
              key={x.id}
              id={x.personId}
              sub={<>{x.kind}: {x.detail}</>}
              right={<span class={`mono small ${soon ? 'amber' : 'dim'}`}>due {monthLabel(x.dueMonth)}{soon ? ' · soon' : ''}</span>}
            />
          );
        })}
      </div>
    </Group>
  );
}

export function PlayersView() {
  return (
    <div>
      <Board />
      <DirectReports />
      <DivisionHeads />
      <Threats />
      <Factions />
      <Radar />
      <Promises />
    </div>
  );
}
