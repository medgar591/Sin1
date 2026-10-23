// Builds a new game: the company, its irregular org tree, every person in it,
// the board, relationships, cliques and secrets.
import type {
  Clique,
  DirectorAgenda,
  FunctionKind,
  GameSettings,
  GameState,
  Heritage,
  Industry,
  OrgUnit,
  Person,
  PersonId,
  Pronouns,
  RelTag,
  Role,
  SecretKind,
  Skills,
  Trait,
  UnitId,
  UnitKind,
} from './types';
import { addLog, addSecret, bossOf, fullName, newId, peopleUnder, placeAsMember, seatLead, unit, unitsUnder } from './org';
import { baseName, marketSalary, roleRank, salaryBand } from './roles';
import { issueAsks } from './asks';
import { clamp } from './util';
import { chance, gaussian, pick, randInt, random, shuffle, weightedPick } from './rng';
import {
  CLIQUE_AGENDAS,
  CLIQUE_NAMES,
  DIVISION_SUFFIXES,
  FIRST_NAMES,
  INDUSTRY_SUBDIVISION_NAMES,
  INDUSTRY_TEAM_FUNCTIONS,
  LAST_NAMES,
  SYNTH_DESIGNATIONS,
  TEAM_CODENAMES,
  UPLIFT_NAMES,
} from './data/names';

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

// ---------------------------------------------------------------- tuning

const START_CASH = 20_000_000;
const START_SHARE_PRICE = 40;
const SHARES_OUTSTANDING = 10_000_000;
const PLAYER_SHARE_FRACTION = 0.01;
const PLAYER_CASH = 2_000_000;

const HERITAGE_WEIGHTS: [Heritage, number][] = [
  ['human', 88],
  ['synth', 5],
  ['uplift', 4],
  ['green', 1.5],
  ['blighted', 1.5],
];
const PRONOUN_WEIGHTS: [Pronouns, number][] = [
  ['she', 45],
  ['he', 45],
  ['they', 10],
];

/** Monthly budget per head in a unit, on top of salaries. */
const BUDGET_PER_HEAD: [number, number] = [1_500, 3_000];
const MIN_UNIT_BUDGET = 10_000;
/** Chance a team is a big one with sub-teams. */
const SUBTEAM_PARENT_CHANCE = 0.3;
/** Opening division revenue as a multiple of its costs (the first month's books recalibrate it). */
const REVENUE_MARGIN: [number, number] = [1.25, 1.5];

const FRIEND_RATE = 0.08;
const LOVER_RATE = 0.012;
const GRUDGE_RATE = 0.03;
const RIVAL_RATE = 0.02;
const MENTOR_RATE = 0.07;
/** Base chance of a secret, scaled up by greed and guile. */
const SECRET_BASE = 0.03;
const SECRET_SCALE = 0.2;

// ---------------------------------------------------------------- people

interface RoleProfile {
  quality: number;
  ageMin: number;
  ageMax: number;
  ageMean: number;
  ageSd: number;
  ambition: number;
  /** Involvement = 100 * u^exp; lower exponent means more political. */
  involvementExp: number;
  /** Years of tenure possible at most, and a floor in months. */
  tenureCap: number;
  tenureFloor: number;
  /** Default title for someone who holds this role without a seat of their own. */
  title: string;
  manager: boolean;
}

const ROLE_PROFILE: Record<Role, RoleProfile> = {
  worker: { quality: 48, ageMin: 22, ageMax: 62, ageMean: 35, ageSd: 9, ambition: 30, involvementExp: 3.9, tenureCap: 20, tenureFloor: 1, title: 'Associate', manager: false },
  subteamLead: { quality: 52, ageMin: 26, ageMax: 62, ageMean: 40, ageSd: 8, ambition: 45, involvementExp: 3.2, tenureCap: 25, tenureFloor: 12, title: 'Sub-Team Lead', manager: true },
  teamLead: { quality: 56, ageMin: 28, ageMax: 64, ageMean: 43, ageSd: 8, ambition: 50, involvementExp: 3.0, tenureCap: 30, tenureFloor: 18, title: 'Team Lead', manager: true },
  subdivisionHead: { quality: 60, ageMin: 34, ageMax: 66, ageMean: 49, ageSd: 7, ambition: 62, involvementExp: 2.2, tenureCap: 35, tenureFloor: 36, title: 'Sub-Division Head', manager: true },
  divisionHead: { quality: 65, ageMin: 38, ageMax: 66, ageMean: 53, ageSd: 6, ambition: 68, involvementExp: 1.9, tenureCap: 38, tenureFloor: 60, title: 'Division Head', manager: true },
  officer: { quality: 68, ageMin: 40, ageMax: 66, ageMean: 54, ageSd: 6, ambition: 68, involvementExp: 1.8, tenureCap: 38, tenureFloor: 60, title: 'Officer', manager: true },
  ceo: { quality: 74, ageMin: 36, ageMax: 60, ageMean: 47, ageSd: 5, ambition: 80, involvementExp: 1, tenureCap: 0, tenureFloor: 0, title: 'Chief Executive Officer', manager: true },
  chair: { quality: 68, ageMin: 55, ageMax: 72, ageMean: 63, ageSd: 4, ambition: 55, involvementExp: 1.2, tenureCap: 30, tenureFloor: 60, title: 'Chair of the Board', manager: true },
  director: { quality: 64, ageMin: 48, ageMax: 72, ageMean: 60, ageSd: 5, ambition: 50, involvementExp: 1.4, tenureCap: 25, tenureFloor: 36, title: 'Director', manager: true },
};

