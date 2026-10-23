import { useState } from 'preact/hooks';
import type { GameState, InboxItem, InboxKind } from '../sim/types';
import { fullName, isLead, monthLabel } from '../sim/org';
import { resolveInboxItem } from '../sim/events';
import { fail, ok } from '../sim/util';
import { Btn, Empty, PersonChip } from './common';
import { Portrait } from './portrait';
import { game, openPerson, openUnit, run } from './store';

function Visitor({ it }: { it: InboxItem }) {
  const g = game();
  const sp = it.speakerId ? g.people[it.speakerId] : null;
  if (!sp) return null;
  return (
    <>
      <div class="visitor">
        <button class="who" onClick={() => openPerson(sp.id)}>
          <Portrait id={sp.id} size={44} />
          <span class="grow">
            <span class="t">{fullName(sp)}</span>
            <span class="s">{sp.title}</span>
          </span>
        </button>
        <span class="mono small dim">{monthLabel(it.month)}</span>
      </div>
      {it.quote && <div class="bubble">{it.quote}</div>}
    </>
  );
}

/** What happens if the player lets the item lapse: the first option, applied as the month closes. */
function Fallback({ it }: { it: InboxItem }) {
  const first = it.options[0];
  if (!first) return null;
  const soon = it.expiresMonth <= game().month;
  return (
    <div class={`small ${soon ? 'amber' : 'faint'}`}>
      {soon && <b>Expires this month. </b>}
      If you don’t decide by the end of {monthLabel(it.expiresMonth)}: {first.label}.{first.hint ? ` ${first.hint.replace(/\.$/, '')}.` : ''}
    </div>
  );
}

function Item({ it, done }: { it: InboxItem; done?: boolean }) {
  const g = game();
  const res = it.resolution ? it.options.find((o) => o.id === it.resolution) : null;
  const sp = it.speakerId ? g.people[it.speakerId] : null;
  const visit = !!sp && !done;
  const subjects = visit ? it.subjectIds.filter((id) => id !== it.speakerId) : it.subjectIds;
  return (
    <div class={`card ${done ? '' : 'warn'}`}>
      {visit ? (
        <>
          <Visitor it={it} />
          <b>{it.title}</b>
          <div class="dim small" style={{ margin: '2px 0 6px' }}>{it.body}</div>
        </>
      ) : (
        <>
          <div class="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            {sp ? <span class="row grow" style={{ minWidth: 0 }}><Portrait id={sp.id} size={28} /><b class="clip">{it.title}</b></span> : <b>{it.title}</b>}
            <span class="mono small dim" style={{ whiteSpace: 'nowrap' }}>{monthLabel(it.month)}</span>
          </div>
          <div class="dim" style={{ margin: '6px 0' }}>{it.body}</div>
        </>
      )}
      <div>
        {subjects.map((id) => <PersonChip key={id} id={id} />)}
        {it.unitId && g.units[it.unitId] && <button type="button" class="chip" onClick={() => openUnit(it.unitId!)}><span class="nm">{g.units[it.unitId].name}</span></button>}
      </div>
      {done ? (
        <div class="small">Decision: <b>{res?.label ?? it.resolution}</b></div>
      ) : (
        <div class="stack" style={{ marginTop: '6px' }}>
          {it.options.map((o) => (
            <div key={o.id}>
              <Btn cls="block" cost={o.attention ?? 0} onClick={() => run((s) => resolveInboxItem(s, it.id, o.id))}>{o.label}</Btn>
              {o.hint && <div class="hint" style={{ marginTop: '2px' }}>{o.hint}</div>}
            </div>
          ))}
          <Fallback it={it} />
        </div>
      )}
    </div>
  );
}

/** Resolved items, collapsed by default. The cards mount only while the section is open. */
function History({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const items = open
    ? game().inbox.filter((i) => i.resolution !== null).sort((a, b) => b.month - a.month).slice(0, 60)
    : [];
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>History ({count})</summary>
      {items.map((i) => <Item key={i.id} it={i} done />)}
    </details>
  );
}

/** How much each kind of item matters to the CEO, highest first. */
const KIND_RANK: Record<InboxKind, number> = {
  scheme: 9,
  tipOff: 9,
  fixerFallout: 9,
  scandal: 8,
  embezzlement: 8,
  leak: 8,
  seatVacancy: 7,
  resignationThreat: 7,
  poachOffer: 7,
  pitch: 7,
  managerFiring: 6,
  breakthrough: 5,
  promotionDemand: 4,
  cliqueFormed: 4,
  complaint: 3,
  raiseDemand: 3,
  talentWave: 3,
  feud: 3,
};

