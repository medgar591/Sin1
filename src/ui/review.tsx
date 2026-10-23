// The month-end feedback loop: what the month changed, the quarter report card, and the numbers behind a face-to-face.
import type { ComponentChildren } from 'preact';
import type { GameState, Motion } from '../sim/types';
import { fullName, formatZuzu, monthLabel, quarterLabel } from '../sim/org';
import { guidanceCredit, quarterOutlook, type QuarterOutlook } from '../sim/economy';
import { NO_CONFIDENCE_LEVEL } from '../sim/board';
import { Sheet, zuzuPrice } from './common';
import { OpenAsks, MeetingView, showFixerJobs } from './board';
import { closeSheet, game, openSheet, setTab, type SceneDeltas } from './store';

const LONG_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longMonth = (m: number) => `${LONG_MONTH[((m % 12) + 12) % 12]} ${monthLabel(m).split(' ')[1]}`;
const shortMonth = (m: number) => monthLabel(m).split(' ')[0];

/** How many of the month's log lines the review shows, and how many sit under a quarter's report card. */
const MAX_LOG = 4;
const MAX_LOG_ALSO = 3;

/** Log lines a quarter's report card already carries: the close, bonus pool, dividend, the board meeting, its motions and the asks it judged. */
const ON_THE_CARD = /^(Q\d \d{4} closed:|Bonus pool |Dividend of |Board meeting:|The board )|'s ask was (met|missed): /;

/** Signed whole number with a true minus: +6, −4, 0. */
export const sgn = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const sgnZuzu = (n: number) => (n < 0 ? `−${formatZuzu(-n)}` : `+${formatZuzu(n)}`);

// ---- Before and after ---------------------------------------------------

/** What the CEO could see before End month, to set against what the month did. */
export interface MonthSnapshot {
  month: number;
  cash: number;
  sharePrice: number;
  boardConfidence: number;
  attentionLeft: number;
  outlook: QuarterOutlook;
  inbox: Set<string>;
  pendingJobs: Set<string>;
  meetings: number;
  /** Length of the log, so the review shows only what the advance appended to it. */
  logLen: number;
}

/** Captures the numbers and ids worth comparing after End month; call before `advanceMonth`. */
export function snapshotMonth(g: GameState): MonthSnapshot {
  const c = g.company;
  return {
    month: g.month,
    cash: c.cash,
    sharePrice: c.sharePrice,
    boardConfidence: c.boardConfidence,
    attentionLeft: g.player.attentionLeft,
    outlook: quarterOutlook(g),
    inbox: new Set(g.inbox.map((i) => i.id)),
    pendingJobs: new Set(g.fixerJobs.filter((j) => j.state === 'pending').map((j) => j.id)),
    meetings: g.boardMeetings.length,
    logLen: g.log.length,
  };
}

/** What the advance put in front of the CEO: its notable log lines, new inbox items, fixer reports and unspent attention. */
export interface MonthEvents {
  log: { text: string; major: boolean }[];
  newInbox: number;
  waiting: number;
  reports: { what: string; state: string }[];
  attentionLeft: number;
}

/** The month in review, as plain data (it sits in the sheet list). */
export interface ReviewData extends MonthEvents {
  /** The month that closed. */
  month: number;
  profit: number | null;
  prevProfit: number | null;
  cash: [number, number];
  share: [number, number];
  conf: [number, number];
  /** The quarter as it stands after the month. */
  quarter: QuarterOutlook;
}

const FIXER_KIND = { materials: 'Materials', specialHire: 'Special hire', dirt: 'Dirt' };
const FIXER_STATE = { success: 'Succeeded', partial: 'Partly succeeded', failed: 'Failed', pending: 'Pending' };

