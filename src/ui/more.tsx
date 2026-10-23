import { useState } from 'preact/hooks';
import { exportSave, importSave } from '../save';
import { monthLabel } from '../sim/org';
import { retire } from '../sim/actions';
import { Btn, ConfirmBtn, Empty, PersonChip, Primer, Seg } from './common';
import { errMsg, game, openSheet, run, setGame, startGame, toast } from './store';

export function MoreView() {
  const [sub, setSub] = useState<'log' | 'settings'>('log');
  return (
    <div>
      <div style={{ margin: '12px 0 4px' }}>
        <Seg value={sub} onChange={setSub} options={[['log', 'Log / News'], ['settings', 'Settings']]} />
      </div>
      {sub === 'log' ? <LogView /> : <Settings />}
    </div>
  );
}

function LogView() {
  const g = game();
  const [min, setMin] = useState<1 | 2 | 3>(1);
  const [n, setN] = useState(60);
  const rows = g.log.filter((l) => l.importance >= min).reverse();
  return (
    <div>
      <div style={{ margin: '10px 0' }}>
        <Seg value={String(min)} onChange={(v) => setMin(Number(v) as 1 | 2 | 3)} options={[['1', 'All'], ['2', 'Notable'], ['3', 'Major']]} />
      </div>
      {rows.length === 0 && <Empty>Nothing logged.</Empty>}
      <div class="list">
        {rows.slice(0, n).map((l, i) => (
          <div key={i} class="item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
            <span class={`mark ${l.importance === 3 ? 'm2' : l.importance === 2 ? 'm1' : ''}`} style={{ minHeight: '24px' }} />
            <div class="grow">
              <div class="small mono dim">{monthLabel(l.month)}</div>
              <div style={{ fontWeight: l.importance === 3 ? 600 : 400 }}>{l.text}</div>
              <div style={{ marginTop: '4px' }}>{l.personIds.slice(0, 4).map((id) => <PersonChip key={id} id={id} />)}</div>
            </div>
          </div>
        ))}
      </div>
      {rows.length > n && <button class="btn block" style={{ marginTop: '8px' }} onClick={() => setN(n + 60)}>Older…</button>}
    </div>
  );
}

function Settings() {
  const g = game();
  const [exp, setExp] = useState('');
  const [imp, setImp] = useState('');
  const [err, setErr] = useState('');
  return (
    <div class="stack" style={{ marginTop: '10px' }}>
      <div class="card">
        <div class="label" style={{ marginBottom: '6px' }}>How a month works</div>
        <Primer />
      </div>
      <button class="btn block" onClick={() => openSheet({ k: 'intro' })}>Replay the morning briefing</button>
      <div class="card stack">
        <div class="label">Export save</div>
        <Btn cls="block" onClick={async () => {
          try { setExp(await exportSave(g)); } catch (e) { toast(errMsg(e), 'bad'); }
        }}>Generate export text</Btn>
        {exp && (
          <>
            <textarea readOnly value={exp} onFocus={(e) => e.currentTarget.select()} />
            <Btn cls="block" onClick={() => {
              const url = URL.createObjectURL(new Blob([exp], { type: 'text/plain' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `sin1-${g.seed}-${monthLabel(g.month).replace(' ', '-')}.txt`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 2000);
            }}>Download as file</Btn>
            <Btn cls="block" onClick={async () => {
              try { await navigator.clipboard.writeText(exp); toast('Copied to clipboard.'); } catch { toast('Copy failed: select the text and copy it manually.', 'bad'); }
            }}>Copy</Btn>
          </>
        )}
      </div>
      <div class="card stack">
        <div class="label">Import save (replaces this game)</div>
        <textarea value={imp} onInput={(e) => setImp(e.currentTarget.value)} placeholder="Paste exported text" />
        {err && <div class="warnbox">{err}</div>}
        <ConfirmBtn label="Import" cls="block" onClick={async () => {
          try { startGame(await importSave(imp)); toast('Save imported.'); } catch (e) { setErr(errMsg(e)); }
        }} />
      </div>
      <div class="card stack">
        <div class="label">Leave the chair</div>
        <div class="hint">Retiring ends the game and shows the epilogue: the people whose lives you changed.</div>
        <ConfirmBtn label="Retire" cls="block warn" onClick={() => { run((st) => retire(st)); }} />
      </div>
      <button class="btn block" onClick={() => setGame(null)}>Quit to title (progress is autosaved)</button>
      <div class="small faint">Seed {g.seed} · {monthLabel(g.month)}</div>
    </div>
  );
}
