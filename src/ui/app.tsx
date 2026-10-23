import type { JSX } from 'preact';
import type { GameState } from '../sim/types';
import { advanceMonth } from '../sim/turn';
import { formatZuzu, monthLabel } from '../sim/org';
import { Pips, Sheet, zuzuPrice } from './common';
import { BonusSheet, Dashboard } from './dashboard';
import { OrgView, UnitSheet } from './org';
import { PersonSheet } from './person';
import { Inbox } from './inbox';
import { BoardView, MeetingView } from './board';
import { MoreView } from './more';
import { GameOver } from './gameover';
import { Title } from './title';
import { closeSheet, commit, errMsg, openSheet, S, setTab, toast, useStore, useToast, type Sheet as SheetT, type Tab } from './store';

const pendingInbox = (g: GameState) => g.inbox.filter((i) => i.resolution === null);

function doEndMonth() {
  const g = S.game;
  if (!g) return;
  const meetings = g.boardMeetings.length;
  const pending = new Set(g.fixerJobs.filter((j) => j.state === 'pending').map((j) => j.id));
  try {
    advanceMonth(g);
  } catch (e) {
    toast(errMsg(e), 'bad');
    commit();
    return;
  }
  S.sheets = [];
  if (!g.gameOver) {
    const unresolved = pendingInbox(g).length;
    const reports = g.fixerJobs.filter((j) => pending.has(j.id) && j.state !== 'pending').length;
    const bits = [`${monthLabel(g.month)}.`, unresolved ? `${unresolved} item${unresolved > 1 ? 's' : ''} in the inbox.` : 'Quiet start.'];
    if (reports) bits.push(`${reports} fixer report${reports > 1 ? 's' : ''} in (Board tab).`);
    toast(bits.join(' '));
    if (g.boardMeetings.length > meetings) S.sheets = [{ k: 'boardResult', index: g.boardMeetings.length - 1 }];
  }
  commit(true);
}

function endMonthClick() {
  const g = S.game!;
  const unresolved = pendingInbox(g).length;
  if (g.player.attentionLeft > 0 || unresolved > 0) openSheet({ k: 'endMonth' });
  else doEndMonth();
}

function TopBar() {
  const g = S.game!;
  const c = g.company;
  const conf = c.boardConfidence;
  return (
    <div class="topbar">
      <div class="r1">
        <div style={{ minWidth: 0 }}>
          <div class="co">{c.name}</div>
          <div class="mono small dim">{monthLabel(g.month)}</div>
        </div>
        <button class="btn primary sm" onClick={endMonthClick}>End month ▸</button>
      </div>
      <div class="r2">
        <div class="kv"><span class="label">Attn</span><Pips n={g.player.attentionLeft} of={g.player.attentionPerMonth} /></div>
        <div class="kv"><span class="label">Cash</span><b class={c.cash < 0 ? 'red' : ''}>{formatZuzu(c.cash)}</b></div>
        <div class="kv"><span class="label">Share</span><b>{zuzuPrice(c.sharePrice)}</b></div>
        <div class="kv"><span class="label">Board</span><b class={conf < 30 ? 'red' : conf < 50 ? 'amber' : 'green'}>{Math.round(conf)}</b></div>
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

function TabBar() {
  const g = S.game!;
  const unresolved = pendingInbox(g).length;
  return (
    <nav class="tabbar">
      {TABS.map(([t, l]) => (
        <button key={t} class={`tab ${S.tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
          <svg viewBox="0 0 24 24">{ICON[t]}</svg>
          {l}
          {t === 'inbox' && unresolved > 0 && <span class="badge">{unresolved}</span>}
        </button>
      ))}
    </nav>
  );
}

function EndMonthSheet() {
  const g = S.game!;
  const unresolved = pendingInbox(g).length;
  return (
    <Sheet title="End the month?">
      <div class="stack">
        {g.player.attentionLeft > 0 && <div class="warnbox">You have {g.player.attentionLeft} unspent attention. It does not carry over.</div>}
        {unresolved > 0 && <div class="warnbox">{unresolved} unresolved inbox item{unresolved > 1 ? 's' : ''} will auto-resolve with their default option when they expire.</div>}
        <button class="btn primary block" onClick={doEndMonth}>End month</button>
        <button class="btn block" onClick={closeSheet}>Keep working</button>
      </div>
    </Sheet>
  );
}

function BoardResult({ index }: { index: number }) {
  const g = S.game!;
  const m = g.boardMeetings[index];
  if (!m) return null;
  const last = g.company.history[g.company.history.length - 1];
  const c = g.company;
  return (
    <Sheet title="Quarter closed">
      <div class="stat" style={{ marginBottom: '10px' }}>
        <div><span class="label">Last month</span><b>{last ? formatZuzu(last.profit) : '—'}</b></div>
        <div><span class="label">Share</span><b>{zuzuPrice(c.sharePrice)}</b></div>
        <div><span class="label">Board</span><b>{Math.round(c.boardConfidence)}</b></div>
      </div>
      <MeetingView m={m} />
      <button class="btn primary block" onClick={closeSheet}>Continue</button>
    </Sheet>
  );
}

function renderSheet(s: SheetT, i: number) {
  switch (s.k) {
    case 'person': return <PersonSheet key={`${i}${s.id}`} id={s.id} />;
    case 'unit': return <UnitSheet key={`${i}${s.id}`} id={s.id} />;
    case 'bonus': return <BonusSheet key={i} />;
    case 'endMonth': return <EndMonthSheet key={i} />;
    case 'boardResult': return <BoardResult key={i} index={s.index} />;
  }
}

function ToastView() {
  const t = useToast();
  if (!t) return null;
  return <div key={t.id} role="status" class={`toast ${t.kind === 'bad' ? 'bad' : ''} ${S.sheets.length ? 'top' : ''}`}>{t.text}</div>;
}

export function App() {
  useStore();
  if (!S.game) return <Title />;
  if (S.game.gameOver) return <GameOver />;
  return (
    <>
      <TopBar />
      <div class="main">
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