/** The advance's own events, from the log lines it appended (`onCard`: leave out what a report card says). */
function monthEvents(b: MonthSnapshot, g: GameState, max: number, onCard = false): MonthEvents {
  const log = g.log
    .slice(b.logLen)
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.importance >= 2 && !(onCard && ON_THE_CARD.test(l.text)))
    .sort((a, z) => z.l.importance - a.l.importance || a.i - z.i)
    .slice(0, max)
    .map(({ l }) => ({ text: l.text, major: l.importance === 3 }));
  const reports = g.fixerJobs
    .filter((j) => b.pendingJobs.has(j.id) && j.state !== 'pending')
    .map((j) => {
      const who = j.targetPersonId && g.people[j.targetPersonId] ? fullName(g.people[j.targetPersonId]) : j.targetUnitId && g.units[j.targetUnitId] ? g.units[j.targetUnitId].name : '';
      return { what: `${FIXER_KIND[j.kind]}${who ? ` · ${who}` : ''}`, state: FIXER_STATE[j.state] };
    });
  const waiting = g.inbox.filter((i) => i.resolution === null);
  return {
    log,
    newInbox: waiting.filter((i) => !b.inbox.has(i.id)).length,
    waiting: waiting.length,
    reports,
    attentionLeft: b.attentionLeft,
  };
}

/** Builds the month in review from the snapshot and the advanced state. */
export function monthReview(b: MonthSnapshot, g: GameState): ReviewData {
  const c = g.company;
  const h = c.history;
  const last = h[h.length - 1];
  const rec = last && last.month === b.month ? last : null;
  const prev = rec ? h[h.length - 2] : undefined;
  return {
    ...monthEvents(b, g, MAX_LOG),
    month: b.month,
    profit: rec ? rec.profit : null,
    prevProfit: prev ? prev.profit : null,
    cash: [b.cash, c.cash],
    share: [b.sharePrice, c.sharePrice],
    conf: [b.boardConfidence, c.boardConfidence],
    quarter: quarterOutlook(g),
  };
}

/** What the quarter that just closed looked like, for the report card; guidance and the bar are cleared or moved on by the close. */
export interface QuarterCard {
  label: string;
  profit: number;
  guidance: number | null;
  bar: number | null;
  share: [number, number];
  conf: [number, number];
  cash: [number, number];
  /** The dividend the close paid, as the log printed it ("3.1Mㄓ"). */
  dividend: string | null;
  /** The month's other news, under the card. */
  also: MonthEvents;
}

/** Builds the report card for the board meeting that the advance just held. */
export function quarterCard(b: MonthSnapshot, g: GameState): QuarterCard {
  const m = g.boardMeetings[g.boardMeetings.length - 1];
  const profit = g.company.history.filter((r) => r.month > m.month - 3 && r.month <= m.month).reduce((a, r) => a + r.profit, 0);
  return {
    label: quarterLabel(m.month),
    profit,
    guidance: b.outlook.guidance,
    bar: b.outlook.expectation,
    share: [b.sharePrice, g.company.sharePrice],
    conf: [b.boardConfidence, g.company.boardConfidence],
    cash: [b.cash, g.company.cash],
    dividend: g.log.slice(b.logLen).map((l) => /^Dividend of (\S+) paid out/.exec(l.text)?.[1]).find(Boolean) ?? null,
    also: monthEvents(b, g, MAX_LOG_ALSO, true),
  };
}

// ---- Pieces -------------------------------------------------------------

/** A change with an arrow and a sign, so the direction never rests on colour. */
function Chg({ d, text, flat = 'no change' }: { d: number; text: string; flat?: string }) {
  if (d === 0) return <span class="dim">{flat}</span>;
  return <span class={d > 0 ? 'green' : 'red'}><span aria-hidden="true">{d > 0 ? '▲' : '▼'}</span> {text}</span>;
}

function Flow({ a, b }: { a: string; b: string }) {
  if (a === b) return <>{a}</>;
  return <>{a}<span aria-hidden="true"> → </span><span class="sr-only"> to </span>{b}</>;
}

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return <div class="rvrow"><span class="label">{label}</span><span class="rvval">{children}</span></div>;
}

/** What a speaker's regard for the CEO did in a scene; nothing at all if neither moved. */
export function DeltaChips({ d }: { d: SceneDeltas }) {
  if (d.opinion === 0 && d.loyalty === 0) return null;
  return (
    <div class="deltas">
      <span class="delta">Opinion of you <b class="mono"><Chg d={d.opinion} text={sgn(d.opinion)} flat="unchanged" /></b></span>
      <span class="delta">Loyalty <b class="mono"><Chg d={d.loyalty} text={sgn(d.loyalty)} flat="unchanged" /></b></span>
    </div>
  );
}

