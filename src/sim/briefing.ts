// The opening briefing: the personal secretary's welcome on day one. A long-
// serving, discreet hand who kept the predecessor's diary tells the new CEO
// who sits on the board, who runs what, who to watch, and what the job is,
// using the live state so every game opens a little differently.
import type { GameState, Person, PersonId } from './types';
import { AGENDA_PLAIN } from './asks';
import {
  activeDirectors,
  activeStaff,
  formatZuzu,
  fullName,
  functionHead,
  isActive,
  pronoun,
  playerPerson,
  quarterLabel,
  secretary,
} from './org';
import { boardExpectation } from './economy';
import { NO_CONFIDENCE_LEVEL } from './board';
import { capitalize } from './util';

export interface Briefing {
  /** Who is speaking: the personal secretary, or nobody if the CEO's office is empty. */
  speakerId: PersonId | null;
  paragraphs: string[];
}

/** "a, b and c". */
function list(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** "1 year", "11 years". */
const yearsOf = (n: number): string => `${n} year${n === 1 ? '' : 's'}`;

/** Service longer than this many months counts as long-serving. */
const VETERAN_MONTHS = 60;

const nameAndTitle = (p: Person): string => `${fullName(p)}, ${p.title}`;
const inList = (p: Person): string => `${fullName(p)} (${p.title})`;

export function openingBriefing(state: GameState): Briefing {
  const ceo = playerPerson(state);
  const sec = secretary(state);
  const pre = state.prequel;
  const predecessor = pre ? state.people[pre.predecessorId] : undefined;
  const out: string[] = [];

  // 1. Greeting. The secretary has served the chair for years, and now serves its new holder.
  if (!sec) {
    out.push(`Good morning, ${ceo.firstName}. Your outer office is empty, so there is no one to brief you; this is what such a briefing would say.`);
  } else if (predecessor) {
    const served = Math.max(1, Math.floor((state.month - sec.hiredMonth) / 12));
    out.push(
      `Good morning, ${ceo.firstName}. I'm ${fullName(sec)}. I kept ${fullName(predecessor)}'s diary for ${yearsOf(served)}, and now I keep yours. Before your first meeting, there are a few things you should know.`,
    );
  } else {
    out.push(`Good morning, ${ceo.firstName}. I'm ${fullName(sec)}, your ${sec.title.toLowerCase()}. Before your first meeting, there are a few things you should know.`);
  }

  // 2. The predecessor and the year they leave behind, if the game began with one.
  if (pre && predecessor) {
    const years = Math.floor(-predecessor.hiredMonth / 12);
    const result =
      pre.guidance === null
        ? 'with no guidance given'
        : `against guidance of ${formatZuzu(pre.guidance)}, ${pre.profit >= pre.guidance ? 'beating' : 'missing'} it`;
    const bar = boardExpectation(state);
    let past = `${fullName(predecessor)} ran the company for ${yearsOf(years)} and retired at the end of December.`;
    if (pre.yearProfit !== undefined && pre.yearStartSharePrice !== undefined) {
      past += ` In 2089 it made ${formatZuzu(pre.yearProfit)} across four quarters, and the share price went from ${formatZuzu(pre.yearStartSharePrice)} to ${formatZuzu(pre.sharePrice)}. The last quarter (${quarterLabel(pre.quarterMonth)}) closed at ${formatZuzu(pre.profit)} ${result}.`;
    } else {
      past += ` Last quarter (${quarterLabel(pre.quarterMonth)}) the company made ${formatZuzu(pre.profit)} ${result}.`;
    }
    past += bar !== null
      ? ` The board now expects at least ${formatZuzu(bar)} a quarter; that is the bar it holds you to.`
      : ' That is the bar the board holds you to.';
    if (state.company.bonusPool > 0) {
      past += ` The quarter's bonus pool, ${formatZuzu(state.company.bonusPool)}, was left unallocated. It is yours to divide, and people are watching how.`;
    }
    // Longer context: most of the floor has known the old chair far longer than the new one.
    const staff = activeStaff(state);
    const veterans = staff.filter((p) => state.month - p.hiredMonth > VETERAN_MONTHS).length;
    if (staff.length > 0 && veterans * 2 >= staff.length) {
      past += ` Most of the company predates you: ${veterans} of its ${staff.length} people have been here more than five years, and they will measure you against what they knew.`;
    }
    out.push(past);
  }

  // 3. The board.
  const dirs = activeDirectors(state);
  const chair = dirs.find((d) => d.role === 'chair') ?? dirs[0];
  if (chair) {
    const agenda = state.directors.find((d) => d.personId === chair.id)?.agenda;
    const others = dirs.length - 1;
    out.push(
      `The board has ${dirs.length} seat${dirs.length === 1 ? '' : 's'}. It is chaired by ${fullName(chair)}${agenda ? `, who ${AGENDA_PLAIN[agenda]}` : ''}.${others > 0 ? ` The ${others === 1 ? 'other director wants' : `other ${others} directors want`} something different, and you will not please them all.` : ''} Board confidence stands at ${Math.round(state.company.boardConfidence)} out of 100. Below ${NO_CONFIDENCE_LEVEL}, they start counting votes${sec ? ', and I would rather you never hear them count' : ''}.`,
    );
  }

  // 4. Structure.
  const fnHeads = Object.values(state.units)
    .filter((u) => u.functionKind && u.functionKind !== 'operations')
    .map((u) => (u.leadId ? state.people[u.leadId] : undefined))
    .filter((p): p is Person => !!p && isActive(p));
  const coo = functionHead(state, 'operations');
  const divisionNames = Object.keys(state.divisions)
    .map((id) => state.units[id]?.name)
    .filter((n): n is string => !!n);
  let structure = 'Your officers run the corporate functions and report directly to you.';
  if (fnHeads.length) structure += ` They are ${list(fnHeads.map(inList))}.`;
  if (coo && divisionNames.length) {
    structure += ` ${nameAndTitle(coo)}, also oversees all ${divisionNames.length} division${divisionNames.length === 1 ? '' : 's'}: ${list(divisionNames)}. That is why the COO is the most powerful officer in the company, and why you should always know what ${pronoun(coo, 'subject')} ${coo.pronouns === 'they' ? 'want' : 'wants'}.`;
  } else if (divisionNames.length) {
    structure += ` The divisions are ${list(divisionNames)}, and with no one overseeing Operations they answer to you.`;
  }
  out.push(structure);

  // 5. The rival.
  const rival = state.rivalId ? state.people[state.rivalId] : undefined;
  if (rival && isActive(rival)) {
    out.push(
      `The board's other candidate for your chair was ${nameAndTitle(rival)}. ${capitalize(pronoun(rival, 'subject'))} took the news quietly. Too quietly.${sec ? ` I would not turn my back on ${pronoun(rival, 'object')}.` : ''}`,
    );
  }

  // 6. The job.
  const asks = (state.asks ?? []).filter((a) => a.state === 'open');
  let job = 'The job is simple to say. Grow profit every quarter, and beat the guidance you announce: the market and the board both remember a miss.';
  const named = asks
    .map((a) => ({ a, d: state.people[a.directorId] }))
    .filter((x): x is { a: (typeof asks)[number]; d: Person } => !!x.d);
  if (named.length) {
    job += ` This quarter, ${named.length === 1 ? 'one director has' : 'two directors have'} made ${named.length === 1 ? 'a demand' : 'demands'} of you. ${named.map(({ a, d }) => `${fullName(d)}: ${a.text}`).join(' ')} Meet them and the board will remember. Miss them and it will remember that too.`;
  }
  out.push(job);

  // 7. Time.
  out.push(
    `You have ${state.player.attentionPerMonth} attention a month, and it is the one thing in this company ${sec ? 'I cannot arrange for you' : 'that cannot be bought'}. Spend it on people: the ones who run things, the ones who are unhappy, the ones who are quietly ambitious. Numbers follow people, not the other way round.`,
  );

  // 8. Discretion: the secretary sits outside the door and hears things first.
  if (sec) {
    out.push(
      'I will be at the desk outside your door. What is said in this office stays in it, and when something needs you, you will hear it from me before you hear it from anyone else.',
    );
  }

  return { speakerId: sec ? sec.id : null, paragraphs: out };
}
