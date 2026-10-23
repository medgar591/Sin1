// Shared helpers for reading and editing the org tree, people, relations and
// logs. Every sim module uses these instead of poking at GameState directly.
import type {
  GameState,
  LogEntry,
  Month,
  OrgUnit,
  Person,
  PersonId,
  PersonStatus,
  Relation,
  RelTag,
  Role,
  UnitId,
  UnitKind,
} from './types';

export const clamp = (value: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, value));

export function newId(state: GameState, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

export function person(state: GameState, id: PersonId): Person {
  const p = state.people[id];
  if (!p) throw new Error(`no person ${id}`);
  return p;
}

export function unit(state: GameState, id: UnitId): OrgUnit {
  const u = state.units[id];
  if (!u) throw new Error(`no unit ${id}`);
  return u;
}

export const fullName = (p: Person): string => `${p.firstName} ${p.lastName}`;

export function pronoun(p: Person, form: 'subject' | 'object' | 'possessive'): string {
  const table = {
    she: { subject: 'she', object: 'her', possessive: 'her' },
    he: { subject: 'he', object: 'him', possessive: 'his' },
    they: { subject: 'they', object: 'them', possessive: 'their' },
  } as const;
  return table[p.pronouns][form];
}

export function isActive(p: Person): boolean {
  return p.status === 'active';
}

/** Active people inside the company tree, excluding the board. */
export function activeStaff(state: GameState): Person[] {
  return Object.values(state.people).filter((p) => isActive(p) && p.unitId !== null);
}

export function headcount(state: GameState): number {
  return activeStaff(state).length;
}

export function playerPerson(state: GameState): Person {
  return person(state, state.player.personId);
}

export const roleForUnitKind: Record<UnitKind, Role> = {
  executive: 'ceo',
  function: 'officer',
  division: 'divisionHead',
  subdivision: 'subdivisionHead',
  team: 'teamLead',
  subteam: 'subteamLead',
};

/** True if the person leads the unit they are assigned to. */
export function isLead(state: GameState, p: Person): boolean {
  return p.unitId !== null && unit(state, p.unitId).leadId === p.id;
}

/**
 * The person's immediate boss. A lead reports to the nearest lead above their
 * unit; a member reports to their unit's lead (or the nearest lead above, if
 * the seat is empty). Null for the CEO, the board and former staff.
 */
export function bossOf(state: GameState, personId: PersonId): PersonId | null {
  const p = person(state, personId);
  if (p.unitId === null || !isActive(p)) return null;
  let u: OrgUnit | null = unit(state, p.unitId);
  if (u.leadId === p.id) u = u.parentId ? unit(state, u.parentId) : null;
  while (u) {
    if (u.leadId && u.leadId !== p.id) return u.leadId;
    u = u.parentId ? unit(state, u.parentId) : null;
  }
  return null;
}

/** Bosses from the immediate one up to the CEO. */
export function chainOfCommand(state: GameState, personId: PersonId): PersonId[] {
  const chain: PersonId[] = [];
  let boss = bossOf(state, personId);
  while (boss && !chain.includes(boss)) {
    chain.push(boss);
    boss = bossOf(state, boss);
  }
  return chain;
}

/** People whose immediate boss is this person. */
export function directReports(state: GameState, personId: PersonId): PersonId[] {
  return activeStaff(state)
    .filter((p) => p.id !== personId && bossOf(state, p.id) === personId)
    .map((p) => p.id);
}

/** The unit and all units below it. */
export function unitsUnder(state: GameState, unitId: UnitId): OrgUnit[] {
  const out: OrgUnit[] = [];
  const stack = [unitId];
  while (stack.length) {
    const u = unit(state, stack.pop()!);
    out.push(u);
    stack.push(...u.childIds);
  }
  return out;
}

/** Everyone (leads and members) in the unit and below it. */
export function peopleUnder(state: GameState, unitId: UnitId): PersonId[] {
  const ids: PersonId[] = [];
  for (const u of unitsUnder(state, unitId)) {
    if (u.leadId) ids.push(u.leadId);
    ids.push(...u.memberIds);
  }
  return ids;
}

/** Units from this one up to the root. */
export function unitAncestry(state: GameState, unitId: UnitId): OrgUnit[] {
  const out: OrgUnit[] = [];
  let u: OrgUnit | null = unit(state, unitId);
  while (u) {
    out.push(u);
    u = u.parentId ? unit(state, u.parentId) : null;
  }
  return out;
}

export function getRelation(state: GameState, from: PersonId, to: PersonId): Relation | null {
  return state.relations[from]?.[to] ?? null;
}

export function opinionOf(state: GameState, from: PersonId, to: PersonId): number {
  return getRelation(state, from, to)?.opinion ?? 0;
}

/** Adjusts how `from` feels about `to`, creating the relation if needed. */
export function adjustOpinion(state: GameState, from: PersonId, to: PersonId, delta: number): Relation {
  if (from === to) throw new Error('self relation');
  const row = (state.relations[from] ??= {});
  const rel = (row[to] ??= { opinion: 0, tag: null });
  rel.opinion = clamp(rel.opinion + delta, -100, 100);
  return rel;
}

export function setTag(state: GameState, from: PersonId, to: PersonId, tag: RelTag | null): void {
  adjustOpinion(state, from, to, 0).tag = tag;
}

/** Changes loyalty to the CEO. */
export function adjustLoyalty(state: GameState, personId: PersonId, delta: number): void {
  const p = person(state, personId);
  p.loyalty = clamp(p.loyalty + delta);
}

export function addLog(
  state: GameState,
  text: string,
  importance: LogEntry['importance'] = 1,
  personIds: PersonId[] = [],
): void {
  state.log.push({ month: state.month, text, importance, personIds });
}

export function addLifeEvent(
  state: GameState,
  personId: PersonId,
  kind: string,
  text: string,
  impact: number,
  byPlayer: boolean,
): void {
  person(state, personId).history.push({ month: state.month, kind, text, impact, byPlayer });
}

/** Takes a person out of whatever seat or unit they hold. Leaves a lead seat empty. */
export function detachFromUnit(state: GameState, personId: PersonId): void {
  const p = person(state, personId);
  if (p.unitId === null) return;
  const u = unit(state, p.unitId);
  if (u.leadId === personId) u.leadId = null;
  u.memberIds = u.memberIds.filter((id) => id !== personId);
  p.unitId = null;
}

/** Makes the person a plain member of a unit (removing them from any old seat). */
export function placeAsMember(state: GameState, personId: PersonId, unitId: UnitId): void {
  detachFromUnit(state, personId);
  const p = person(state, personId);
  const u = unit(state, unitId);
  u.memberIds.push(personId);
  p.unitId = unitId;
  p.role = 'worker';
}

/**
 * Seats the person as the unit's lead. The previous lead, if any, is left
 * without a unit; callers decide what happens to them.
 */
export function setLead(state: GameState, unitId: UnitId, personId: PersonId): void {
  const u = unit(state, unitId);
  if (u.leadId && u.leadId !== personId) person(state, u.leadId).unitId = null;
  detachFromUnit(state, personId);
  u.leadId = personId;
  const p = person(state, personId);
  p.unitId = unitId;
  p.role = roleForUnitKind[u.kind];
}

/** Removes someone from the company for good. */
export function removeFromCompany(
  state: GameState,
  personId: PersonId,
  status: Exclude<PersonStatus, 'active'>,
  fate: string,
): void {
  const before = person(state, personId);
  if (before.unitId !== null && state.units[before.unitId]) {
    // Departures disrupt the team they leave (a lead's exit more than a worker's).
    // A weak performer being dismissed is not a loss to the team.
    const lead = state.units[before.unitId].leadId === personId;
    if (lead || status !== 'fired') {
      const churn = (state.unitChurn ??= {});
      churn[before.unitId] = (churn[before.unitId] ?? 0) + (lead ? 2 : 1);
    }
  }
  detachFromUnit(state, personId);
  const p = person(state, personId);
  p.status = status;
  p.leftMonth = state.month;
  p.fate = fate;
  for (const c of Object.values(state.cliques)) c.memberIds = c.memberIds.filter((id) => id !== personId);
  p.cliqueId = null;
}

/** Can the player act on this person without the skip-level penalty? */
export function hasAttention(state: GameState, p: Person): boolean {
  return p.attentionUntil !== null && state.month <= p.attentionUntil;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(month: Month): string {
  return `${MONTHS[((month % 12) + 12) % 12]} ${2090 + Math.floor(month / 12)}`;
}

export function quarterLabel(month: Month): string {
  return `Q${Math.floor((month % 12) / 3) + 1} ${2090 + Math.floor(month / 12)}`;
}

/** True when this month closes a quarter (Mar, Jun, Sep, Dec). */
export function isQuarterEnd(month: Month): boolean {
  return month % 3 === 2;
}

/** Formats zuzu compactly, symbol after the number: 1.2Mㄓ, 340Kㄓ. */
export function formatZuzu(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const a = Math.abs(amount);
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}Bㄓ`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}Mㄓ`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3)}Kㄓ`;
  return `${sign}${Math.round(a)}ㄓ`;
}
