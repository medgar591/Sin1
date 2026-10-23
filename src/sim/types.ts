// Shared data model for the simulation. Everything in GameState is plain JSON
// so a game can be saved, loaded and replayed from its seed.

export type PersonId = string;
export type UnitId = string;
export type CliqueId = string;

/** Month index: 0 is January 2090. */
export type Month = number;

export type Heritage = 'human' | 'green' | 'blighted' | 'uplift' | 'synth';

export type Pronouns = 'she' | 'he' | 'they';

export type Trait =
  | 'principled'
  | 'paranoid'
  | 'vain'
  | 'ruthless'
  | 'charming'
  | 'diligent'
  | 'lazy'
  | 'gossip'
  | 'cautious'
  | 'reckless'
  | 'generous'
  | 'petty';

/** All skills run 0–100; 50 is a competent professional. */
export interface Skills {
  /** How well they do their own job. For a manager, a big part of unit performance. */
  work: number;
  management: number;
  operations: number;
  finance: number;
  guile: number;
}

export type Role =
  | 'ceo'
  | 'chair'
  | 'director'
  | 'officer'
  | 'divisionHead'
  | 'subdivisionHead'
  | 'teamLead'
  | 'subteamLead'
  | 'worker';

export type PersonStatus =
  | 'active'
  | 'fired'
  | 'quit'
  | 'defected'
  | 'retired'
  | 'arrested'
  | 'dead';

export type SecretKind =
  | 'embezzlement'
  | 'affair'
  | 'pastLife'
  | 'rivalPayroll'
  | 'addiction'
  | 'fakeCredentials'
  | 'coverUp';

export interface Secret {
  id: string;
  kind: SecretKind;
  /** One-line description shown once revealed. */
  description: string;
  /** 1 = embarrassing, 2 = career-ending, 3 = criminal. */
  severity: 1 | 2 | 3;
  revealed: boolean;
  /** Other people the secret implicates (an affair partner, an accomplice). */
  involvedIds: PersonId[];
}

/** One entry in a person's life story, used for the epilogue. */
export interface LifeEvent {
  month: Month;
  /** Short machine-readable kind, e.g. 'hired', 'promoted', 'fired', 'raise'. */
  kind: string;
  /** Past-tense sentence about this person, e.g. "Promoted to lead Team Kestrel." */
  text: string;
  /** Signed effect on their life: +10 a big break, -10 ruined. */
  impact: number;
  /** True when the player's own decision caused it. */
  byPlayer: boolean;
}

export interface Person {
  id: PersonId;
  firstName: string;
  lastName: string;
  pronouns: Pronouns;
  age: number;
  heritage: Heritage;
  skills: Skills;
  /** Loyalty to the CEO, 0–100. */
  loyalty: number;
  /** 0–100. Drive to climb. */
  ambition: number;
  /** 0–100. How much money motivates them. */
  greed: number;
  /**
   * 0–100. How much they engage in office politics at all. Most people are
   * low: they do their job and only stir when something happens to them.
   */
  involvement: number;
  traits: Trait[];

  role: Role;
  /** Display title, e.g. "Chief Financial Officer", "Team Lead, Kestrel". */
  title: string;
  /** The unit they lead or belong to. Null for board members and former staff. */
  unitId: UnitId | null;
  /** Yearly salary in zuzu. */
  salary: number;
  /** 0–100. How happy they are with their job. */
  satisfaction: number;
  /** 0–100. Recent job performance, recomputed monthly. */
  performance: number;
  /** Shares of company stock granted as options. */
  stockOptions: number;
  hiredMonth: Month;

  status: PersonStatus;
  leftMonth: Month | null;
  /** Where they ended up after leaving, for the epilogue. */
  fate: string | null;

  cliqueId: CliqueId | null;
  secrets: Secret[];
  /** Month the player last had Security investigate them, if ever. */
  investigatedMonth: Month | null;
  /**
   * While month <= attentionUntil, the player can act on this person directly
   * without the skip-level loyalty penalty (scandal, breakthrough…).
   */
  attentionUntil: Month | null;
  attentionReason: string | null;

  history: LifeEvent[];
}

export type RelTag = 'mentor' | 'protege' | 'rival' | 'lover' | 'grudge' | 'friend';