/** A plot against the CEO outranks one between other people. */
const rank = (g: GameState, it: InboxItem) => KIND_RANK[it.kind] + ((it.kind === 'scheme' || it.kind === 'tipOff') && it.subjectIds.includes(g.player.personId) ? 1 : 0);

const leads = (g: GameState, id: string) => {
  const p = g.people[id];
  return !!p && p.unitId !== null && !!g.units[p.unitId] && isLead(g, p);
};

/** Feuds between people who lead nothing, which cost no attention to leave alone. */
const isSquabble = (g: GameState, it: InboxItem) =>
  it.kind === 'feud' && !!it.options[0] && !it.options[0].attention && !it.subjectIds.some((id) => leads(g, id));

/** Lets every squabble run its default option, committing once. */
function settleSquabbles(ids: string[]) {
  run((s) => {
    const units = new Set<string>();
    let label = '';
    let done = 0;
    for (const id of ids) {
      const it = s.inbox.find((i) => i.id === id);
      const first = it?.options[0];
      if (!it || !first || !resolveInboxItem(s, id, first.id).ok) continue;
      label = first.label;
      done++;
      if (it.unitId) units.add(it.unitId);
    }
    if (!done) return fail('Nothing to settle.');
    const where = units.size ? ` across ${units.size} unit${units.size === 1 ? '' : 's'}` : '';
    return ok(`${done} squabble${done === 1 ? '' : 's'} settled by default${where}: ${label}.`);
  });
}

/** Feuds on the floor, one line each (tap for the full card), with one button to leave them all to the default. */
function Squabbles({ items }: { items: InboxItem[] }) {
  const g = game();
  const first = items[0].options[0];
  const same = items.every((i) => i.options[0]?.label === first.label);
  const names = (it: InboxItem) => it.subjectIds.map((id) => g.people[id]).filter(Boolean).map((p) => fullName(p)).join(' and ');
  return (
    <div class="card squab">
      <b>Squabbles on the floor ({items.length})</b>
      <div class="small dim" style={{ margin: '2px 0 4px' }}>Feuds between staff who don’t lead a unit. Open one to settle it yourself.</div>
      {items.map((it) => (
        <details key={it.id}>
          <summary>{names(it)}{it.unitId && g.units[it.unitId] ? <span class="small dim"> · {g.units[it.unitId].name}</span> : null}</summary>
          <Item it={it} />
        </details>
      ))}
      <Btn cls="block" onClick={() => settleSquabbles(items.map((i) => i.id))}>{same ? `${first.label} for all ${items.length}` : `Default choice for all ${items.length}`}</Btn>
      <div class="small faint" style={{ marginTop: '4px' }}>{same && first.hint ? `${first.hint.replace(/\.$/, '')}. ` : ''}The same happens to each one when its month ends.</div>
    </div>
  );
}

export function Inbox() {
  const g = game();
  const open = g.inbox.filter((i) => i.resolution === null);
  const doneCount = g.inbox.length - open.length;
  const floor = open.filter((i) => isSquabble(g, i));
  const bundle = floor.length > 1 ? floor : [];
  const cards = open
    .filter((i) => !bundle.includes(i))
    .map((it, ix) => ({ it, ix, soon: it.expiresMonth <= g.month, rank: rank(g, it) }))
    .sort((a, b) => Number(b.soon) - Number(a.soon) || b.rank - a.rank || b.it.month - a.it.month || a.ix - b.ix);
  const soon = cards.filter((c) => c.soon);
  const later = cards.filter((c) => !c.soon);
  return (
    <div>
      <h2>Waiting to see you <span class="mono">{open.length}</span></h2>
      {open.length === 0 && <Empty>Nobody is waiting to see you.</Empty>}
      {soon.length > 0 && <div class="label" style={{ margin: '4px 0 6px' }}>Expiring this month ({soon.length})</div>}
      {soon.map((c) => <Item key={c.it.id} it={c.it} />)}
      {soon.length > 0 && (later.length > 0 || bundle.length > 0) && <div class="label" style={{ margin: '12px 0 6px' }}>Later</div>}
      {later.map((c) => <Item key={c.it.id} it={c.it} />)}
      {bundle.length > 0 && <Squabbles items={bundle} />}
      {doneCount > 0 && <History count={doneCount} />}
    </div>
  );
}
