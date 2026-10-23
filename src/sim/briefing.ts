// The opening briefing: the Chief of Staff's welcome on day one. It tells the
// new CEO who sits on the board, who runs what, who to watch, and what the job
// is, using the live state so every game opens a little differently.
import type { GameState, Person, PersonId } from './types';
import { AGENDA_PLAIN } from './asks';
import {
  activeDirectors,
  chiefOfStaff,
  formatZuzu,
  fullName,
  functionHead,
  isActive,
  pronoun,
  playerPerson,
  quarterLabel,
} from './org';
import { boardExpectation } from './economy';
import { NO_CONFIDENCE_LEVEL } from './board';
import { capitalize } from './util';

export interface Briefing {
  /** Who is speaking: the chief of staff, or nobody if the CEO's office is empty. */
  speakerId: PersonId | null;
  paragraphs: string[];
}

/** "a, b and c". */
function list(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const nameAndTitle = (p: Person): string => `${fullName(p)}, ${p.title}`;
const inList = (p: Person): string => `${fullName(p)} (${p.title})`;

export function openingBriefing(state: GameState): Briefing {
  const ceo = playerPerson(state);
  const cos = chiefOfStaff(state);
  const out: string[] = [];

  // 1. Greeting.
  out.push(
    cos
      ? `Welcome, ${ceo.firstName}. I am ${fullName(cos)}, your ${cos.title.toLowerCase()}. Before your first meeting, you should know where you stand.`
      : `Welcome to the chair, ${ceo.firstName}. Your outer office is empty, so there is no one to brief you; this is what such a briefing would say.`,
  );

  // 2. The predecessor and the quarter they leave behind, if the game began with one.
  const pre = state.prequel;
  const predecessor = pre ? state.people[pre.predecessorId] : undefined;
  if (pre && predecessor) {
    const years = Math.floor(-predecessor.hiredMonth / 12);
    const result =
      pre.guidance === null
        ? 'with no guidance given'
        : `against guidance of ${formatZuzu(pre.guidance)}, ${pre.profit >= pre.guidance ? 'beating' : 'missing'} it`;
    const bar = boardExpectation(state);
    let past = `${fullName(predecessor)} ran the company for ${years} years and retired at the end of December. Last quarter (${quarterLabel(pre.quarterMonth)}) the company made ${formatZuzu(pre.profit)} ${result}.`;
    past += bar !== null
      ? ` The board now expects at least ${formatZuzu(bar)} a quarter; that is the bar it holds you to.`
      : ' That is the bar the board holds you to.';
    if (state.company.bonusPool > 0) {
      past += ` The quarter's bonus pool, ${formatZuzu(state.company.bonusPool)}, was left unallocated. It is yours to divide, and people are watching how.`;
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
      `The board has ${dirs.length} seat${dirs.length === 1 ? '' : 's'}. It is chaired by ${fullName(chair)}${agenda ? `, who ${AGENDA_PLAIN[agenda]}` : ''}.${others > 0 ? ` The ${others === 1 ? 'other director wants' : `other ${others} directors want`} something different, and you will not please them all.` : ''} Board confidence stands at ${Math.round(state.company.boardConfidence)} out of 100. Below ${NO_CONFIDENCE_LEVEL}, they start counting votes.`,
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
      `The board's other candidate for your chair was ${nameAndTitle(rival)}. ${capitalize(pronoun(rival, 'subject'))} took the news quietly. Too quietly.`,
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
    `You have ${state.player.attentionPerMonth} attention a month, and it is the only thing in this company that cannot be bought. Spend it on people: the ones who run things, the ones who are unhappy, the ones who are quietly ambitious. Numbers follow people, not the other way round.`,
  );

  return { speakerId: cos ? cos.id : null, paragraphs: out };
}
