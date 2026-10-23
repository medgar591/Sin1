// The end of a game: score, and the people whose lives the player changed most.
import type { GameOverReason, GameState, LifeEvent, Person, PersonId } from './types';
import { activeStaff, formatZuzu, fullName, monthLabel, person, playerPerson, pronoun } from './org';

export interface EpilogueEntry {
  personId: PersonId;
  name: string;
  /** Title they held when it mattered most, or at the end. */
  title: string;
  /** Sum of impacts from the player's own decisions. */
  impact: number;
  /** Events caused by the player, oldest first. */
  events: LifeEvent[];
  /** A short paragraph telling their story under the player, and where they ended up. */
  story: string;
}

// Score weights. A decent five-year run lands around 1,000–2,000 points.
const POINTS_PER_MONTH = 10;
const POINTS_PER_PRICE_PCT = 10; // per +1% on the share price
const PRICE_PENALTY_FLOOR = -500;
const FORTUNE_PER_POINT = 10_000; // zuzu of personal fortune per point
const POINTS_PER_HEAD = 5;
const OUSTED_MULTIPLIER = 0.4; // a golden parachute still beats a perp walk
const SCANDAL_MULTIPLIER = 0.1; // ousted with a revealed crime on file
const SCANDAL_FORTUNE_KEPT = 0.25; // most of it is frozen or clawed back

/** True if the player has a revealed secret that reads as a crime. */
function playerDisgraced(state: GameState): boolean {
  return playerPerson(state).secrets.some(
    (s) => s.revealed && (s.kind === 'coverUp' || s.kind === 'embezzlement'),
  );
}

function startPrice(state: GameState): number {
  return state.company.history[0]?.sharePrice ?? state.company.sharePrice;
}

function fortune(state: GameState): number {
  return state.player.personalCash + state.player.shares * state.company.sharePrice;
}

function scoreFor(state: GameState, reason: GameOverReason): number {
  const first = state.company.history[0];
  const startHeads = first?.headcount ?? activeStaff(state).length;
  const pricePct = (state.company.sharePrice / Math.max(0.01, startPrice(state)) - 1) * 100;
  const disgraced = reason === 'ousted' && playerDisgraced(state);

  const tenure = state.month * POINTS_PER_MONTH;
  const growth = Math.max(PRICE_PENALTY_FLOOR, pricePct * POINTS_PER_PRICE_PCT);
  const wealth = (fortune(state) * (disgraced ? SCANDAL_FORTUNE_KEPT : 1)) / FORTUNE_PER_POINT;
  const heads = (activeStaff(state).length - startHeads) * POINTS_PER_HEAD;

  let total = tenure + growth + wealth + heads;
  if (reason === 'ousted') total *= disgraced ? SCANDAL_MULTIPLIER : OUSTED_MULTIPLIER;
  return Math.max(0, Math.round(total));
}

export function computeScore(state: GameState): number {
  return scoreFor(state, state.gameOver?.reason ?? 'retired');
}

function summarize(state: GameState, reason: GameOverReason): string {
  const years = state.month / 12;
  const tenure = state.month >= 24 ? `${years.toFixed(1)} years` : `${state.month} months`;
  const start = startPrice(state);
  const now = state.company.sharePrice;
  const pct = Math.round((now / Math.max(0.01, start) - 1) * 100);
  const trend =
    pct >= 5 ? `Shares rose ${pct}% to ${now.toFixed(2)}`
    : pct <= -5 ? `Shares fell ${-pct}% to ${now.toFixed(2)}`
    : `Shares ended near where they started, at ${now.toFixed(2)}`;
  const first = `You ran ${state.company.name} for ${tenure}. ${trend}.`;
  if (reason === 'retired') {
    return `${first} You stepped down on your own terms in ${monthLabel(state.month)}, leaving with a fortune of ${formatZuzu(fortune(state))}.`;
  }
  if (playerDisgraced(state)) {
    return `${first} The board removed you in ${monthLabel(state.month)} after your own past came out. Prosecutors are interested, and most of your fortune is frozen.`;
  }
  return `${first} The board voted you out in ${monthLabel(state.month)}. You left with a parachute of ${formatZuzu(fortune(state))}, but not with your reputation.`;
}

/** Ends the game: sets state.gameOver with score and summary. */
export function endGame(state: GameState, reason: GameOverReason): void {
  if (state.gameOver) return;
  const score = scoreFor(state, reason);
  state.gameOver = { reason, month: state.month, score, summary: summarize(state, reason) };
  state.log.push({
    month: state.month,
    text: reason === 'retired' ? 'The CEO retired.' : 'The board ousted the CEO.',
    importance: 3,
    personIds: [state.player.personId],
  });
}

// ---- Epilogue ----

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function times(n: number): string {
  return n === 1 ? '' : n === 2 ? ' twice' : ` ${n} times`;
}