const TRAITS: Trait[] = [
  'principled', 'paranoid', 'vain', 'ruthless', 'charming', 'diligent',
  'lazy', 'gossip', 'cautious', 'reckless', 'generous', 'petty',
];
const OPPOSED: [Trait, Trait][] = [
  ['diligent', 'lazy'],
  ['cautious', 'reckless'],
  ['generous', 'petty'],
  ['principled', 'ruthless'],
];

const num = (state: GameState, centre: number, spread: number): number =>
  Math.round(clamp(centre + gaussian(state) * spread));

function pickTraits(state: GameState): Trait[] {
  const roll = random(state);
  const count = roll < 0.35 ? 0 : roll < 0.75 ? 1 : 2;
  const out: Trait[] = [];
  while (out.length < count) {
    const t = pick(state, TRAITS);
    if (out.includes(t) || out.some((o) => OPPOSED.some(([a, b]) => (a === o && b === t) || (b === o && a === t)))) continue;
    out.push(t);
  }
  return out;
}

function makeName(state: GameState, heritage: Heritage): [string, string] {
  if (heritage === 'uplift') {
    // Uplifts take a single given name; the surname is their sponsor family's.
    return [pick(state, UPLIFT_NAMES), pick(state, LAST_NAMES)];
  }
  if (heritage === 'synth') {
    // Synths carry a designation plus serial number; the "surname" marks them.
    return [`${pick(state, SYNTH_DESIGNATIONS)}${randInt(state, 10, 999)}`, '(synth)'];
  }
  return [pick(state, FIRST_NAMES), pick(state, LAST_NAMES)];
}

/**
 * Creates a person and adds them to state.people, active but not yet placed
 * in any unit. Used by generation and by hiring.
 */
export function createPerson(state: GameState, opts: CreatePersonOptions): Person {
  const prof = ROLE_PROFILE[opts.role];
  const q = clamp((opts.quality ?? prof.quality) + gaussian(state) * 8, 5, 95);
  const heritage = opts.heritage ?? weightedPick(state, HERITAGE_WEIGHTS, (h) => h[1])[0];
  const pronouns = opts.pronouns ?? weightedPick(state, PRONOUN_WEIGHTS, (h) => h[1])[0];
  const [firstName, lastName] = makeName(state, heritage);
  const age = opts.age ?? Math.round(clamp(prof.ageMean + gaussian(state) * prof.ageSd, prof.ageMin, prof.ageMax));
  const traits = opts.traits ?? pickTraits(state);

  // Managers are usually decent at management, but some are not.
  let mgmt = num(state, q + (prof.manager ? 2 : -12), 15);
  if (prof.manager && chance(state, 0.12)) mgmt = clamp(mgmt - 25);
  let work = num(state, q, 8);
  if (traits.includes('diligent')) work = clamp(work + 4);
  if (traits.includes('lazy')) work = clamp(work - 4);
  const skills: Skills = {
    work,
    management: mgmt,
    operations: num(state, q - 5, 14),
    finance: num(state, q - 5, 14),
    guile: num(state, q - 8, 18),
    ...opts.skills,
  };

  const maxMonths = Math.max(0, Math.min(age - 21, prof.tenureCap)) * 12;
  const tenure = Math.max(Math.min(prof.tenureFloor, maxMonths), Math.round(random(state) * maxMonths));
  const [lo, hi] = salaryBand(opts.role, state.month);
  const salary = opts.salary ?? clamp(marketSalary(opts.role, q + gaussian(state) * 12, state.month), lo, hi);

  const person: Person = {
    id: newId(state, 'p'),
    firstName,
    lastName,
    pronouns,
    age,
    heritage,
    skills,
    loyalty: randInt(state, 30, 60),
    ambition: num(state, prof.ambition, 18),
    greed: num(state, 40, 20),
    involvement: Math.round(100 * Math.pow(random(state), prof.involvementExp)),
    traits,
    role: opts.role,
    title: prof.title,
    unitId: null,
    salary,
    satisfaction: randInt(state, 45, 80),
    performance: num(state, q, 8),
    stockOptions: 0,
    hiredMonth: -Math.max(1, tenure),
    status: 'active',
    leftMonth: null,
    fate: null,
    cliqueId: null,
    secrets: [],
    investigatedMonth: null,
    attentionUntil: null,
    attentionReason: null,
    history: [],
  };
  state.people[person.id] = person;
  return person;
}

