import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { GameState, InboxItem } from '../sim/types';
import { advanceMonth } from '../sim/turn';
import { formatZuzu, monthLabel } from '../sim/org';
import { quarterOutlook } from '../sim/economy';
import { NO_CONFIDENCE_LEVEL } from '../sim/board';
import { Pips, Sheet, zuzuPrice } from './common';
import { BonusSheet, Dashboard } from './dashboard';
import { scrollToQuarter } from './agenda';
import { OrgView, UnitSheet } from './org';
import { PersonSheet } from './person';
import { Inbox } from './inbox';
import { BoardView } from './board';
import { IntroSheet } from './intro';
import { MoreView } from './more';
import { GameOver } from './gameover';
import { Title } from './title';
import { SceneSheet } from './scene';
import { BoardResult, ReviewSheet, monthReview, quarterCard, snapshotMonth } from './review';
import { closeSheet, commit, errMsg, openSheet, S, setTab, toast, useStore, useToast, type Sheet as SheetT, type Tab } from './store';

const pendingInbox = (g: GameState) => g.inbox.filter((i) => i.resolution === null);

function doEndMonth() {
  const g = S.game;
  if (!g) return;
  const before = snapshotMonth(g);
  try {
    advanceMonth(g);
  } catch (e) {
    toast(errMsg(e), 'bad');
    commit();
    return;
  }
  S.sheets = [];
  if (!g.gameOver) {
    S.tab = 'dash';
    S.sheets = [
      g.boardMeetings.length > before.meetings
        ? { k: 'boardResult', index: g.boardMeetings.length - 1, card: quarterCard(before, g) }
        : { k: 'review', data: monthReview(before, g) },
    ];
    window.scrollTo(0, 0);
  }
  commit(true);
}

/** What is still open that the month's end will settle without the CEO. */
function outstanding(g: GameState) {
  const expiring = pendingInbox(g).filter((i) => i.expiresMonth <= g.month && i.options.length > 0);
  return { guidance: g.company.guidance === null, bonus: g.company.bonusPool, expiring };
}

function endMonthClick() {
  const o = outstanding(S.game!);
  if (o.guidance || o.bonus > 0 || o.expiring.length > 0) openSheet({ k: 'endMonth' });
  else doEndMonth();
}

function goAnnounceGuidance() {
  setTab('dash');
  requestAnimationFrame(scrollToQuarter);
}

function TopBar() {
  const g = S.game!;
  const c = g.company;
  const conf = c.boardConfidence;
  const q = quarterOutlook(g);
  const soon = q.monthsLeft <= 1;
  return (
    <div class="topbar">
      <div class="r1">
        <div style={{ minWidth: 0 }}>
          <div class="co">{c.name}</div>
          <div class="mono small dim">{monthLabel(g.month)}</div>
          <div class="mono dim" style={{ fontSize: '11px', lineHeight: 1.2 }}>
            {q.label.split(' ')[0]} · {soon ? <span class="amber">board meets this month</span> : `board in ${q.monthsLeft - 1} mo`}
          </div>
        </div>
        <button class="btn primary sm" onClick={endMonthClick}>End month ▸</button>
      </div>
      <div class="r2">
        <div class="kv">
          <span class="label" aria-hidden="true">Attn</span>
          <span aria-hidden="true"><Pips n={g.player.attentionLeft} of={g.player.attentionPerMonth} /></span>
          <span class="sr-only">Attention left: {g.player.attentionLeft} of {g.player.attentionPerMonth}</span>
        </div>
        <div class="kv"><span class="label">Cash</span><b class={c.cash < 0 ? 'red' : ''}>{formatZuzu(c.cash)}</b></div>
        <div class="kv"><span class="label">Share</span><b>{zuzuPrice(c.sharePrice)}</b></div>
        <button
          type="button"
          class="kv kvbtn"
          onClick={() => setTab('board')}
          aria-label={`Board confidence ${Math.round(conf)} of 100. Below ${NO_CONFIDENCE_LEVEL} they can vote you out.${conf < NO_CONFIDENCE_LEVEL ? ' You are below that now.' : ''}`}
        >
          <span class="label">Board</span>
          <span>
            <b class={conf < NO_CONFIDENCE_LEVEL ? 'red' : conf < 50 ? 'amber' : 'green'}>{Math.round(conf)}</b>
            <span class={`bfloor ${conf < NO_CONFIDENCE_LEVEL ? 'red' : ''}`}>{conf < NO_CONFIDENCE_LEVEL ? 'at risk' : `out <${NO_CONFIDENCE_LEVEL}`}</span>
          </span>
          <span class="bmeter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, conf))}%` }} /><u style={{ left: `${NO_CONFIDENCE_LEVEL}%` }} /></span>
        </button>
      </div>
    </div>
  );
}

const ICON: Record<Tab, JSX.Element> = {
  dash: <path d="M3 20V10m6 10V4m6 16v-7m6 7V8" />,
  org: <path d="M12 3v5m0 0H5v4m7-4h7v4M5 12v0m0 0v3m14-3v3M3 15h4v4H3zm14 0h4v4h-4zM10 3h4v0" />,
  inbox: <path d="M3 13l3-8h12l3 8v6H3zm0 0h6l1 2h4l1-2h6" />,
  board: <path d="M4 20V9l8-5 8 5v11M9 20v-6h6v6M2 20h20" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3.5" stroke-linecap="round" />,
};
const TABS: [Tab, string][] = [['dash', 'Dash'], ['org', 'Org'], ['inbox', 'Inbox'], ['board', 'Board'], ['more', 'More']];
/** Page headings, read by screen readers (the tab labels are short). */
const TAB_NAME: Record<Tab, string> = { dash: 'Dashboard', org: 'Organisation', inbox: 'Inbox', board: 'Board', more: 'More' };