/** How one person feels about another. Directional. */
export interface Relation {
  /** -100 hatred … +100 devotion. */
  opinion: number;
  tag: RelTag | null;
}

export type UnitKind =
  | 'executive'
  | 'function'
  | 'division'
  | 'subdivision'
  | 'team'
  | 'subteam';

export type FunctionKind = 'operations' | 'finance' | 'security' | 'personnel' | 'legal';

export type Industry =
  | 'Food'
  | 'Pharma'
  | 'Security'
  | 'Cyberware'
  | 'Media'
  | 'Logistics'
  | 'Finance'
  | 'Construction'
  | 'Grid Services'
  | 'Manastelliate';

export interface OrgUnit {
  id: UnitId;
  name: string;
  kind: UnitKind;
  parentId: UnitId | null;
  childIds: UnitId[];
  leadId: PersonId | null;
  /** People in this unit who don't lead it (workers, or staff in a function). */
  memberIds: PersonId[];
  /** Monthly operating budget in zuzu, on top of salaries. */
  budget: number;
  /** 0–100. */
  morale: number;
  /** Performance index, recomputed monthly. 100 is a healthy baseline. */
  output: number;
  /** The division this unit sits in, or null outside the divisions. */
  divisionId: UnitId | null;
  /** Set on C-suite function units. */
  functionKind: FunctionKind | null;
  /** Month the player last had Security investigate this unit, if ever. */
  investigatedMonth: Month | null;
}

export interface DivisionStats {
  unitId: UnitId;
  industry: Industry;
  /** Monthly revenue in zuzu, last month. */
  revenue: number;
  /** Monthly costs in zuzu (salaries + budgets), last month. */
  costs: number;
  /** Underlying monthly revenue growth rate, e.g. 0.01 for 1%. */
  growth: number;
  /** Market demand multiplier, drifts with news; 1 is normal. */
  market: number;
  /**
   * Monthly revenue at output 100 and market 1. Calibrated when the game is
   * generated, then compounds by `growth` every month.
   */
  scale: number;
}

export interface Clique {
  id: CliqueId;
  name: string;
  leaderId: PersonId;
  memberIds: PersonId[];
  /** What they want, in a sentence. */
  agenda: string;
  /** Revealed to the player through investigation. */
  known: boolean;
  /** Recent promotion wins (+) and passed-over losses (-) of its members; decays monthly. */
  momentum: number;
}

export type DirectorAgenda = 'growth' | 'safety' | 'dividends' | 'reform' | 'oldGuard';

export interface DirectorInfo {
  personId: PersonId;
  agenda: DirectorAgenda;
}

export interface MonthRecord {
  month: Month;
  cash: number;
  revenue: number;
  costs: number;
  profit: number;
  sharePrice: number;
  boardConfidence: number;
  headcount: number;
}

export interface Company {
  name: string;
  /** Zuzu on hand. */
  cash: number;
  sharePrice: number;
  sharesOutstanding: number;
  /** 0–100. Below ~30 the board starts moving against you. */
  boardConfidence: number;
  /** Quarterly profit target the player announced for the current quarter. */
  guidance: number | null;
  /** Bonus pool available at quarter end, in zuzu. */
  bonusPool: number;
  history: MonthRecord[];
}

export interface PlayerState {
  personId: PersonId;
  /** Personal fortune in zuzu. */
  personalCash: number;
  /** Shares the player personally owns. */
  shares: number;
  /** 0–100. How the wider company sees the CEO. */
  reputation: number;
  attentionPerMonth: number;
  attentionLeft: number;
}

export interface InboxOption {
  id: string;
  label: string;
  /** Short hint about the likely consequence. */
  hint?: string;
  /** Attention it costs to pick this option. Defaults to 0. */
  attention?: number;
}

/** What an inbox item's handler needs back when the player picks an option. */
export interface InboxData {
  /** raiseDemand: the raise asked for, as a fraction of salary. */
  ask?: number;
  /** poachOffer: the rival's yearly offer. */
  offer?: number;
  /** cliqueFormed: the faction. */
  cliqueId?: CliqueId;
  /** pitch: the secret the pitcher offers on their rival. */
  secretId?: string;
}

