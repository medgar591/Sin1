// Everything the player can do on their turn. Each action checks and spends
// attention, applies the skip-level penalty when the player goes around the
// people who should handle it, records life events, and returns a result.
import type { ActionResult, FunctionKind, GameState, PersonId, PromiseKind, UnitId, UnitKind } from './types';

export const ATTENTION_COST = {
  hire: 1,
  fire: 1,
  promote: 1,
  demote: 1,
  reassign: 1,
  setSalary: 0,
  grantOptions: 0,
  setBudget: 0,
  restructure: 1,
  meet: 1,
  investigatePerson: 1,
  investigateUnit: 1,
  lobbyDirector: 1,
  fixer: 1,
  setGuidance: 0,
  allocateBonus: 0,
} as const;

export interface SkipLevelInfo {
  /** Managers between the player's direct report and the target who get bypassed. */
  bypassed: PersonId[];
  /** Loyalty each bypassed manager would lose. 0 if waived or not skipping. */
  penalty: number;
  /** True if the target currently has the player's attention (scandal, breakthrough). */
  waived: boolean;
}

/** Who the player goes around by acting directly on this person. */
export function skipLevelInfo(_state: GameState, _targetId: PersonId): SkipLevelInfo {
  throw new Error('skipLevelInfo: not implemented');
}

export type HireTier = 'cheap' | 'standard' | 'premium';

/** Hires a new person into a unit, as its lead (if the seat is empty) or as a member. */
export function hire(_state: GameState, _unitId: UnitId, _asLead: boolean, _tier: HireTier): ActionResult {
  throw new Error('hire: not implemented');
}

export function fire(_state: GameState, _personId: PersonId): ActionResult {
  throw new Error('fire: not implemented');
}

/** Makes the person lead of the unit. A sitting lead is moved down to a member of it. */
export function promote(_state: GameState, _personId: PersonId, _unitId: UnitId): ActionResult {
  throw new Error('promote: not implemented');
}

/** Removes a lead from their seat, leaving them as a member of the same unit. */
export function demote(_state: GameState, _personId: PersonId): ActionResult {
  throw new Error('demote: not implemented');
}

/** Moves a non-lead person into another unit as a member. */
export function reassign(_state: GameState, _personId: PersonId, _unitId: UnitId): ActionResult {
  throw new Error('reassign: not implemented');
}

export function setSalary(_state: GameState, _personId: PersonId, _salary: number): ActionResult {
  throw new Error('setSalary: not implemented');
}

export function grantOptions(_state: GameState, _personId: PersonId, _shares: number): ActionResult {
  throw new Error('grantOptions: not implemented');
}

/** Splits the quarter's bonus pool. Amounts in zuzu; unallocated money returns to cash. */
export function allocateBonus(_state: GameState, _allocations: Record<PersonId, number>): ActionResult {
  throw new Error('allocateBonus: not implemented');
}

export function setBudget(_state: GameState, _unitId: UnitId, _budget: number): ActionResult {
  throw new Error('setBudget: not implemented');
}

export function moveUnit(_state: GameState, _unitId: UnitId, _newParentId: UnitId): ActionResult {
  throw new Error('moveUnit: not implemented');
}

/** Folds `absorbId` into `keepId`: members and child units move over, its lead becomes a member. */
export function mergeUnits(_state: GameState, _keepId: UnitId, _absorbId: UnitId): ActionResult {
  throw new Error('mergeUnits: not implemented');
}

/** Creates an empty unit under a parent. */
export function createUnit(
  _state: GameState,
  _parentId: UnitId,
  _kind: Exclude<UnitKind, 'executive' | 'function'> | 'function',
  _name: string,
  _functionKind?: FunctionKind,
): ActionResult {
  throw new Error('createUnit: not implemented');
}

/** Removes a unit; its people and child units move up to its parent. */
export function dissolveUnit(_state: GameState, _unitId: UnitId): ActionResult {
  throw new Error('dissolveUnit: not implemented');
}

export type MeetingApproach = 'rapport' | 'promise' | 'threaten' | 'probe';

export interface MeetingPromise {
  kind: PromiseKind;
  detail: string;
  /** Months the player has to keep it. */
  months: number;
}

export function meet(
  _state: GameState,
  _personId: PersonId,
  _approach: MeetingApproach,
  _promise?: MeetingPromise,
): ActionResult {
  throw new Error('meet: not implemented');
}

/** Security digs into a person: reveals some of their secrets and relationships. */
export function investigatePerson(_state: GameState, _personId: PersonId): ActionResult {
  throw new Error('investigatePerson: not implemented');
}

/** Security digs into a unit: reveals feuds, cliques and who really does the work there. */
export function investigateUnit(_state: GameState, _unitId: UnitId): ActionResult {
  throw new Error('investigateUnit: not implemented');
}

export type LobbyApproach = 'persuade' | 'favor' | 'pressure';

export function lobbyDirector(_state: GameState, _directorId: PersonId, _approach: LobbyApproach): ActionResult {
  throw new Error('lobbyDirector: not implemented');
}

/** Announces profit guidance for the current quarter. Only once per quarter. */
export function setGuidance(_state: GameState, _amount: number): ActionResult {
  throw new Error('setGuidance: not implemented');
}

/** Marks promises kept or broken as their due month passes, with consequences. Run monthly. */
export function checkPromises(_state: GameState): void {
  throw new Error('checkPromises: not implemented');
}
