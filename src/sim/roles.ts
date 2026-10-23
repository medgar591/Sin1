// What each role and kind of unit means: seniority, titles, pay bands and the
// rules for which units may sit under which. Pure data and tiny functions;
// no game state is read here beyond the unit being named.
import type { FunctionKind, OrgUnit, Role, UnitKind } from './types';
import { clamp } from './util';

// ---------------------------------------------------------------- seniority

/**
 * Seniority of a role. Only the ordering and the gaps matter: every threshold
 * in the sim compares against this one scale.
 */
export const roleRank: Record<Role, number> = {
  worker: 0,
  subteamLead: 1,
  teamLead: 2,
  subdivisionHead: 3,
  divisionHead: 4,
  officer: 5,
  director: 6,
  chair: 6,
  ceo: 7,
};

export const roleForUnitKind: Record<UnitKind, Role> = {
  executive: 'ceo',
  function: 'officer',
  division: 'divisionHead',
  subdivision: 'subdivisionHead',
  team: 'teamLead',
  subteam: 'subteamLead',
};

// ---------------------------------------------------------------- unit kinds

export const isTeam = (u: OrgUnit): boolean => u.kind === 'team' || u.kind === 'subteam';

/** Which kinds of unit may sit directly under which parent kind. */
export const ALLOWED_PARENTS: Record<UnitKind, UnitKind[]> = {
  executive: [],
  function: ['executive'],
  division: ['executive', 'function'],
  subdivision: ['division', 'subdivision'],
  team: ['division', 'subdivision', 'function'],
  subteam: ['team', 'subteam'],
};

// ---------------------------------------------------------------- titles

const FUNCTION_TITLES: Record<FunctionKind, string> = {
  operations: 'Chief Operating Officer',
  finance: 'Chief Financial Officer',
  security: 'Head of Security',
  personnel: 'Head of Personnel',
  legal: 'General Counsel',
};

export const FUNCTION_KINDS = Object.keys(FUNCTION_TITLES) as FunctionKind[];

export const functionTitle = (kind: FunctionKind): string => FUNCTION_TITLES[kind];

/** A unit's name without its parenthesised function: "Kestrel (Freight)" is "Kestrel". */
export const baseName = (name: string): string => name.split(' (')[0];

/** The default title for whoever leads the unit. */
export function leadTitle(u: OrgUnit): string {
  switch (u.kind) {
    case 'executive':
      return 'Chief Executive Officer';
    case 'function':
      return (u.functionKind && FUNCTION_TITLES[u.functionKind]) || `Head of ${u.name}`;
    case 'division':
    case 'subdivision':
      return `Head of ${u.name}`;
    case 'team':
      return `Team Lead, ${baseName(u.name)}`;
    case 'subteam':
      return `Sub-team Lead, ${u.name}`;
  }
}

/** The default title for a plain member of the unit (workers usually keep a job title instead). */
export const memberTitle = (u: OrgUnit): string => `Staff, ${u.name}`;

/** True if the title is one of the unit's default seat titles rather than a job title or honorific. */
export const isSeatTitle = (title: string, u: OrgUnit): boolean => title === memberTitle(u) || title === leadTitle(u);

// ---------------------------------------------------------------- pay

/** Yearly salary bounds per role; skill places a person within them. */
const SALARY_RANGE: Record<Role, [number, number]> = {
  worker: [40_000, 90_000],
  subteamLead: [80_000, 120_000],
  teamLead: [95_000, 150_000],
  subdivisionHead: [160_000, 260_000],
  divisionHead: [300_000, 500_000],
  officer: [400_000, 700_000],
  ceo: [1_200_000, 1_200_000],
  chair: [250_000, 350_000],
  director: [150_000, 250_000],
};

/** Starting-scale salary bounds for a role. */
export const salaryRange = (role: Role): [number, number] => SALARY_RANGE[role];

/** Market salaries rise this much a year (the CEO's contract excepted). */
export const WAGE_INFLATION = 0.035;

/** Multiplier on the starting salary scale after `month` months of wage inflation. */
export function wageIndex(month: number): number {
  return Math.pow(1 + WAGE_INFLATION, Math.max(0, month) / 12);
}

/** The salary bounds for a role at `month`, with wage inflation applied. */
export function salaryBand(role: Role, month: number): [number, number] {
  const [lo, hi] = SALARY_RANGE[role];
  const idx = role === 'ceo' ? 1 : wageIndex(month);
  return [Math.round(lo * idx), Math.round(hi * idx)];
}

/** Typical yearly salary for a role and skill level, at `month` (default: the day the game starts). */
export function marketSalary(role: Role, quality: number, month = 0): number {
  const [lo, hi] = SALARY_RANGE[role];
  const idx = role === 'ceo' ? 1 : wageIndex(month);
  return Math.round(((lo + ((hi - lo) * clamp(quality)) / 100) * idx) / 500) * 500;
}