/** Handler key in the events registry: every incident kind, plus world events. */
export type InboxKind = IncidentKind | 'talentWave';

export interface InboxItem {
  id: string;
  month: Month;
  kind: InboxKind;
  title: string;
  body: string;
  subjectIds: PersonId[];
  unitId: UnitId | null;
  /** Who brings the matter to the CEO's office, if anyone in particular. */
  speakerId?: PersonId | null;
  /** What they say, in their own voice. */
  quote?: string;
  options: InboxOption[];
  /** Option chosen by the player, once resolved. */
  resolution: string | null;
  /** Unresolved items auto-resolve with their first option after this month. */
  expiresMonth: Month;
  data: InboxData;
}

/**
 * Something an NPC did or that happened to them this month which may need the
 * player's attention. npc.ts (and others) push these; events.ts turns the
 * ones worth a decision into inbox items and clears the queue each month.
 */
export type Incident = {
  /** Main actor first, then anyone else involved (target, rival, victim). */
  personIds: PersonId[];
  /** The unit it happened in; for seatVacancy, the empty seat. */
  unitId: UnitId | null;
} & (
  | { kind: 'raiseDemand'; pct: number }
  | { kind: 'promotionDemand' }
  /** A division or function seat (or any lead seat above the asker) is empty. */
  | { kind: 'seatVacancy' }
  | { kind: 'feud' }
  | { kind: 'scheme' }
  | { kind: 'leak'; detail: string }
  | { kind: 'embezzlement' }
  | { kind: 'breakthrough'; detail: string }
  | { kind: 'scandal' }
  | { kind: 'resignationThreat' }
  | { kind: 'poachOffer'; offer: number }
  | { kind: 'complaint' }
  | { kind: 'cliqueFormed'; cliqueId: CliqueId }
  | { kind: 'managerFiring' }
  /** A fixer job traced back to the company. */
  | { kind: 'fixerFallout'; what: string }
  /** Someone warns the CEO about a plot: informant, plotter, plot target. */
  | { kind: 'tipOff' }
  /** An ambitious manager asks the CEO to back them against a rival: pitcher, rival. */
  | { kind: 'pitch'; secretId: string | null }
);

export type IncidentKind = Incident['kind'];

export interface LogEntry {
  month: Month;
  text: string;
  /** 1 routine, 2 notable, 3 major. */
  importance: 1 | 2 | 3;
  personIds: PersonId[];
}

export type PromiseKind = 'promotion' | 'raise' | 'protection' | 'budget';

export interface PlayerPromise {
  id: string;
  personId: PersonId;
  kind: PromiseKind;
  madeMonth: Month;
  /** Must be kept by this month. */
  dueMonth: Month;
  detail: string;
  state: 'open' | 'kept' | 'broken';
  /** Hidden bookkeeping: salary, role rank or budget when the promise was made. */
  baseline: number;
}

export type FixerKind = 'materials' | 'specialHire' | 'dirt';

export interface FixerJob {
  id: string;
  kind: FixerKind;
  /** Division or unit that gets the materials or hire. */
  targetUnitId: UnitId | null;
  /** Person to dig up dirt on. */
  targetPersonId: PersonId | null;
  budget: number;
  /** Must leave no trace back to the company. Costs more, lower blowback. */
  clean: boolean;
  startedMonth: Month;
  resolveMonth: Month;
  state: 'pending' | 'success' | 'partial' | 'failed';
  report: string | null;
}

export type MotionKind = 'noConfidence' | 'replaceOfficer' | 'cutBudget' | 'commend';

export interface Motion {
  id: string;
  kind: MotionKind;
  proposerId: PersonId;
  /** Officer to replace, unit to cut, etc. */
  targetId: string | null;
  summary: string;
  votes: Record<PersonId, boolean>;
  passed: boolean;
}

export interface BoardMeeting {
  month: Month;
  motions: Motion[];
  /** How the directors' asks for the quarter just closed came out. */
  asks?: { directorId: PersonId; text: string; met: boolean }[];
  /** Short summary of how the quarter was received. */
  summary: string;
}

export type GameOverReason = 'ousted' | 'retired';

