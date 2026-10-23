import type { GameState, PlayerPromise } from './types';
import { roleRank } from './roles';

/** Shape of saves written before the sim's bookkeeping became typed GameState fields. */
type OldState = GameState & {
  npcPlots?: GameState['plots'];
  npcUnitSizes?: GameState['unitSizes'];
  npcSeatVacant?: GameState['seatVacantSince'];
};
type OldDivision = GameState['divisions'][string] & { baseRevenue?: number; growthIndex?: number };
type OldData = Record<string, unknown>;

/** Fills or renames fields added since older saves were written. Mutates and returns the state. */
export function migrateState(state: GameState): GameState {
  const s = state as OldState;
  s.unitChurn ??= {};
  s.macro ??= null;
  s.plots ??= s.npcPlots ?? {};
  s.unitSizes ??= s.npcUnitSizes ?? {};
  s.seatVacantSince ??= s.npcSeatVacant ?? {};
  delete s.npcPlots;
  delete s.npcUnitSizes;
  delete s.npcSeatVacant;

  for (const c of Object.values(s.cliques)) c.momentum ??= 0;

  for (const d of Object.values(s.divisions) as OldDivision[]) {
    if (d.scale === undefined) {
      // Revenue used to be baseRevenue × growthIndex; without either, back it out of last month.
      const out = s.units[d.unitId]?.output ?? 100;
      d.scale = d.baseRevenue !== undefined
        ? d.baseRevenue * (d.growthIndex ?? 1)
        : d.revenue / Math.max(0.01, (out / 100) * d.market);
    }
    delete d.baseRevenue;
    delete d.growthIndex;
  }

  for (const pr of s.promises as (PlayerPromise & { baseline?: number })[]) {
    if (pr.baseline !== undefined) continue;
    const p = s.people[pr.personId];
    pr.baseline = !p ? 0
      : pr.kind === 'raise' ? p.salary
      : pr.kind === 'promotion' ? roleRank[p.role]
      : pr.kind === 'budget' && p.unitId ? (s.units[p.unitId]?.budget ?? 0)
      : 0;
  }

  for (const item of s.inbox) {
    const data = item.data as OldData;
    // World-news hires used to carry their division in data rather than unitId.
    if (item.kind === 'talentWave' && item.unitId === null && typeof data.divisionId === 'string') item.unitId = data.divisionId;
  }

  // Incidents used to keep their details in a free-form `data` bag; lift them onto the incident.
  s.incidents = s.incidents.map((inc) => {
    const { data, ...rest } = inc as typeof inc & { data?: OldData };
    if (!data) return inc;
    const out = { ...rest } as Record<string, unknown>;
    for (const key of ['pct', 'offer', 'detail', 'what', 'cliqueId']) if (data[key] !== undefined) out[key] = data[key];
    if (out.kind === 'promotionDemand' && typeof data.vacantUnitId === 'string') {
      out.kind = 'seatVacancy';
      out.unitId = data.vacantUnitId;
    }
    if (data.source === 'fixer') out.kind = 'fixerFallout';
    if (out.kind === 'raiseDemand') out.pct ??= 0.15;
    if (out.kind === 'leak' || out.kind === 'breakthrough') out.detail ??= '';
    if (out.kind === 'fixerFallout') out.what ??= 'A fixer job went wrong and the trail leads to the company.';
    return out as unknown as typeof inc;
  }).filter((inc) =>
    (inc.kind !== 'cliqueFormed' || typeof inc.cliqueId === 'string') && (inc.kind !== 'poachOffer' || typeof inc.offer === 'number'));
  return s;
}
