import { useState } from 'preact/hooks';
import type { Pronouns } from '../sim/types';
import { generateGame } from '../sim/generate';
import { COMPANY_NAME_SUGGESTIONS } from '../sim/data/names';
import { clearSave, hasSave, importSave, loadGame } from '../save';
import { Seg } from './common';
import { errMsg, setGame, startGame } from './store';

function hashSeed(text: string): number {
  const t = text.trim();
  if (!t) return Math.floor(Math.random() * 2 ** 31);
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}

const suggest = () => COMPANY_NAME_SUGGESTIONS[Math.floor(Math.random() * COMPANY_NAME_SUGGESTIONS.length)] ?? 'Hoshida Combine';

export function Title() {
  const [view, setView] = useState<'main' | 'new' | 'import'>('main');
  const [company, setCompany] = useState(suggest);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [pro, setPro] = useState<Pronouns>('they');
  const [seed, setSeed] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(hasSave);
  const [busy, setBusy] = useState(false);

  const start = () => {
    setErr('');
    setBusy(true);
    // Generating a company runs five years of it: let the message paint before the work starts.
    setTimeout(() => {
      try {
        const g = generateGame(hashSeed(seed), {
          companyName: company.trim() || 'Unnamed Combine',
          playerFirstName: first.trim() || 'Alex',
          playerLastName: last.trim() || 'Morrow',
          playerPronouns: pro,
        });
        startGame(g);
      } catch (e) {
        setErr(errMsg(e));
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div class="center">
      <div class="logo">SIN1</div>
      <div class="label" style={{ marginBottom: '28px' }}>Zaibatsu management terminal · 2090</div>

      {view === 'main' && (
        <div class="stack">
          <p class="dim">
            You have just been installed as chief executive. Four hundred people report up to you, and most of them
            would like your job, or at least your attention. Keep the company growing. Keep the board content.
          </p>
          {saved && (
            <button
              type="button"
              class="btn primary block"
              onClick={() => {
                const g = loadGame();
                if (g) setGame(g);
                else setErr('The saved game could not be read.');
              }}
            >
              Continue
            </button>
          )}
          <button type="button" class={`btn block ${saved ? '' : 'primary'}`} onClick={() => setView('new')}>New game</button>
          <button type="button" class="btn block" onClick={() => setView('import')}>Import save</button>
          {saved && (
            <button type="button" class="btn sm block" onClick={() => { clearSave(); setSaved(false); setView('main'); setErr('Saved game deleted.'); }}>
              Delete saved game
            </button>
          )}
          {err && <div class="warnbox" role="alert">{err}</div>}
        </div>
      )}

      {view === 'new' && (
        <div class="stack">
          <div>
            <label class="label" for="co-name">Company</label>
            <div class="row">
              <input id="co-name" type="text" class="grow" value={company} onInput={(e) => setCompany(e.currentTarget.value)} />
              <button type="button" class="btn" onClick={() => setCompany(suggest())} aria-label="Suggest a name">↻</button>
            </div>
          </div>
          <div class="grid2">
            <div>
              <label class="label" for="pl-first">First name</label>
              <input id="pl-first" type="text" value={first} placeholder="Alex" onInput={(e) => setFirst(e.currentTarget.value)} />
            </div>
            <div>
              <label class="label" for="pl-last">Last name</label>
              <input id="pl-last" type="text" value={last} placeholder="Morrow" onInput={(e) => setLast(e.currentTarget.value)} />
            </div>
          </div>
          <div>
            <div class="label" id="pl-pro">Pronouns</div>
            <div role="group" aria-labelledby="pl-pro">
              <Seg value={pro} onChange={setPro} options={[['she', 'she/her'], ['he', 'he/him'], ['they', 'they/them']]} />
            </div>
          </div>
          <div>
            <label class="label" for="seed">Seed (optional)</label>
            <input id="seed" type="text" value={seed} placeholder="random" onInput={(e) => setSeed(e.currentTarget.value)} />
          </div>
          {err && <div class="warnbox" role="alert">{err}</div>}
          <button type="button" class="btn primary block" disabled={busy} onClick={start}>
            {busy ? 'Reviewing five years of company records…' : 'Take the chair'}
          </button>
          <button type="button" class="btn block" disabled={busy} onClick={() => setView('main')}>Back</button>
        </div>
      )}

      {view === 'import' && (
        <div class="stack">
          <label class="label" for="import-text">Paste exported save</label>
          <textarea id="import-text" value={text} onInput={(e) => setText(e.currentTarget.value)} />
          <label class="btn block">
            Choose a saved file…
            <input type="file" class="sr-only" accept=".txt,.json,text/plain" onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (f) setText(await f.text());
            }} />
          </label>
          {err && <div class="warnbox" role="alert">{err}</div>}
          <button
            type="button"
            class="btn primary block"
            onClick={async () => {
              try {
                startGame(await importSave(text));
              } catch (e) {
                setErr(errMsg(e));
              }
            }}
          >
            Import
          </button>
          <button type="button" class="btn block" onClick={() => { setView('main'); setErr(''); }}>Back</button>
        </div>
      )}
    </div>
  );
}