/** A gap too small to call (under 1% of the bar, or under 10K). */
const near = (d: number, bar: number) => Math.abs(d) < Math.max(10_000, Math.abs(bar) * 0.01);

/** One line on where the quarter is heading, worded like the dashboard's quarter card. */
export function quarterVerdict(q: QuarterOutlook): { tone: string; text: string } {
  if (q.guidance === null) return { tone: 'amber', text: 'No guidance announced for this quarter.' };
  const d = q.projected - q.guidance;
  if (near(d, q.guidance)) return { tone: '', text: 'Projected to land right on guidance.' };
  if (d >= 0) return { tone: 'green', text: `On track to beat guidance by ${formatZuzu(d)}.` };
  return { tone: Math.abs(d) > Math.abs(q.guidance) * 0.1 ? 'red' : 'amber', text: `Projected to miss guidance by ${formatZuzu(-d)}.` };
}

/** The month's notable lines, then what is waiting on the CEO: inbox, fixer reports, unspent attention. */
function Happened({ d, heading, empty }: { d: MonthEvents; heading: string; empty?: string }) {
  return (
    <>
      <div class="label" style={{ margin: '14px 0 2px' }}>{heading}</div>
      {d.log.length === 0 && empty && <div class="hint" style={{ padding: '4px 0' }}>{empty}</div>}
      {d.log.map((l, i) => (
        <div key={i} class="lmrow rvlog">
          <span class={`mark ${l.major ? 'm2' : 'm1'}`} />
          <div class="grow" style={{ fontWeight: l.major ? 600 : 400 }}>{l.major && <span class="sr-only">Major: </span>}{l.text}</div>
        </div>
      ))}
      <div class="rvnext">
        <div class="rvline">
          <span class="grow">
            {d.newInbox > 0 ? `${d.newInbox} new in the inbox` : 'Nothing new in the inbox'}
            {d.waiting > d.newInbox ? ` (${d.waiting} waiting).` : '.'}
          </span>
          {d.waiting > 0 && <button type="button" class="btn sm" onClick={() => setTab('inbox')}>See who’s waiting</button>}
        </div>
        {d.reports.length > 0 && (
          <div class="rvline">
            <span class="grow">
              {d.reports.length === 1 ? 'A fixer report came in.' : `${d.reports.length} fixer reports came in.`}
              {d.reports.map((r, i) => <span key={i} class="small dim clip" style={{ display: 'block' }}>{r.state}: {r.what}</span>)}
            </span>
            <button type="button" class="btn sm" onClick={showFixerJobs}>See the reports</button>
          </div>
        )}
        {d.attentionLeft > 0 && <div class="hint">You left {d.attentionLeft} attention unspent.</div>}
      </div>
    </>
  );
}

// ---- Month in review ----------------------------------------------------