// ---------------------------------------------------------------- units

const WORKER_TITLES: Record<Industry, string[]> = {
  Food: ['Process Technician', 'Food Scientist', 'Line Supervisor', 'Quality Analyst', 'Procurement Clerk', 'Packaging Engineer'],
  Pharma: ['Lab Technician', 'Research Associate', 'Clinical Coordinator', 'Regulatory Analyst', 'Chemist', 'Compound Technician'],
  Security: ['Patrol Officer', 'Threat Analyst', 'Armorer', 'Systems Guard', 'Surveillance Operator', 'Field Agent'],
  Cyberware: ['Implant Technician', 'Neural Engineer', 'Fabrication Technician', 'Firmware Developer', 'Calibration Specialist', 'Surgical Liaison'],
  Media: ['Producer', 'Editor', 'Content Analyst', 'Broadcast Engineer', 'Rights Coordinator', 'Writer'],
  Logistics: ['Dispatcher', 'Freight Coordinator', 'Route Planner', 'Warehouse Technician', 'Customs Analyst', 'Fleet Mechanic'],
  Finance: ['Analyst', 'Underwriter', 'Trader', 'Compliance Officer', 'Accountant', 'Risk Modeler'],
  Construction: ['Site Engineer', 'Structural Analyst', 'Surveyor', 'Crane Operator', 'Project Coordinator', 'Safety Inspector'],
  'Grid Services': ['Network Engineer', 'Grid Technician', 'Protocol Analyst', 'Support Specialist', 'Systems Administrator', 'Latency Engineer'],
  Manastelliate: ['Ritual Analyst', 'Field Researcher', 'Ward Technician', 'Mana Auditor', 'Archivist', 'Containment Technician'],
};

const FUNCTION_STAFF_TITLES: Record<FunctionKind, string[]> = {
  operations: ['Operations Analyst', 'Planning Coordinator', 'Facilities Manager', 'Program Manager'],
  finance: ['Financial Analyst', 'Controller', 'Treasury Analyst', 'Accounts Specialist'],
  security: ['Security Analyst', 'Investigator', 'Access Control Officer', 'Threat Assessor'],
  personnel: ['HR Partner', 'Recruiter', 'Compensation Analyst', 'Employee Relations Specialist'],
  legal: ['Corporate Counsel', 'Paralegal', 'Contracts Specialist', 'Compliance Attorney'],
};

const FUNCTION_TEAM_NAMES: Partial<Record<FunctionKind, string[]>> = {
  security: ['Internal Affairs', 'Counter-Intelligence', 'Site Protection', 'Executive Protection'],
  finance: ['Internal Audit', 'Treasury', 'Tax and Reporting', 'Investor Relations'],
};

const FUNCTION_DEFS: { kind: FunctionKind; unit: string; skill: keyof Skills }[] = [
  { kind: 'operations', unit: 'Operations', skill: 'operations' },
  { kind: 'finance', unit: 'Finance', skill: 'finance' },
  { kind: 'security', unit: 'Corporate Security', skill: 'guile' },
  { kind: 'personnel', unit: 'Personnel', skill: 'management' },
  { kind: 'legal', unit: 'Legal Affairs', skill: 'guile' },
];

/** How likely each function's officer is to be the one passed over for CEO. */
const ANTAGONIST_WEIGHT: Record<FunctionKind, number> = { operations: 5, finance: 3.5, security: 1.5, personnel: 1.5, legal: 1.5 };

const INDUSTRIES: Industry[] = [
  'Food', 'Pharma', 'Security', 'Cyberware', 'Media', 'Logistics', 'Finance', 'Construction', 'Grid Services', 'Manastelliate',
];

function newUnit(state: GameState, kind: UnitKind, parentId: UnitId | null, name: string): OrgUnit {
  const parent = parentId ? state.units[parentId] : null;
  const id = newId(state, 'u');
  const u: OrgUnit = {
    id,
    name,
    kind,
    parentId,
    childIds: [],
    leadId: null,
    memberIds: [],
    budget: 0,
    morale: randInt(state, 50, 75),
    output: 100,
    divisionId: kind === 'division' ? id : (parent?.divisionId ?? null),
    functionKind: null,
    investigatedMonth: null,
  };
  state.units[id] = u;
  parent?.childIds.push(id);
  return u;
}

const nameTaken = (state: GameState, name: string): boolean =>
  Object.values(state.units).some((u) => u.name === name);

function uniqueName(state: GameState, candidates: string[], fallbackBase: string): string {
  for (const c of shuffle(state, candidates)) if (!nameTaken(state, c)) return c;
  for (let n = 2; ; n++) {
    const c = `${fallbackBase} ${n}`;
    if (!nameTaken(state, c)) return c;
  }
}

