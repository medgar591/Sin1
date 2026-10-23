import type { InboxItem } from '../sim/types';
import { monthLabel } from '../sim/org';
import { resolveInboxItem } from '../sim/events';
import { Btn, Empty, PersonChip } from './common';
import { game, openUnit, run } from './store';

function Item({ it, done }: { it: InboxItem; done?: boolean }) {
  const g = game();
  const res = it.resolution ? it.options.find((o) => o.id === it.resolution) : null;
  return (
    <div class={`card ${done ? '' : 'warn'}`}>
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <b>{it.title}</b>
        <span class="mono small dim" style={{ whiteSpace: 'nowrap' }}>{monthLabel(it.month)}</span>
      </div>
      <div class="dim" style={{ margin: '6px 0' }}>{it.body}</div>
      <div>
        {it.subjectIds.map((id) => <PersonChip key={id} id={id} />)}
        {it.unitId && g.units[it.unitId] && <span class="chip" onClick={() => openUnit(it.unitId!)}>{g.units[it.unitId].name}</span>}
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

export function Inbox() {
  const g = game();
  const open = g.inbox.filter((i) => i.resolution === null).sort((a, b) => b.month - a.month);
  const done = g.inbox.filter((i) => i.resolution !== null).sort((a, b) => b.month - a.month);
  return (
    <div>
      <h2>Needs a decision <span class="mono">{open.length}</span></h2>
      {open.length === 0 && <Empty>Inbox clear.</Empty>}
      {open.map((i) => <Item key={i.id} it={i} />)}
      {done.length > 0 && (
        <details>
          <summary>History ({done.length})</summary>
          {done.slice(0, 60).map((i) => <Item key={i.id} it={i} done />)}
        </details>
      )}
    </div>
  );
}