/** The sheet that follows End month: what the month changed, where the quarter stands, what needs you next. */
export function ReviewSheet({ d }: { d: ReviewData }) {
  const q = d.quarter;
  const v = quarterVerdict(q);
  const dProfit = d.profit !== null && d.prevProfit !== null ? d.profit - d.prevProfit : null;
  const dCash = Math.round(d.cash[1] - d.cash[0]);
  const dShare = Math.round((d.share[1] - d.share[0]) * 100) / 100;
  const dConf = Math.round(d.conf[1]) - Math.round(d.conf[0]);
  return (
    <Sheet title={`${longMonth(d.month)} closed`}>
      <div class="rvrows">
        {d.profit !== null && (
          <Row label="Profit">
            <b class={`mono v ${d.profit < 0 ? 'red' : ''}`}>{formatZuzu(d.profit)}</b>
            {dProfit !== null && <span class="small"><Chg d={Math.round(dProfit)} text={`${sgnZuzu(dProfit)} vs ${shortMonth(d.month - 1)}`} flat={`same as ${shortMonth(d.month - 1)}`} /></span>}
          </Row>
        )}
        <Row label="Cash">
          <span class="mono v"><Flow a={formatZuzu(d.cash[0])} b={formatZuzu(d.cash[1])} /></span>
          <span class="small"><Chg d={dCash} text={sgnZuzu(dCash)} /></span>
        </Row>
        <Row label="Share price">
          <span class="mono v"><Flow a={zuzuPrice(d.share[0])} b={zuzuPrice(d.share[1])} /></span>
          <span class="small"><Chg d={dShare} text={dShare < 0 ? `−${zuzuPrice(-dShare)}` : `+${zuzuPrice(dShare)}`} /></span>
        </Row>
        <Row label="Confidence">
          <span class="mono v"><Flow a={String(Math.round(d.conf[0]))} b={String(Math.round(d.conf[1]))} /></span>
          <span class="small"><Chg d={dConf} text={sgn(dConf)} /></span>
        </Row>
      </div>

      <div class="card">
        <div class="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div class="label">{q.label} so far</div>
          <span class="mono small dim">{q.monthsLeft} mo left</span>
        </div>
        <div class="stat" style={{ margin: '8px 0' }}>
          <div><span class="label">Booked</span><b class={q.profitSoFar < 0 ? 'red' : ''}>{formatZuzu(q.profitSoFar)}</b></div>
          <div><span class="label">Guidance</span><b class={q.guidance === null ? 'amber' : 'cyan'}>{q.guidance === null ? 'none' : formatZuzu(q.guidance)}</b></div>
          <div><span class="label">Board’s bar</span><b class={q.expectation === null ? 'dim' : ''}>{q.expectation === null ? 'none' : formatZuzu(q.expectation)}</b></div>
        </div>
        <div class={v.tone} style={{ fontSize: '13px' }}>{v.text}</div>
        <div class="hint" style={{ marginTop: '2px' }}>Share price and confidence update when the board meets.</div>
      </div>

      <Happened d={d} heading="What happened" empty="Nothing notable on the record this month." />

      <div class="rvfoot">
        <button type="button" class="btn primary block" onClick={closeSheet}>Continue</button>
      </div>
    </Sheet>
  );
}

// ---- Quarter closed -----------------------------------------------------

/**
 * One plain line on why the quarter moved the price and confidence, worded from `closeQuarter`: only a beat earns
 * credit, scaled by how high the guidance was set against the board's bar; a miss or no guidance takes the full hit.
 */
export function guidanceNote(c: Pick<QuarterCard, 'profit' | 'guidance' | 'bar' | 'share'>): string {
  // The price also drifts toward what the past year's earnings are worth, whatever the verdict.
  const drift = c.share[1] > c.share[0] ? ' The price still rose: it also drifts toward what the past year’s earnings are worth.' : '';
  if (c.guidance === null) return `With no guidance, the quarter counted against you.${drift}`;
  if (c.profit < c.guidance) return `Profit fell short of guidance, so the full penalty applied; it grows with the size of the miss.${drift}`;
  const hit = `${near(c.profit - c.guidance, c.guidance) ? 'meeting' : 'beating'} guidance earned`;
  if (c.bar === null) return `The board had no bar for this quarter: ${hit} the full price and confidence gain.`;
  const credit = guidanceCredit(c.guidance, c.bar);
  const at = `Guided at ${Math.round((c.guidance / c.bar) * 100)}% of the board’s bar`;
  if (credit >= 1) return `${at}: ${hit} the full price and confidence gain.`;
  if (credit <= 0) return `${at}, which counts as sandbagging: ${hit} no price or confidence gain.`;
  return `${at}: ${hit} ${Math.round(credit * 100)}% of the usual price and confidence gain.`;
}

/** Words and a verdict for profit against a bar: "Beat guidance by 120Kㄓ". Reaching the bar counts as meeting it, as the sim does. */
function judge(profit: number, bar: number, noun: string): { ok: boolean; text: string } {
  const d = profit - bar;
  if (d < 0) return { ok: false, text: `Missed ${noun} by ${formatZuzu(-d)}` };
  return { ok: true, text: near(d, bar) ? `Met ${noun}` : `Beat ${noun} by ${formatZuzu(d)}` };
}

function Verdict({ ok, text }: { ok: boolean; text: string }) {
  return <span class={ok ? 'green' : 'red'}><span aria-hidden="true">{ok ? '✓' : '✗'}</span> {text}</span>;
}