function industryOf(state: GameState, u: OrgUnit): Industry | null {
  return u.divisionId ? (state.divisions[u.divisionId]?.industry ?? null) : null;
}

/** Picks a name for a new unit of a kind (team/subteam/subdivision) inside a division. */
export function unitName(state: GameState, kind: 'subdivision' | 'team' | 'subteam', parentId: UnitId): string {
  const parent = state.units[parentId];
  if (!parent) throw new Error(`no unit ${parentId}`);
  const industry = industryOf(state, parent);

  if (kind === 'subdivision') {
    const names = industry ? INDUSTRY_SUBDIVISION_NAMES[industry] : ['Special Projects'];
    return uniqueName(state, names, names[0]);
  }
  if (kind === 'subteam') {
    const base = baseName(parent.name);
    for (let n = 2 + parent.childIds.length; ; n++) {
      const c = `${base}-${n}`;
      if (!nameTaken(state, c)) return c;
    }
  }
  // Team: "Codename (Function)".
  const functions = industry
    ? INDUSTRY_TEAM_FUNCTIONS[industry]
    : (parent.functionKind && FUNCTION_TEAM_NAMES[parent.functionKind]) || ['Special Projects'];
  const fn = pick(state, functions);
  const usedCodes = new Set(Object.values(state.units).map((u) => baseName(u.name)));
  const free = TEAM_CODENAMES.filter((c) => !usedCodes.has(c));
  const code = free.length ? pick(state, free) : `${pick(state, TEAM_CODENAMES)} ${randInt(state, 2, 99)}`;
  return `${code} (${fn})`;
}

function workerTitle(state: GameState, p: Person, titles: string[]): string {
  const t = pick(state, titles);
  return p.age >= 42 && p.skills.work >= 50 && chance(state, 0.4) ? `Senior ${t}` : t;
}

function addWorkers(state: GameState, u: OrgUnit, n: number, titles: string[], quality = 47): void {
  for (let i = 0; i < n; i++) {
    const w = createPerson(state, { role: 'worker', quality });
    w.title = workerTitle(state, w, titles);
    placeAsMember(state, w.id, u.id);
  }
}

/** A team or sub-team of `size` people including its lead. */
function buildTeam(
  state: GameState,
  kind: 'team' | 'subteam',
  parentId: UnitId,
  size: number,
  titles: string[],
): OrgUnit {
  const u = newUnit(state, kind, parentId, unitName(state, kind, parentId));
  const lead = createPerson(state, { role: kind === 'team' ? 'teamLead' : 'subteamLead' });
  seatLead(state, u.id, lead.id);
  addWorkers(state, u, size - 1, titles);
  return u;
}

/** Builds one division and returns its unit. Total headcount equals `target`. */
function buildDivision(state: GameState, opsId: UnitId, industry: Industry, name: string, target: number): OrgUnit {
  const div = newUnit(state, 'division', opsId, name);
  const head = createPerson(state, { role: 'divisionHead' });
  seatLead(state, div.id, head.id);
  state.divisions[div.id] = {
    unitId: div.id,
    industry,
    revenue: 0,
    costs: 0,
    growth: Math.round((0.003 + random(state) * 0.007) * 10000) / 10000,
    market: Math.round((0.95 + random(state) * 0.1) * 100) / 100,
    scale: 0, // calibrated on the first month's books
  };
  const titles = WORKER_TITLES[industry];
  let count = 1;

  const subs: OrgUnit[] = [];
  const subCount = weightedPick(state, [0, 1, 2, 3], (n) => [2, 3, 3, 2][n]);
  for (let i = 0; i < subCount; i++) {
    const sub = newUnit(state, 'subdivision', div.id, unitName(state, 'subdivision', div.id));
    const sh = createPerson(state, { role: 'subdivisionHead' });
    seatLead(state, sub.id, sh.id);
    subs.push(sub);
    count++;
  }

  // A staffer or two working directly for the division head.
  const aides = chance(state, 0.5) ? randInt(state, 1, 2) : 0;
  addWorkers(state, div, aides, ['Executive Assistant', 'Chief of Staff', 'Business Analyst']);
  count += aides;

  const teams: OrgUnit[] = [];
  let made = 0;
  while (target - count >= 4) {
    const remaining = target - count;
    const container =
      made < subs.length
        ? subs[made]
        : weightedPick(state, [div, ...subs], (c) => (c === div ? 1.5 : 2));
    made++;
    const nsub = randInt(state, 2, 3);
    const subSizes = Array.from({ length: nsub }, () => randInt(state, 3, 6));
    const ownSize = randInt(state, 4, 7);
    const big = ownSize + subSizes.reduce((a, b) => a + b, 0);
    if (chance(state, SUBTEAM_PARENT_CHANCE) && big <= remaining) {
      const team = buildTeam(state, 'team', container.id, ownSize, titles);
      for (const s of subSizes) buildTeam(state, 'subteam', team.id, s, titles);
      teams.push(team);
      count += big;
    } else {
      let size = Math.min(remaining, randInt(state, 4, 10));
      if (remaining - size < 4) size = remaining; // avoid a tiny orphan team
      teams.push(buildTeam(state, 'team', container.id, size, titles));
      count += size;
    }
  }
  // Leftover people join existing teams.
  if (target - count > 0) {
    const host = teams.length ? pick(state, teams) : div;
    addWorkers(state, host, target - count, titles);
  }
  return div;
}

