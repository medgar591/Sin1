import { useState } from 'preact/hooks';
import type { InboxItem } from '../sim/types';
import { fullName, monthLabel } from '../sim/org';
import { resolveInboxItem } from '../sim/events';
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
        {it.unitId && g.units[it.unitId] && <span class="chip" onClick={() => openUnit(it.unitId!)}><span class="nm">{g.units[it.unitId].name}</span></span>}
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
          <div class="small faint">Auto-resolves after {monthLabel(it.expiresMonth)}.</div>
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

export function Inbox() {
  const g = game();
  const open = g.inbox.filter((i) => i.resolution === null).sort((a, b) => b.month - a.month);
  const doneCount = g.inbox.length - open.length;
  return (
    <div>
      <h2>Waiting to see you <span class="mono">{open.length}</span></h2>
      {open.length === 0 && <Empty>Nobody is waiting to see you.</Empty>}
      {open.map((i) => <Item key={i.id} it={i} />)}
      {doneCount > 0 && <History count={doneCount} />}
    </div>
  );
}
