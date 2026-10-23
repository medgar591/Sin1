// How people's relationships make them react to what happens to others.
//
// Convention: relations[a][b].tag is what b is to a. So relations[w][m].tag is
// 'mentor' when m is w's mentor, and relations[m][w].tag is 'protege' when w
// is m's protege. Either way m sponsors w.
import type { GameState, PersonId } from './types';
import { adjustLoyalty, adjustOpinion, isActive, isDirector, person } from './org';

const TIE_WEIGHT = { lover: 0.6, sponsor: 0.7, friend: 0.5, clique: 0.3, fan: 0.3 } as const;
const RIVAL_REACTION = 0.3;

/** True if `sponsorId` is the mentor of `protegeId` (from either side's view). */
export function isSponsor(state: GameState, sponsorId: PersonId, protegeId: PersonId): boolean {
  return state.relations[protegeId]?.[sponsorId]?.tag === 'mentor' || state.relations[sponsorId]?.[protegeId]?.tag === 'protege';
}

/** Active staff who sponsor the target (not the CEO, not directors). */
export function sponsorsOf(state: GameState, targetId: PersonId): PersonId[] {
  const out = new Set<PersonId>();
  for (const [x, row] of Object.entries(state.relations)) if (row[targetId]?.tag === 'protege') out.add(x);
  for (const [x, rel] of Object.entries(state.relations[targetId] ?? {})) if (rel.tag === 'mentor') out.add(x);
  return [...out].filter((x) => {
    const m = state.people[x];
    return m && isActive(m) && x !== state.player.personId && !isDirector(state, m);
  });
}

/** Tie strength between `x` and the target (positive: x cares about them, negative: x is their rival). */
function tieWeight(state: GameState, x: PersonId, targetId: PersonId): number {
  const rel = state.relations[x]?.[targetId];
  const t = person(state, targetId);
  const mate = t.cliqueId !== null && person(state, x).cliqueId === t.cliqueId;
  if (rel?.tag === 'lover') return TIE_WEIGHT.lover;
  if (isSponsor(state, targetId, x) || isSponsor(state, x, targetId)) return TIE_WEIGHT.sponsor;
  if (rel?.tag === 'friend') return TIE_WEIGHT.friend;
  if (rel?.tag === 'rival' || rel?.tag === 'grudge') return -RIVAL_REACTION;
  if (mate) return TIE_WEIGHT.clique;
  if (rel && rel.opinion >= 50) return TIE_WEIGHT.fan;
  return 0;
}

/**
 * Friends, lovers, sponsors and clique-mates of the target react to what
 * happened to them, in how they see the CEO and how loyal they stay.
 * Rivals react the opposite way.
 */
export function ripple(state: GameState, targetId: PersonId, opinionDelta: number, loyaltyDelta = 0): void {
  const t = person(state, targetId);
  const candidates = new Set<PersonId>(Object.keys(state.relations).filter((x) => state.relations[x][targetId]));
  for (const x of Object.keys(state.relations[targetId] ?? {})) candidates.add(x);
  if (t.cliqueId && state.cliques[t.cliqueId]) for (const x of state.cliques[t.cliqueId].memberIds) candidates.add(x);
  for (const x of candidates) {
    const m = state.people[x];
    if (!m || !isActive(m) || x === targetId || x === state.player.personId || isDirector(state, m)) continue;
    const w = tieWeight(state, x, targetId);
    if (w === 0) continue;
    const o = Math.round(opinionDelta * w);
    const l = Math.round(loyaltyDelta * w);
    if (o) adjustOpinion(state, x, state.player.personId, o);
    if (l) adjustLoyalty(state, x, l);
  }
}