function buildFunctionUnit(state: GameState, rootId: UnitId, def: (typeof FUNCTION_DEFS)[number]): OrgUnit {
  const u = newUnit(state, 'function', rootId, def.unit);
  u.functionKind = def.kind;
  const officer = createPerson(state, { role: 'officer', skills: {} });
  officer.skills[def.skill] = clamp(officer.skills[def.skill] + 12);
  seatLead(state, u.id, officer.id);
  return u;
}

function staffFunction(state: GameState, u: OrgUnit): void {
  const fk = u.functionKind!;
  const staff =
    fk === 'operations' ? randInt(state, 2, 4)
    : fk === 'personnel' ? randInt(state, 2, 6)
    : fk === 'legal' ? randInt(state, 2, 5)
    : randInt(state, 2, 4);
  addWorkers(state, u, staff, FUNCTION_STAFF_TITLES[fk], 55);
  if (fk === 'security' || fk === 'finance') {
    const teams = fk === 'security' ? randInt(state, 1, 2) : chance(state, 0.4) ? 2 : 1;
    for (let i = 0; i < teams; i++) {
      const t = buildTeam(state, 'team', u.id, randInt(state, 3, fk === 'security' ? 6 : 5), FUNCTION_STAFF_TITLES[fk]);
      t.divisionId = null;
    }
  }
}

// ---------------------------------------------------------------- relations

/** Sets how `a` feels about `b`. Keeps an existing tag unless a new one is given. */
function link(state: GameState, a: PersonId, b: PersonId, opinion: number, tag: RelTag | null = null): void {
  if (a === b) return;
  const row = (state.relations[a] ??= {});
  const prev = row[b];
  row[b] = { opinion: Math.round(clamp(opinion, -100, 100)), tag: tag ?? prev?.tag ?? null };
}

const mutual = (state: GameState, a: PersonId, b: PersonId, lo: number, hi: number, tag: RelTag | null = null): void => {
  link(state, a, b, randInt(state, lo, hi), tag);
  link(state, b, a, randInt(state, lo, hi), tag);
};

function unitGroup(u: OrgUnit): PersonId[] {
  return u.leadId ? [u.leadId, ...u.memberIds] : [...u.memberIds];
}

function buildRelations(state: GameState, staff: Person[]): void {
  // Boss and reports.
  for (const p of staff) {
    const boss = bossOf(state, p.id);
    if (!boss) continue;
    link(state, p.id, boss, 12 + gaussian(state) * 18);
    link(state, boss, p.id, 10 + gaussian(state) * 16);
  }
  const units = Object.values(state.units);
  // Teammates know each other.
  for (const u of units) {
    const group = unitGroup(u);
    if (group.length < 2) continue;
    for (const a of group) {
      const k = Math.min(group.length - 1, randInt(state, 2, 4));
      for (const b of shuffle(state, group).slice(0, k + 1)) {
        if (a !== b && !state.relations[a]?.[b]) link(state, a, b, 6 + gaussian(state) * 16);
      }
    }
  }
  // Sibling leads know each other; some feud.
  for (const u of units) {
    const leads = u.childIds.map((c) => state.units[c].leadId).filter((x): x is PersonId => !!x);
    if (leads.length < 2) continue;
    for (const a of leads) {
      for (const b of shuffle(state, leads).slice(0, 2)) {
        if (a !== b && !state.relations[a]?.[b]) link(state, a, b, gaussian(state) * 18);
      }
    }
    const feudChance = u.kind === 'executive' ? 0.6 : 0.3;
    if (chance(state, feudChance)) {
      const [a, b] = shuffle(state, leads);
      mutual(state, a, b, -65, -35, 'rival');
    }
  }

  const n = staff.length;
  const nonPlayer = staff.filter((p) => p.id !== state.player.personId);
  const randomStaff = () => pick(state, nonPlayer);
  const pairs = (count: number, fn: (a: Person, b: Person) => void) => {
    for (let i = 0; i < count; i++) {
      const a = randomStaff();
      const b = randomStaff();
      if (a !== b) fn(a, b);
    }
  };
  pairs(Math.round(n * FRIEND_RATE), (a, b) => mutual(state, a.id, b.id, 30, 70, 'friend'));
  pairs(Math.round(n * LOVER_RATE), (a, b) => mutual(state, a.id, b.id, 60, 90, 'lover'));
  pairs(Math.round(n * RIVAL_RATE), (a, b) => mutual(state, a.id, b.id, -60, -25, 'rival'));
  pairs(Math.round(n * GRUDGE_RATE), (a, b) => link(state, a.id, b.id, randInt(state, -70, -30), 'grudge'));

  buildMentorships(state, nonPlayer);
}

