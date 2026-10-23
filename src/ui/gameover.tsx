import { useMemo } from 'preact/hooks';
import { buildEpilogue, type EpilogueEntry } from '../sim/epilogue';
import { monthLabel } from '../sim/org';
import { clearSave } from '../save';
import { signed } from './common';
import { game, setGame } from './store';

function Card({ e, kind }: { e: EpilogueEntry; kind: 'help' | 'harm' }) {
  return (
    <div class={`ecard ${kind}`}>
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <div><b style={{ fontSize: '17px' }}>{e.name}</b><div class="small dim">{e.title}</div></div>
        <span class={`mono ${kind === 'help' ? 'green' : 'red'}`}>{signed(e.impact)}</span>
      </div>
      <div class="story">{e.story}</div>
      <div class="tl">
        {e.events.map((ev, i) => (
          <div key={i} class={ev.impact > 0 ? 'pos' : ev.impact < 0 ? 'neg' : ''}>
            <div class="small mono dim">{monthLabel(ev.month)}</div>
            <div class="small">
              {ev.impact !== 0 && <span class="sr-only">{ev.impact > 0 ? 'Good for them: ' : 'Bad for them: '}</span>}
              {ev.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GameOver() {
  const g = game();
  const go = g.gameOver!;
  const { data, err } = useMemo(() => {
    try { return { data: buildEpilogue(g), err: '' }; } catch (e) { return { data: null, err: e instanceof Error ? e.message : String(e) }; }
  }, []);
  const toTitle = () => { clearSave(); setGame(null); };
  return (
    <div class="center over">
      <div class="label">{go.reason === 'ousted' ? 'Removed by the board' : 'Retired'} · {monthLabel(go.month)}</div>
      <h1 style={{ margin: '6px 0 14px' }}>{go.reason === 'ousted' ? 'You are no longer chief executive.' : 'You step down.'}</h1>
      <div class="label">Score</div>
      <div class="score">{Math.round(go.score).toLocaleString()}</div>
      <p class="dim">{go.summary}</p>
      <button type="button" class="btn primary block" style={{ marginTop: '12px' }} onClick={toTitle}>Return to title</button>

      <h2 style={{ marginTop: '36px' }}>Lives you changed</h2>
      <p class="story dim">They were never headcount. Each of these people had a job, a boss, and a life that moved because of something you decided.</p>
      {err && <div class="warnbox">{err}</div>}
      {data && (
        <>
          <h2 class="green">Those you helped</h2>
          {data.helped.length === 0 && <div class="hint">No one, this time.</div>}
          {data.helped.map((e) => <Card key={e.personId} e={e} kind="help" />)}
          <h2 class="red">Those you harmed</h2>
          {data.harmed.length === 0 && <div class="hint">No one, this time.</div>}
          {data.harmed.map((e) => <Card key={e.personId} e={e} kind="harm" />)}
        </>
      )}
      <button type="button" class="btn primary block" style={{ marginTop: '24px' }} onClick={toTitle}>Return to title</button>
    </div>
  );
}