export interface GameOver {
  reason: GameOverReason;
  month: Month;
  score: number;
  summary: string;
}

export interface GameSettings {
  divisions: number;
  /** Approximate headcount per division. */
  divisionSizeMin: number;
  divisionSizeMax: number;
}

export interface GameState {
  version: 1;
  seed: number;
  /** Current RNG state; advance it only through rng.ts. */
  rngState: number;
  month: Month;
  /** Monotonic counter for generating ids. */
  nextId: number;
  settings: GameSettings;

  company: Company;
  player: PlayerState;

  people: Record<PersonId, Person>;
  units: Record<UnitId, OrgUnit>;
  rootUnitId: UnitId;
  divisions: Record<UnitId, DivisionStats>;
  /** relations[a][b] is how a feels about b. Sparse: only people who know each other. */
  relations: Record<PersonId, Record<PersonId, Relation>>;
  cliques: Record<CliqueId, Clique>;
  directors: DirectorInfo[];

  inbox: InboxItem[];
  /** Raised this month, consumed by events.ts. */
  incidents: Incident[];
  log: LogEntry[];
  promises: PlayerPromise[];
  fixerJobs: FixerJob[];
  boardMeetings: BoardMeeting[];

  gameOver: GameOver | null;

  /**
   * Recent leavers per unit (decays monthly); drags the unit's output while
   * the team re-forms.
   */
  unitChurn: Record<UnitId, number>;
  /**
   * The business cycle. depth > 0 is a downturn (demand sits that far below
   * normal until `until`), depth < 0 a boom. Null in normal times.
   */
  macro: MacroCycle | null;
  /** Campaigns by ambitious staff against their boss, keyed by the plotter. */
  plots: Record<PersonId, Plot>;
  /** The member headcount each unit is trying to keep; managers hire back up to it. */
  unitSizes: Record<UnitId, number>;
  /** Month each empty division or function seat first went vacant. */
  seatVacantSince: Record<UnitId, number>;
  /** What individual directors want delivered by the next board meeting. */
  asks: BoardAsk[];
  /** The officer who was passed over for the CEO's chair, if known (new games only). */
  rivalId?: PersonId | null;
  /**
   * The year (2089) the company ran under the predecessor CEO before the game
   * began (new games only). The player's score is measured from the handover.
   */
  prequel?: Prequel;
}

export interface Prequel {
  predecessorId: PersonId;
  /** Share price and headcount at the handover. */
  sharePrice: number;
  headcount: number;
  /** Profit the predecessor's last quarter delivered, and the guidance it was judged against. */
  profit: number;
  guidance: number | null;
  /** The month that closed that quarter. */
  quarterMonth: Month;
  /** Profit across the predecessor's four quarters, and the share price when the year opened (games from before the full-year prequel lack both). */
  yearProfit?: number;
  yearStartSharePrice?: number;
}

export type AskKind = 'revenueGrowth' | 'margin' | 'fillSeats' | 'costControl' | 'shakeUp' | 'noPurge';

/** A director's demand for the quarter: met or missed at the next board meeting. */
export interface BoardAsk {
  id: string;
  directorId: PersonId;
  kind: AskKind;
  /** What the director wants, in a sentence. */
  text: string;
  /** The number to reach (or, for limits, not exceed). */
  target: number;
  /** Last quarter's figure, for context. */
  baseline: number;
  madeMonth: Month;
  /** Judged at the board meeting held at the close of this month. */
  dueMonth: Month;
  state: 'open' | 'met' | 'missed';
}

export interface Plot {
  targetId: PersonId;
  /** 0–100. */
  progress: number;
  /** How many of the plot's milestones it has passed. */
  stage: number;
  /** True once the CEO has heard about it (a tip-off, a probe, a report). */
  known?: boolean;
}

export interface MacroCycle {
  depth: number;
  /** Month the cycle ends (demand is pulled back to normal afterwards). */
  until: Month;
}

/** A moment with a person: what they said back to the CEO. */
export interface Scene {
  speakerId: PersonId;
  line: string;
}

/** Result of a player action. Actions mutate state in place. */
export interface ActionResult {
  ok: boolean;
  message: string;
  /** Set when the action played out face to face. */
  scene?: Scene;
}
