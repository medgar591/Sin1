import { useState } from 'preact/hooks';
import type { Pronouns } from '../sim/types';
import { generateGame } from '../sim/generate';
import { COMPANY_NAME_SUGGESTIONS } from '../sim/data/names';
import { clearSave, hasSave, importSave, loadGame, saveGame } from '../save';
import { Seg } from './common';
import { setGame } from './store';

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
  const saved = hasSave();

  const start = () => {
    setErr('');
    try {
      const g = generateGame(hashSeed(seed), {
        companyName: company.trim() || 'Unnamed Combine',
        playerFirstName: first.trim() || 'Alex',
        playerLastName: last.trim() || 'Morrow',
        playerPronouns: pro,
      });
      saveGame(g);
      setGame(g);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
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
          <button class={`btn block ${saved ? '' : 'primary'}`} onClick={() => setView('new')}>New game</button>
          <button class="btn block" onClick={() => setView('import')}>Import save</button>
          {saved && (
            <button class="btn sm block" onClick={() => { clearSave(); setView('main'); setErr('Saved game deleted.'); }}>
              Delete saved game
            </button>
          )}
          {err && <div class="warnbox">{err}</div>}
        </div>
      )}

      {view === 'new' && (
        <div class="stack">
          <div>
            <div class="label">Company</div>
            <div class="row">
              <input type="text" class="grow" value={company} onInput={(e) => setCompany(e.currentTarget.value)} />
              <button class="btn" onClick={() => setCompany(suggest())} aria-label="Suggest a name">↻</button>
            </div>
          </div>
          <div class="grid2">
            <div>
              <div class="label">First name</div>
              <input type="text" value={first} placeholder="Alex" onInput={(e) => setFirst(e.currentTarget.value)} />
            </div>
            <div>
              <div class="label">Last name</div>
              <input type="text" value={last} placeholder="Morrow" onInput={(e) => setLast(e.currentTarget.value)} />
            </div>
          </div>
          <div>
            <div class="label">Pronouns</div>
            <Seg value={pro} onChange={setPro} options={[['she', 'she/her'], ['he', 'he/him'], ['they', 'they/them']]} />
          </div>
          <div>
            <div class="label">Seed (optional)</div>
            <input type="text" value={seed} placeholder="random" onInput={(e) => setSeed(e.currentTarget.value)} />
          </div>
          {err && <div class="warnbox">{err}</div>}
          <button class="btn primary block" onClick={start}>Take the chair</button>
          <button class="btn block" onClick={() => setView('main')}>Back</button>
        </div>
      )}

      {view === 'import' && (
        <div class="stack">
          <div class="label">Paste exported save</div>
          <textarea value={text} onInput={(e) => setText(e.currentTarget.value)} />
          <label class="btn block">
            Choose a saved file…
            <input type="file" accept=".txt,.json,text/plain" style={{ display: 'none' }} onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (f) setText(await f.text());
            }} />
          </label>
          {err && <div class="warnbox">{err}</div>}
          <button
            class="btn primary block"
            onClick={() => {
              try {
                const g = importSave(text);
                saveGame(g);
                setGame(g);
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Import
          </button>
          <button class="btn block" onClick={() => { setView('main'); setErr(''); }}>Back</button>
        </div>
      )}
    </div>
  );
}