function TabBar() {
  const g = S.game!;
  const unresolved = pendingInbox(g).length;
  useEffect(() => {
    document.title = `${TAB_NAME[S.tab]} · Sin1`;
    return () => {
      document.title = 'Sin1';
    };
  }, [S.tab]);
  return (
    <nav class="tabbar" aria-label="Main">
      {TABS.map(([t, l]) => (
        <button type="button" key={t} class={`tab ${S.tab === t ? 'on' : ''}`} aria-current={S.tab === t ? 'page' : undefined} aria-label={t === 'inbox' && unresolved > 0 ? `${l}, ${unresolved} waiting` : undefined} onClick={() => setTab(t)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{ICON[t]}</svg>
          {l}
          {t === 'inbox' && unresolved > 0 && (
            <>
              <span class="badge" aria-hidden="true">{unresolved}</span>
            </>
          )}
        </button>
      ))}
    </nav>
  );
}

function EndMonthSheet() {
  const g = S.game!;
  const o = outstanding(g);
  const label = quarterOutlook(g).label.split(' ')[0];
  const clear = !o.guidance && o.bonus <= 0 && o.expiring.length === 0;
  return (
    <Sheet title="Before you end the month">
      <div class="stack">
        <div class="list">
          {o.guidance && (
            <div class="item todo">
              <span class="grow">
                <span style={{ display: 'block' }}>No guidance announced for {label}.</span>
                <span class="small dim" style={{ display: 'block' }}>The board judges the quarter against it. Without it the quarter counts against you.</span>
              </span>
              <button type="button" class="btn sm" onClick={goAnnounceGuidance}>Announce</button>
            </div>
          )}
          {o.bonus > 0 && (
            <div class="item todo">
              <span class="grow">
                <span style={{ display: 'block' }}>Bonus pool of {formatZuzu(o.bonus)} is unallocated.</span>
                <span class="small dim" style={{ display: 'block' }}>People expect a share. Unspent money returns to cash.</span>
              </span>
              <button type="button" class="btn sm" onClick={() => openSheet({ k: 'bonus' })}>Allocate</button>
            </div>
          )}
          {o.expiring.length > 0 && (
            <div class="item todo">
              <span class="grow">
                <span style={{ display: 'block' }}>{o.expiring.length === 1 ? '1 inbox item expires' : `${o.expiring.length} inbox items expire`} this month.</span>
                {o.expiring.slice(0, 4).map((i) => <IfIgnored key={i.id} it={i} />)}
                {o.expiring.length > 4 && <span class="small dim" style={{ display: 'block' }}>and {o.expiring.length - 4} more</span>}
              </span>
              <button type="button" class="btn sm" onClick={() => setTab('inbox')}>Open inbox</button>
            </div>
          )}
          {clear && <div class="item todo"><span class="grow">All settled.</span></div>}
        </div>
        {g.player.attentionLeft > 0 && <div class="hint">You have {g.player.attentionLeft} unspent attention. It does not carry over.</div>}
        <button type="button" class="btn primary block" onClick={doEndMonth}>End month</button>
        <button type="button" class="btn block" onClick={closeSheet}>Keep working</button>
      </div>
    </Sheet>
  );
}

function IfIgnored({ it }: { it: InboxItem }) {
  return (
    <span class="small" style={{ display: 'block', marginTop: '4px' }}>
      {it.title}
      <span class="dim" style={{ display: 'block' }}>If ignored: {it.options[0].label}</span>
    </span>
  );
}

function renderSheet(s: SheetT, i: number) {
  switch (s.k) {
    case 'person': return <PersonSheet key={`${i}${s.id}`} id={s.id} />;
    case 'unit': return <UnitSheet key={`${i}${s.id}`} id={s.id} />;
    case 'intro': return <IntroSheet key={i} />;
    case 'bonus': return <BonusSheet key={i} />;
    case 'endMonth': return <EndMonthSheet key={i} />;
    case 'boardResult': return <BoardResult key={i} index={s.index} card={s.card} />;
    case 'review': return <ReviewSheet key={i} d={s.data} />;
    case 'scene': return <SceneSheet key={i} speakerId={s.speakerId} line={s.line} message={s.message} ok={s.ok} deltas={s.deltas} />;
  }
}

function ToastView() {
  const t = useToast();
  return (
    <>
      <div class="sr-only" role="status" aria-live="polite">{t?.text}</div>
      {t && (
        <div key={t.id} class={`toast ${t.kind === 'bad' ? 'bad' : ''} ${S.sheets.length ? 'top' : ''}`} aria-hidden="true">
          {t.text}
        </div>
      )}
    </>
  );
}

export function App() {
  useStore();
  if (!S.game) return <Title />;
  if (S.game.gameOver) return <GameOver />;
  return (
    <>
      <TopBar />
      <div class="main">
        <h1 class="sr-only" tabIndex={-1}>{TAB_NAME[S.tab]}</h1>
        {S.tab === 'dash' && <Dashboard />}
        {S.tab === 'org' && <OrgView />}
        {S.tab === 'inbox' && <Inbox />}
        {S.tab === 'board' && <BoardView />}
        {S.tab === 'more' && <MoreView />}
      </div>
      <TabBar />
      {S.sheets.map(renderSheet)}
      <ToastView />
    </>
  );
}
