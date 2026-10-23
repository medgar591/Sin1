// How people talk. Every line a person says to the CEO goes through here, so
// a ruthless officer sounds different from a nervous analyst. Lines are picked
// by hashing who, when and what, never by the game RNG, so giving someone a
// voice cannot change how a seeded game plays out.
import type { Month, Person } from './types';

export type Tone = 'blunt' | 'smooth' | 'nervous' | 'formal' | 'sour' | 'plain';

const TONE_OF_TRAIT: Partial<Record<Person['traits'][number], Tone>> = {
  ruthless: 'blunt',
  reckless: 'blunt',
  charming: 'smooth',
  vain: 'smooth',
  paranoid: 'nervous',
  cautious: 'nervous',
  principled: 'formal',
  diligent: 'formal',
  petty: 'sour',
  gossip: 'sour',
};

export function toneOf(p: Person): Tone {
  for (const t of p.traits) {
    const tone = TONE_OF_TRAIT[t];
    if (tone) return tone;
  }
  return 'plain';
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic choice: the same keys always give the same item. */
export function variant<T>(xs: readonly T[], ...keys: (string | number)[]): T {
  return xs[hash(keys.join('|')) % xs.length];
}

const OPENERS: Record<Tone, string[]> = {
  blunt: ["I'll be direct.", 'No point dressing this up.', 'Straight to it.'],
  smooth: ['Thank you for making the time.', "I won't keep you long.", 'I appreciate the open door.'],
  nervous: ['Have you got a minute? Could we close the door?', "Sorry, I know you're busy.", "I've gone back and forth on whether to bring this to you."],
  formal: ["I'd like to raise something properly.", 'I want this on the record.', "I'll keep this brief and factual."],
  sour: ["Nobody else is going to tell you this, so.", "I'll say what everyone else is thinking.", "You'll hear a cleaner version of this elsewhere."],
  plain: ['Got a moment?', 'Something you should know.', 'Quick one.'],
};

/** A line in the speaker's voice: a tone-specific opener, then one of `lines`. */
export function speak(p: Person, month: Month, key: string, lines: readonly string[]): string {
  const opener = variant(OPENERS[toneOf(p)], p.id, month, key, 'open');
  return `${opener} ${variant(lines, p.id, month, key)}`;
}

/** One reply per tone, picked for the speaker. */
export function reply(p: Person, month: Month, key: string, byTone: Record<Tone, readonly string[]>): string {
  return variant(byTone[toneOf(p)], p.id, month, key);
}

// ---- Replies in a meeting with the CEO ----------------------------------

export const RAPPORT_WARM: Record<Tone, string[]> = {
  blunt: ["Fine. You're not what I expected.", "All right. I can work with you."],
  smooth: ['We should do this more often.', "I think we're going to get along."],
  nervous: ['That... helps, actually. Thank you.', "I didn't think you'd make time for me."],
  formal: ['I appreciate the candour.', 'Thank you. That was useful.'],
  sour: ["Hm. Better than the last one, I'll give you that.", "Don't make me regret saying this, but thanks."],
  plain: ['Thanks. That was good.', 'Appreciate it.'],
};

export const RAPPORT_GUARDED: Record<Tone, string[]> = {
  blunt: ['If that was a charm offensive, it needs work.', "I'll judge you on what you do."],
  smooth: ["Lovely chat. Let's see where it goes.", 'Always a pleasure.'],
  nervous: ["Is something wrong? You'd tell me if something was wrong.", "I'm... not sure what that was about."],
  formal: ['Noted.', "I'll reserve judgement, if that's all right."],
  sour: ["Let's not pretend we're friends.", "Everyone gets the friendly hour eventually."],
  plain: ["Okay. Thanks, I suppose.", 'Sure.'],
};

export const PROMISE_REPLY: Record<Tone, string[]> = {
  blunt: ["I'll hold you to that.", 'Good. Write it down.'],
  smooth: ['I knew we understood each other.', "That's generous. I won't forget it."],
  nervous: ['You mean that? Really?', "Okay. Okay. I'll believe it when... no, I believe you."],
  formal: ["Thank you. I'll take it as a commitment.", "I'll note the date."],
  sour: ["People have promised me things before.", "We'll see."],
  plain: ['Thank you. Really.', "That's all I wanted to hear."],
};

export const THREAT_CALM: Record<Tone, string[]> = {
  blunt: ['Understood.', 'Message received.'],
  smooth: ['Of course. No need for any of that.', 'Point taken, gracefully.'],
  nervous: ['I— yes. Understood.', "I didn't mean... understood."],
  formal: ["I'll note that you said that.", 'I understand the position.'],
  sour: ['Noted. People will hear how you talk to staff, you know.', 'Charming.'],
  plain: ['Understood.', 'Right. Got it.'],
};

export const THREAT_DEFIANT = [
  "You'll regret that.",
  "Careful. I have friends too.",
  "That's the last time you talk to me like that.",
];

export const PROBE_TALKED: Record<Tone, string[]> = {
  blunt: ["You want to know what's going on? Fine.", "Ask me straight and I'll answer straight."],
  smooth: ["Between us? There's quite a lot going on.", "I hear things. People like talking to me."],
  nervous: ["You didn't hear this from me.", "Please don't say where you heard it."],
  formal: ["I'll tell you what I know, and only what I know.", "I'd rather you heard it accurately."],
  sour: ["Oh, where do I start.", "Since you ask, nobody here is what they seem."],
  plain: ["Well, since you ask...", "Here's what I've noticed."],
};

export const PROBE_CLOSED: Record<Tone, string[]> = {
  blunt: ["I do my job. I don't do gossip.", "Is this an interrogation?"],
  smooth: ["Oh, everyone gets along famously.", "Nothing worth your time, honestly."],
  nervous: ["Why are you asking me? Has someone said something?", "I don't know anything. Really."],
  formal: ["I'm not comfortable discussing colleagues.", "That isn't something I'd speculate about."],
  sour: ["Ask Security. That's what they're for.", "Nice try."],
  plain: ["Not much to tell, really.", "Same as always."],
};

export const DIRECTOR_PERSUADED: Record<Tone, string[]> = {
  blunt: ["The numbers will speak. Make sure they do.", "Fine. Keep it up."],
  smooth: ["You make a good case. Keep making it.", "I'll mention it to the others."],
  nervous: ["I just need to know there won't be surprises.", "That's reassuring. Truly."],
  formal: ["Thank you for the briefing. It was thorough.", "I'll weigh it before the meeting."],
  sour: ["One good chart doesn't make a strategy.", "Hm. Better than last time."],
  plain: ["That helps. Thanks.", "All right, I'm listening."],
};
