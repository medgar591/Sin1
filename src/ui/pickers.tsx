import { useState } from 'preact/hooks';
import type { GameState, UnitId, UnitKind, PersonId } from '../sim/types';
import { fullName, isActive } from '../sim/org';
import { KIND_LABEL } from './common';
import { Portrait } from './portrait';

/** Mirrors the sim's rules for which kinds of unit may sit under which (restructure actions reject the rest). */
export const ALLOWED_PARENTS: Record<UnitKind, UnitKind[]> = {
  executive: [],
  function: ['executive'],
  division: ['executive', 'function'],
  subdivision: ['division', 'subdivision'],
  team: ['division', 'subdivision', 'function'],
  subteam: ['team', 'subteam'],
};

export function flatUnits(g: GameState, exclude: Set<UnitId> = new Set()): { id: UnitId; depth: number }[] {
  const out: { id: UnitId; depth: number }[] = [];
  const walk = (id: UnitId, depth: number) => {
    const u = g.units[id];
    if (!u || exclude.has(id)) return;
    out.push({ id, depth });
    u.childIds.forEach((c) => walk(c, depth + 1));
  };
  walk(g.rootUnitId, 0);
  return out;
}

/** Descendants of a unit including itself. */
export function subtreeIds(g: GameState, id: UnitId): Set<UnitId> {
  const s = new Set<UnitId>();
  const walk = (x: UnitId) => { s.add(x); g.units[x]?.childIds.forEach(walk); };
  walk(id);
  return s;
}

export function UnitPicker({ g, onPick, exclude, filter }: { g: GameState; onPick: (id: UnitId) => void; exclude?: Set<UnitId>; filter?: (id: UnitId) => boolean }) {
  const [q, setQ] = useState('');
  const rows = flatUnits(g, exclude).filter(({ id }) => (!filter || filter(id)) && (!q || g.units[id].name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <input type="search" aria-label="Filter units" placeholder="Filter units…" value={q} onInput={(e) => setQ(e.currentTarget.value)} style={{ marginBottom: '8px' }} />
      <div class="list" style={{ maxHeight: '40dvh', overflowY: 'auto' }}>
        {rows.map(({ id, depth }) => {
          const u = g.units[id];
          const lead = u.leadId ? g.people[u.leadId] : null;
          return (
            <button type="button" key={id} class="item" onClick={() => onPick(id)} style={{ paddingLeft: q ? 12 : 12 + depth * 12 }}>
              <Portrait id={u.leadId} size={28} />
              <div class="grow">
                <div class="t">{u.kind === 'executive' ? 'CEO office' : u.name}</div>
                <div class="s">{KIND_LABEL[u.kind]} · {lead ? fullName(lead) : 'vacant'}</div>
              </div>
            </button>
          );
        })}
        {rows.length === 0 && <div class="item hint">No matches.</div>}
      </div>
    </div>
  );
}

export function PersonPicker({ g, onPick }: { g: GameState; onPick: (id: PersonId) => void }) {
  const [q, setQ] = useState('');
  const rows = q.length < 2 ? [] : Object.values(g.people)
    .filter((p) => isActive(p) && p.unitId !== null && p.id !== g.player.personId && fullName(p).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 25);
  return (
    <div>
      <input type="search" aria-label="Search people by name" placeholder="Search by name (2+ letters)…" value={q} onInput={(e) => setQ(e.currentTarget.value)} style={{ marginBottom: '8px' }} />
      {rows.length > 0 && (
        <div class="list" style={{ maxHeight: '36dvh', overflowY: 'auto' }}>
          {rows.map((p) => (
            <button type="button" key={p.id} class="item" onClick={() => onPick(p.id)}>
              <Portrait id={p.id} size={32} />
              <div class="grow"><div class="t">{fullName(p)}</div><div class="s">{p.title}</div></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