function addMentorLink(state: GameState, mentor: Person, protege: Person): void {
  if (mentor.id === protege.id || bossOf(state, protege.id) === mentor.id) return;
  link(state, protege.id, mentor.id, randInt(state, 50, 90), 'mentor');
  link(state, mentor.id, protege.id, randInt(state, 35, 75), 'protege');
}

/**
 * Mentor links that skip levels: a worker whose protector is a sub-division or
 * division head. `tag` on a relation labels the target (protege->mentor is
 * 'mentor'; mentor->protege is 'protege').
 */
function buildMentorships(state: GameState, staff: Person[]): void {
  const mentors = staff.filter((p) => roleRank[p.role] >= roleRank.teamLead);
  const lowerThan = (m: Person, pool: Person[]) => pool.filter((p) => roleRank[p.role] <= roleRank[m.role] - 2);
  // Guarantee high-level patrons for people far below them.
  for (const m of mentors.filter((p) => p.role === 'subdivisionHead' || p.role === 'divisionHead')) {
    const subtree = state.people[m.id].unitId
      ? peopleUnder(state, m.unitId!).map((id) => state.people[id])
      : [];
    const pool = lowerThan(m, subtree);
    const count = m.role === 'divisionHead' ? randInt(state, 2, 4) : randInt(state, 1, 2);
    if (pool.length) for (let i = 0; i < count; i++) addMentorLink(state, m, pick(state, pool));
  }
  const extra = Math.round(staff.length * MENTOR_RATE);
  for (let i = 0; i < extra; i++) {
    const m = weightedPick(state, mentors, (p) => roleRank[p.role] ** 2);
    let pool = m.unitId && chance(state, 0.7) ? lowerThan(m, peopleUnder(state, m.unitId).map((id) => state.people[id])) : [];
    if (!pool.length) pool = lowerThan(m, staff);
    if (pool.length) addMentorLink(state, m, pick(state, pool));
  }
}

// ---------------------------------------------------------------- secrets

const SUBSTANCES = ['black-market stims', 'synthetic opioids', 'grid-dive dosing', 'gambling debts', 'illicit combat drugs'];
const PAST_LIVES = [
  'Served time under a different SIN before being hired.',
  'Was a paid informant for a rival corp before joining.',
  'Worked in a blighted-zone labor gang under another name.',
  'Left a previous employer after a fatal workplace incident.',
];
const FAKE_CREDS = [
  'Holds a degree that was never conferred.',
  'The professional certification on file is forged.',
  'Padded a decade of work history to get hired.',
];

function addRandomSecret(state: GameState, p: Person, others: Person[]): void {
  const kind = weightedPick<SecretKind>(
    state,
    ['embezzlement', 'affair', 'pastLife', 'rivalPayroll', 'addiction', 'fakeCredentials', 'coverUp'],
    (k) =>
      k === 'embezzlement' ? 1 + p.greed / 30
      : k === 'rivalPayroll' ? 1 + p.skills.guile / 50
      : k === 'affair' ? 2
      : 1.5,
  );
  const involved: PersonId[] = [];
  const other = (): Person => {
    for (let i = 0; i < 10; i++) {
      const o = pick(state, others);
      if (o.id !== p.id) return o;
    }
    return others.find((o) => o.id !== p.id)!;
  };
  let description: string;
  let severity: 1 | 2 | 3;
  switch (kind) {
    case 'embezzlement': {
      const amount = randInt(state, 8, 140) * 5_000;
      description = `Skimmed about ${Math.round(amount / 1000)}Kㄓ through padded vendor invoices.`;
      if (chance(state, 0.3)) {
        const o = other();
        involved.push(o.id);
        description += ` ${fullName(o)} signed off on them.`;
      }
      severity = amount > 300_000 ? 3 : 2;
      break;
    }
    case 'affair': {
      const o = other();
      involved.push(o.id);
      mutual(state, p.id, o.id, 55, 90, 'lover');
      description = `Is having an affair with ${fullName(o)}.`;
      severity = chance(state, 0.4) ? 2 : 1;
      break;
    }
    case 'pastLife':
      description = pick(state, PAST_LIVES);
      severity = randInt(state, 1, 3) as 1 | 2 | 3;
      break;
    case 'rivalPayroll':
      description = 'Takes a retainer from a rival corp for internal documents.';
      severity = chance(state, 0.5) ? 3 : 2;
      break;
    case 'addiction':
      description = `Is dependent on ${pick(state, SUBSTANCES)}.`;
      severity = chance(state, 0.6) ? 1 : 2;
      break;
    case 'fakeCredentials':
      description = pick(state, FAKE_CREDS);
      severity = 2;
      break;
    default: {
      const o = other();
      involved.push(o.id);
      description = `Buried a safety incident report with help from ${fullName(o)}.`;
      severity = chance(state, 0.5) ? 3 : 2;
    }
  }
  addSecret(state, p.id, { kind, description, severity, involvedIds: involved });
}

