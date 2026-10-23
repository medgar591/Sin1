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
  Secret,
  FunctionKind,
  UnitId,
} from './types';
import { isSeatTitle, leadTitle, memberTitle, roleForUnitKind } from './roles';
import { clamp } from './util';

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

/** "is" or "are", agreeing with the person's pronoun. */
export const be = (p: Person): string => (p.pronouns === 'they' ? 'are' : 'is');

/** "has" or "have". */
export const have = (p: Person): string => (p.pronouns === 'they' ? 'have' : 'has');

/** A regular present-tense verb agreeing with the pronoun: stay, stays; resent, resents. */
export const verb = (p: Person, base: string): string => (p.pronouns === 'they' ? base : `${base}s`);

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

/** True for board members, by role or by seat on the board. */
export function isDirector(state: GameState, p: Person): boolean {
  return p.role === 'chair' || p.role === 'director' || state.directors.some((d) => d.personId === p.id);
}

/** Directors still serving. */
export function activeDirectors(state: GameState): Person[] {
  return state.directors.map((d) => person(state, d.personId)).filter(isActive);
}

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

/**
 * The relation from `from` to `to`, created neutral if it does not exist.
 * Nobody has a relation with themselves, so a self pair gets a throwaway
 * neutral relation that is never stored.
 */
function ensureRelation(state: GameState, from: PersonId, to: PersonId): Relation {
  if (from === to) return { opinion: 0, tag: null };
  const row = (state.relations[from] ??= {});
  return (row[to] ??= { opinion: 0, tag: null });
}

/** Adjusts how `from` feels about `to`, creating the relation if needed. Does nothing when `from` is `to`. */
export function adjustOpinion(state: GameState, from: PersonId, to: PersonId, delta: number): void {
  const rel = ensureRelation(state, from, to);
  rel.opinion = clamp(rel.opinion + delta, -100, 100);
}

export function setTag(state: GameState, from: PersonId, to: PersonId, tag: RelTag | null): void {
  ensureRelation(state, from, to).tag = tag;
}

/** Changes loyalty to the CEO. */
export function adjustLoyalty(state: GameState, personId: PersonId, delta: number): void {
  const p = person(state, personId);
  p.loyalty = clamp(p.loyalty + delta);
}

export function adjustSatisfaction(state: GameState, personId: PersonId, delta: number): void {
  const p = person(state, personId);
  p.satisfaction = clamp(p.satisfaction + delta);
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

/** Gives a person a new secret. Severity: 1 embarrassing, 2 career-ending, 3 criminal. */
export function addSecret(
  state: GameState,
  personId: PersonId,
  secret: Pick<Secret, 'kind' | 'description' | 'severity'> & { involvedIds?: PersonId[] },
): Secret {
  const s: Secret = { id: newId(state, 's'), revealed: false, involvedIds: [], ...secret };
  person(state, personId).secrets.push(s);
  return s;
}

/** Reveals the person's hidden secrets of the given kinds and returns them. */
export function revealSecrets(p: Person, kinds: Secret['kind'][]): Secret[] {
  const found = p.secrets.filter((s) => kinds.includes(s.kind) && !s.revealed);
  for (const s of found) s.revealed = true;
  return found;
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

/**
 * Makes the person a plain member of a unit (removing them from any old seat).
 * A lead moving down, or anyone whose title was just a default seat title of
 * the unit they left, gets the new unit's member title; job titles stay.
 */
export function placeAsMember(state: GameState, personId: PersonId, unitId: UnitId): void {
  const p = person(state, personId);
  const from = p.unitId ? state.units[p.unitId] : null;
  const retitle = !!from && (from.leadId === personId || isSeatTitle(p.title, from));
  detachFromUnit(state, personId);
  const u = unit(state, unitId);
  u.memberIds.push(personId);
  p.unitId = unitId;
  p.role = 'worker';
  if (retitle) p.title = memberTitle(u);
}

/**
 * Seats the person as the unit's lead and gives them the seat's title. A
 * sitting lead steps down to a member of the same unit (and is returned so the
 * caller can apply the consequences).
 */
export function seatLead(state: GameState, unitId: UnitId, personId: PersonId): Person | null {
  const u = unit(state, unitId);
  const displaced = u.leadId && u.leadId !== personId ? person(state, u.leadId) : null;
  if (displaced) placeAsMember(state, displaced.id, unitId);
  detachFromUnit(state, personId);
  u.leadId = personId;
  const p = person(state, personId);
  p.unitId = unitId;
  p.role = roleForUnitKind[u.kind];
  p.title = leadTitle(u);
  return displaced;
}

/**
 * Removes someone from the company for good. Their relationships stay, so
 * friends and sponsors can still react to their going.
 */
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
      state.unitChurn[before.unitId] = (state.unitChurn[before.unitId] ?? 0) + (lead ? 2 : 1);
    }
  }
  detachFromUnit(state, personId);
  const p = person(state, personId);
  p.status = status;
  p.leftMonth = state.month;
  p.fate = fate;
  for (const c of Object.values(state.cliques)) c.memberIds = c.memberIds.filter((id) => id !== personId);
  p.cliqueId = null;
  delete state.plots[personId];
}

/** Can the player act on this person without the skip-level penalty? */
export function hasAttention(state: GameState, p: Person): boolean {
  return p.attentionUntil !== null && state.month <= p.attentionUntil;
}

/** An investigation of a unit keeps its people's inner workings visible this many months. */
export const INTEL_MONTHS = 6;

/** The latest recent investigation covering the unit (its own or an ancestor's), if any. */
export function unitIntelMonth(state: GameState, unitId: UnitId): Month | null {
  let best: Month | null = null;
  for (const u of unitAncestry(state, unitId)) {
    const m = u.investigatedMonth;
    if (m !== null && state.month - m <= INTEL_MONTHS && (best === null || m > best)) best = m;
  }
  return best;
}

/** Whether feuds, cliques, secrets and relationships of this person are visible to the player. */
export function hasIntel(state: GameState, personId: PersonId): boolean {
  const p = person(state, personId);
  if (p.investigatedMonth !== null) return true;
  return p.unitId !== null && unitIntelMonth(state, p.unitId) !== null;
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

/** The active lead of a C-suite function, if the seat is filled. */
export function functionHead(state: GameState, kind: FunctionKind): Person | null {
  const u = Object.values(state.units).find((x) => x.functionKind === kind);
  const lead = u?.leadId ? state.people[u.leadId] : undefined;
  return lead && isActive(lead) ? lead : null;
}

/** The CEO's chief of staff (or, failing that, whoever else works in the CEO's office). */
export function chiefOfStaff(state: GameState): Person | null {
  const root = state.units[state.rootUnitId];
  if (!root) return null;
  const staff = root.memberIds.map((id) => state.people[id]).filter((p): p is Person => !!p && isActive(p));
  return staff.find((p) => p.title === 'Chief of Staff') ?? staff[0] ?? null;
}
