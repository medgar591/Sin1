// Small hand-built fixtures for unit tests, so modules can be tested without
// the full generator. Not used by the game itself.
import type { GameState, OrgUnit, Person, Role, UnitKind } from './types';

export function emptyState(seed = 1): GameState {
  return {
    version: 1,
    seed,
    rngState: seed,
    month: 0,
    nextId: 1,
    settings: { divisions: 1, divisionSizeMin: 10, divisionSizeMax: 10 },
    company: {
      name: 'Testco',
      cash: 50_000_000,
      sharePrice: 100,
      sharesOutstanding: 10_000_000,
      boardConfidence: 60,
      guidance: null,
      bonusPool: 0,
      history: [],
    },
    player: { personId: '', personalCash: 1_000_000, shares: 100_000, reputation: 50, attentionPerMonth: 3, attentionLeft: 3 },
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
  };
}

export function makePerson(state: GameState, role: Role, overrides: Partial<Person> = {}): Person {
  const id = `p${state.nextId++}`;
  const p: Person = {
    id,
    firstName: 'Test',
    lastName: id,
    pronouns: 'they',
    age: 35,
    heritage: 'human',
    skills: { work: 50, management: 50, operations: 50, finance: 50, guile: 50 },
    loyalty: 50,
    ambition: 30,
    greed: 30,
    involvement: 20,
    traits: [],
    role,
    title: role,
    unitId: null,
    salary: 60_000,
    satisfaction: 60,
    performance: 50,
    stockOptions: 0,
    hiredMonth: -24,
    status: 'active',
    leftMonth: null,
    fate: null,
    cliqueId: null,
    secrets: [],
    investigatedMonth: null,
    attentionUntil: null,
    attentionReason: null,
    history: [],
    ...overrides,
  };
  state.people[id] = p;
  return p;
}

export function makeUnit(state: GameState, kind: UnitKind, parentId: string | null, overrides: Partial<OrgUnit> = {}): OrgUnit {
  const id = `u${state.nextId++}`;
  const u: OrgUnit = {
    id,
    name: `${kind} ${id}`,
    kind,
    parentId,
    childIds: [],
    leadId: null,
    memberIds: [],
    budget: 20_000,
    morale: 60,
    output: 100,
    divisionId: null,
    functionKind: null,
    investigatedMonth: null,
    ...overrides,
  };
  state.units[id] = u;
  if (parentId) state.units[parentId].childIds.push(id);
  return u;
}

/**
 * A tiny company: CEO, a CFO function, one division with a head, one team
 * with a lead and three workers, and three directors.
 */
export function smallCompany(seed = 1) {
  const state = emptyState(seed);
  const root = makeUnit(state, 'executive', null, { name: 'Office of the CEO' });
  state.rootUnitId = root.id;
  const ceo = makePerson(state, 'ceo', { unitId: root.id, loyalty: 100 });
  root.leadId = ceo.id;
  state.player.personId = ceo.id;

  const finance = makeUnit(state, 'function', root.id, { name: 'Finance', functionKind: 'finance' });
  const cfo = makePerson(state, 'officer', { unitId: finance.id, title: 'CFO' });
  finance.leadId = cfo.id;

  const division = makeUnit(state, 'division', root.id, { name: 'Division A' });
  division.divisionId = division.id;
  state.divisions[division.id] = { unitId: division.id, industry: 'Food', revenue: 3_000_000, costs: 2_500_000, growth: 0.01, market: 1 };
  const head = makePerson(state, 'divisionHead', { unitId: division.id });
  division.leadId = head.id;

  const team = makeUnit(state, 'team', division.id, { name: 'Team One', divisionId: division.id });
  const lead = makePerson(state, 'teamLead', { unitId: team.id });
  team.leadId = lead.id;
  const workers = [0, 1, 2].map(() => makePerson(state, 'worker', { unitId: team.id }));
  team.memberIds = workers.map((w) => w.id);

  const directors = [0, 1, 2].map((i) => makePerson(state, i === 0 ? 'chair' : 'director'));
  state.directors = directors.map((d, i) => ({ personId: d.id, agenda: (['growth', 'safety', 'dividends'] as const)[i] }));

  return { state, root, ceo, finance, cfo, division, head, team, lead, workers, directors };
}