function assignSecrets(state: GameState, staff: Person[]): void {
  for (const p of staff) {
    if (p.id === state.player.personId) continue;
    const prob = SECRET_BASE + SECRET_SCALE * ((p.greed + p.skills.guile) / 200);
    if (chance(state, prob)) addRandomSecret(state, p, staff);
  }
}

// ---------------------------------------------------------------- cliques

function buildCliques(state: GameState, staff: Person[], antagonist: Person): void {
  const count = randInt(state, 3, 5);
  const seniors = staff.filter((p) => ['officer', 'divisionHead', 'subdivisionHead'].includes(p.role));
  const names = shuffle(state, CLIQUE_NAMES);
  const agendas = shuffle(state, CLIQUE_AGENDAS);
  const eligible = staff.filter((p) => p.id !== state.player.personId);

  for (let i = 0; i < count; i++) {
    const free = seniors.filter((p) => !p.cliqueId);
    if (!free.length) break;
    const leader = i === 0 && !antagonist.cliqueId ? antagonist : weightedPick(state, free, (p) => 10 + p.ambition);
    const clique: Clique = {
      id: newId(state, 'c'),
      name: names[i % names.length],
      leaderId: leader.id,
      memberIds: [leader.id],
      agenda: agendas[i % agendas.length],
      known: false,
      momentum: 0,
    };
    const want = randInt(state, 4, 15);
    const local = leader.unitId ? peopleUnder(state, leader.unitId).map((id) => state.people[id]) : [];
    let guard = 0;
    while (clique.memberIds.length < want && guard++ < 200) {
      const pool = local.length > 5 && chance(state, 0.45) ? local : eligible;
      const m = pick(state, pool);
      if (m.cliqueId || m.id === state.player.personId) continue;
      clique.memberIds.push(m.id);
    }
    for (const id of clique.memberIds) {
      const m = state.people[id];
      m.cliqueId = clique.id;
      if (id !== leader.id) {
        m.involvement = Math.max(m.involvement, randInt(state, 25, 55));
        link(state, id, leader.id, Math.max(state.relations[id]?.[leader.id]?.opinion ?? 0, randInt(state, 25, 60)));
        link(state, leader.id, id, Math.max(state.relations[leader.id]?.[id]?.opinion ?? 0, randInt(state, 15, 50)));
      }
    }
    state.cliques[clique.id] = clique;
  }
}

// ---------------------------------------------------------------- board

const AGENDAS: DirectorAgenda[] = ['growth', 'safety', 'dividends', 'reform', 'oldGuard'];

function buildBoard(state: GameState, officers: Person[], divisionHeads: Person[], antagonist: Person): void {
  const size = randInt(state, 5, 7);
  const agendas = shuffle(state, AGENDAS);
  const directors: Person[] = [];
  for (let i = 0; i < size; i++) {
    const d = createPerson(state, { role: i === 0 ? 'chair' : 'director' });
    d.title = i === 0 ? 'Chair of the Board' : pick(state, ['Director', 'Director', 'Independent Director']);
    directors.push(d);
    state.directors.push({ personId: d.id, agenda: i < agendas.length ? agendas[i] : pick(state, AGENDAS) });
  }
  // The antagonist's ally is also the board's skeptic about the new CEO.
  const ally = directors[randInt(state, 1, directors.length - 1)];
  const execs = [...officers, ...divisionHeads];
  for (const d of directors) {
    const skeptic = d === ally;
    link(state, d.id, state.player.personId, skeptic ? randInt(state, -25, -10) : randInt(state, d === directors[0] ? 10 : 0, 25));
    link(state, state.player.personId, d.id, randInt(state, 0, 20));
    for (const e of execs) {
      mutual(state, d.id, e.id, -10, 40);
    }
    // One or two executives each director is allied with.
    for (const e of shuffle(state, execs).slice(0, randInt(state, 1, 2))) {
      if (e !== antagonist) mutual(state, d.id, e.id, 50, 80, 'friend');
    }
  }
  mutual(state, ally.id, antagonist.id, 55, 75, 'friend');
}

// ---------------------------------------------------------------- generate