function Survived({ mo }: { mo: Motion }) {
  const yes = Object.values(mo.votes).filter(Boolean).length;
  const no = Object.keys(mo.votes).length - yes;
  const by = no - yes;
  return <>You survived a vote of no confidence{by === 1 ? ' by one vote' : by === 0 ? ' on the chair’s casting vote' : ''}, <span style={{ whiteSpace: 'nowrap' }}>{no}–{yes}</span>.</>;
}

/** The sheet that follows a board meeting: the quarter's report card, then the meeting itself. */
export function BoardResult({ index, card }: { index: number; card: QuarterCard }) {
  const g = game();
  const m = g.boardMeetings[index];
  if (!m) return null;
  const pool = g.company.bonusPool;
  const nextAsks = (g.asks ?? []).filter((a) => a.state === 'open' && g.people[a.directorId]);
  const vote = m.motions.find((mo) => mo.kind === 'noConfidence' && !mo.passed);
  const guide = card.guidance === null ? { ok: false, text: 'No guidance announced' } : judge(card.profit, card.guidance, 'guidance');
  const bar = card.bar === null ? null : judge(card.profit, card.bar, 'the board’s bar');
  const pricePct = card.share[0] > 0 ? Math.round((card.share[1] / card.share[0] - 1) * 1000) / 10 : 0;
  const dConf = Math.round(card.conf[1]) - Math.round(card.conf[0]);
  const dCash = Math.round(card.cash[1] - card.cash[0]);
  return (
    <Sheet title={`${card.label} closed`}>
      {vote && <div class="warnbox" style={{ marginBottom: '10px', fontWeight: 600 }}><Survived mo={vote} /></div>}
      <div class="rvrows">
        <Row label="Profit"><b class={`mono v ${card.profit < 0 ? 'red' : ''}`}>{formatZuzu(card.profit)}</b><span class="small dim">for the quarter</span></Row>
        <Row label="Guidance">
          <span class="mono v">{card.guidance === null ? 'none' : formatZuzu(card.guidance)}</span>
          <span class="small"><Verdict {...guide} /></span>
          <span class="hint rvnote">{guidanceNote(card)}</span>
        </Row>
        {bar && card.bar !== null && (
          <Row label="Board’s bar">
            <span class="mono v">{formatZuzu(card.bar)}</span>
            <span class="small"><Verdict {...bar} /></span>
          </Row>
        )}
        <Row label="Share price">
          <span class="mono v"><Flow a={zuzuPrice(card.share[0])} b={zuzuPrice(card.share[1])} /></span>
          <span class="small"><Chg d={pricePct} text={`${pricePct < 0 ? '−' : '+'}${Math.abs(pricePct).toFixed(1)}%`} /></span>
        </Row>
        <Row label="Confidence">
          <span class="mono v"><Flow a={String(Math.round(card.conf[0]))} b={String(Math.round(card.conf[1]))} /></span>
          <span class="small"><Chg d={dConf} text={sgn(dConf)} /></span>
          <span class="hint rvnote">Below {NO_CONFIDENCE_LEVEL} the board can vote you out.{card.conf[1] < NO_CONFIDENCE_LEVEL && ' You are below that now.'}</span>
        </Row>
        <Row label="Cash">
          <span class="mono v"><Flow a={formatZuzu(card.cash[0])} b={formatZuzu(card.cash[1])} /></span>
          <span class="small"><Chg d={dCash} text={sgnZuzu(dCash)} /></span>
          {card.dividend && <span class="hint rvnote">Includes a {card.dividend} dividend paid to shareholders.</span>}
        </Row>
        {pool > 0 && (
          <Row label="Bonus pool">
            <b class="mono v">{formatZuzu(pool)}</b>
            <button type="button" class="btn sm warn" onClick={() => openSheet({ k: 'bonus' })}>Allocate</button>
          </Row>
        )}
      </div>
      <MeetingView m={m} />
      {nextAsks.length > 0 && (
        <div class="card" style={{ padding: '10px 0 0', overflow: 'hidden' }}>
          <div class="label" style={{ padding: '0 12px 6px' }}>Next quarter, the board wants</div>
          <OpenAsks asks={nextAsks} />
        </div>
      )}
      <Happened d={card.also} heading="Also this month" />
      <div class="rvfoot">
        <button type="button" class="btn primary block" onClick={closeSheet}>Continue</button>
      </div>
    </Sheet>
  );
}
