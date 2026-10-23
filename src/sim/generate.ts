// Builds a new game: the company, its irregular org tree, every person in it,
// the board, relationships, cliques and secrets.
import type { GameSettings, GameState, Heritage, Person, Pronouns, Role, Skills, Trait, UnitId } from './types';

export interface NewGameOptions {
  companyName: string;
  playerFirstName: string;
  playerLastName: string;
  playerPronouns: Pronouns;
  settings?: Partial<GameSettings>;
}

export const DEFAULT_SETTINGS: GameSettings = {
  divisions: 3,
  divisionSizeMin: 100,
  divisionSizeMax: 150,
};

export interface CreatePersonOptions {
  role: Role;
  /** Skill centre; individual skills vary around it. 50 is competent. */
  quality?: number;
  age?: number;
  heritage?: Heritage;
  pronouns?: Pronouns;
  traits?: Trait[];
  skills?: Partial<Skills>;
  salary?: number;
}

/**
 * Creates a person and adds them to state.people, active but not yet placed
 * in any unit. Used by generation and by hiring.
 */
export function createPerson(_state: GameState, _opts: CreatePersonOptions): Person {
  throw new Error('createPerson: not implemented');
}

/** Typical yearly salary for a role and skill level. */
export function marketSalary(_role: Role, _quality: number): number {
  throw new Error('marketSalary: not implemented');
}

/** Generates a fresh game from a seed. Month 0, CEO just installed. */
export function generateGame(_seed: number, _opts: NewGameOptions): GameState {
  throw new Error('generateGame: not implemented');
}

/** Picks a name for a new unit of a kind (team/subteam/subdivision) inside a division. */
export function unitName(_state: GameState, _kind: 'subdivision' | 'team' | 'subteam', _parentId: UnitId): string {
  throw new Error('unitName: not implemented');
}