/** Generates a fresh game from a seed. Month 0, CEO just installed. */
export function generateGame(seed: number, opts: NewGameOptions): GameState {
  const settings: GameSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const state: GameState = {
    version: 1,
    seed,
    rngState: seed,
    month: 0,
    nextId: 1,
    settings,
    company: {
      name: opts.companyName,
      cash: START_CASH,
      sharePrice: START_SHARE_PRICE,
      sharesOutstanding: SHARES_OUTSTANDING,
      boardConfidence: 0,
      guidance: null,
      bonusPool: 0,
      history: [],
    },
    player: {
      personId: '',
      personalCash: PLAYER_CASH,
      shares: Math.round(SHARES_OUTSTANDING * PLAYER_SHARE_FRACTION),
      reputation: 50,
      attentionPerMonth: 3,
      attentionLeft: 3,
    },
    people: {},
    units: {},
    rootUnitId: '',
    divisions: {},
    relations: {},
    cliques: {},
    directors: [],
    inbox: [],
    incidents: [],
    log: [],
    promises: [],
    fixerJobs: [],
    boardMeetings: [],
    gameOver: null,
    unitChurn: {},
    macro: null,
    plots: {},
    unitSizes: {},
    seatVacantSince: {},
    asks: [],
    rivalId: null,
  };
  state.company.boardConfidence = randInt(state, 55, 65);

  // Executive office and the player.
  const root = newUnit(state, 'executive', null, 'Office of the CEO');
  state.rootUnitId = root.id;
  const ceo = createPerson(state, {
    role: 'ceo',
    pronouns: opts.playerPronouns,
    heritage: 'human',
    traits: [],
  });
  ceo.firstName = opts.playerFirstName;
  ceo.lastName = opts.playerLastName;
  ceo.loyalty = 100;
  ceo.hiredMonth = 0;
  ceo.salary = 1_200_000;
  ceo.secrets = [];
  seatLead(state, root.id, ceo.id);
  state.player.personId = ceo.id;

  const chief = createPerson(state, { role: 'worker', quality: 62 });
  chief.title = 'Chief of Staff';
  placeAsMember(state, chief.id, root.id);
  if (chance(state, 0.6)) {
    const assistant = createPerson(state, { role: 'worker', quality: 55 });
    assistant.title = 'Executive Assistant';
    placeAsMember(state, assistant.id, root.id);
  }

  // C-suite functions.
  const fnUnits = FUNCTION_DEFS.map((def) => buildFunctionUnit(state, root.id, def));
  for (const u of fnUnits) staffFunction(state, u);
  const ops = fnUnits[0];

  // Divisions sit under Operations.
  const industries = shuffle(state, INDUSTRIES).slice(0, settings.divisions);
  const divisionUnits: OrgUnit[] = industries.map((industry) => {
    const name = `${opts.companyName} ${pick(state, DIVISION_SUFFIXES[industry])}`;
    const target = randInt(state, settings.divisionSizeMin, settings.divisionSizeMax);
    return buildDivision(state, ops.id, industry, name, target);
  });

  // Budgets scale with the people directly in each unit.
  for (const u of Object.values(state.units)) {
    const direct = unitGroup(u).length;
    u.budget = Math.max(MIN_UNIT_BUDGET, direct * randInt(state, BUDGET_PER_HEAD[0], BUDGET_PER_HEAD[1]));
  }

  // Division finances follow from what the division costs to run.
  for (const d of divisionUnits) {
    const subtree = unitsUnder(state, d.id);
    const salaries = peopleUnder(state, d.id).reduce((s, id) => s + state.people[id].salary / 12, 0);
    const costs = Math.round(salaries + subtree.reduce((s, u) => s + u.budget, 0));
    const stats = state.divisions[d.id];
    stats.costs = costs;
    stats.revenue = Math.round(costs * (REVENUE_MARGIN[0] + random(state) * (REVENUE_MARGIN[1] - REVENUE_MARGIN[0])));
  }

  const staff = Object.values(state.people).filter((p) => p.unitId !== null);
  const officers = fnUnits.map((u) => state.people[u.leadId!]);
  const divisionHeads = divisionUnits.map((u) => state.people[u.leadId!]);

  // The antagonist: passed over for CEO. Hidden; nothing is logged.
  const antagonist = weightedPick(state, officers, (o) => ANTAGONIST_WEIGHT[unit(state, o.unitId!).functionKind!]);
  state.rivalId = antagonist.id;
  antagonist.ambition = randInt(state, 90, 98);
  antagonist.loyalty = randInt(state, 8, 20);
  antagonist.involvement = Math.max(antagonist.involvement, randInt(state, 70, 90));
  if (!antagonist.traits.includes('ruthless') && antagonist.traits.length < 2) antagonist.traits.push('ruthless');

  buildRelations(state, staff);
  link(state, antagonist.id, ceo.id, randInt(state, -60, -45), 'grudge');
  link(state, ceo.id, antagonist.id, randInt(state, 0, 15));

  buildBoard(state, officers, divisionHeads, antagonist);
  assignSecrets(state, staff);
  buildCliques(state, staff, antagonist);

  addLog(
    state,
    `${fullName(ceo)} takes over as CEO of ${opts.companyName}. The board expects growth.`,
    2,
    [ceo.id],
  );
  issueAsks(state);
  return state;
}