/** What the player did, by event kind, as a verb phrase about `obj`. */
const DEEDS: Record<string, (n: number, obj: string) => string> = {
  hired: (_n, obj) => `hired ${obj}`,
  promoted: (n, obj) => `promoted ${obj}${times(n)}`,
  demoted: (n, obj) => `demoted ${obj}${times(n)}`,
  fired: (_n, obj) => `fired ${obj}`,
  raise: (n, obj) => (n === 1 ? `raised ${obj} pay` : `raised ${obj} pay ${times(n).trim()}`),
  payCut: (_n, obj) => `cut ${obj} pay`,
  options: (_n, obj) => `gave ${obj} stock options`,
  passedOver: (n, obj) => `passed ${obj} over${times(n)}`,
  reassigned: (n, obj) => `moved ${obj} to another unit${times(n)}`,
  investigated: (_n, obj) => `had Security dig into ${obj}`,
  promiseKept: (_n, obj) => `kept a promise to ${obj}`,
  promiseBroken: (_n, obj) => `broke a promise to ${obj}`,
  unitMerged: (_n, obj) => `folded ${obj} unit into another`,
  unitDissolved: (_n, obj) => `dissolved ${obj} unit`,
  bonus: (_n, obj) => `paid ${obj} a bonus`,
  bonusSnub: (_n, obj) => `left ${obj} out of the bonus pool`,
  threatened: (_n, obj) => `threatened ${obj}`,
};

function deedSentence(p: Person, events: LifeEvent[]): string | null {
  const order: string[] = [];
  const counts: Record<string, number> = {};
  for (const e of events) {
    if (!DEEDS[e.kind]) continue;
    if (!(e.kind in counts)) order.push(e.kind);
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  }
  if (order.length === 0) return null;
  // Pay deeds read "raised her pay"; the rest take the object form ("hired her").
  const parts = order.map((k) => {
    const pay = k === 'raise' || k === 'payCut' || k === 'options' || k === 'bonus' || k === 'bonusSnub';
    const o = pay ? pronoun(p, 'possessive') : pronoun(p, 'object');
    return DEEDS[k](counts[k], k === 'unitMerged' || k === 'unitDissolved' ? pronoun(p, 'possessive') : o);
  });
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `You ${list}.`;
}

function endingSentence(state: GameState, p: Person): string {
  const subj = cap(pronoun(p, 'subject'));
  const be = p.pronouns === 'they' ? 'are' : 'is';
  if (p.status === 'active') {
    if (state.directors.some((d) => d.personId === p.id)) return `${subj} ${be} still on the board.`;
    return `${subj} ${be} still with the company as ${p.title}.`;
  }
  if (p.fate) return `${p.fate.replace(/\.$/, '')}.`;
  const how: Record<string, string> = {
    fired: 'was let go',
    quit: 'quit',
    defected: 'defected to a rival corp',
    retired: 'retired',
    arrested: 'was arrested',
    dead: 'died',
  };
  const verb = p.pronouns === 'they' ? (how[p.status] ?? 'left').replace(/^was /, 'were ') : (how[p.status] ?? 'left');
  return `${subj} ${verb}${p.leftMonth !== null ? ` in ${monthLabel(p.leftMonth)}` : ''}.`;
}

function buildStory(state: GameState, p: Person, events: LifeEvent[]): string {
  const sentences: string[] = [];
  const deeds = deedSentence(p, events);
  if (deeds) sentences.push(deeds);
  if (events.length > 1 || !deeds) {
    const top = events.reduce((a, b) => (Math.abs(b.impact) > Math.abs(a.impact) ? b : a));
    sentences.push(`The defining moment came in ${monthLabel(top.month)}: ${lowerFirst(top.text)}`);
  }
  sentences.push(endingSentence(state, p));
  return sentences.join(' ');
}

/** Up to `limit` people the player affected most, split between helped and harmed. */
export function buildEpilogue(state: GameState, limit = 8): { helped: EpilogueEntry[]; harmed: EpilogueEntry[] } {
  const entries: EpilogueEntry[] = [];
  for (const p of Object.values(state.people)) {
    if (p.id === state.player.personId) continue;
    const events = p.history.filter((e) => e.byPlayer);
    const impact = events.reduce((sum, e) => sum + e.impact, 0);
    if (events.length === 0 || impact === 0) continue;
    person(state, p.id);
    entries.push({
      personId: p.id,
      name: fullName(p),
      title: p.title,
      impact,
      events: events.slice().sort((a, b) => a.month - b.month),
      story: buildStory(state, p, events),
    });
  }
  const helped = entries.filter((e) => e.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, limit);
  const harmed = entries.filter((e) => e.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, limit);
  return { helped, harmed };
}
