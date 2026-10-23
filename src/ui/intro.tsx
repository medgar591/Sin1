// The opening briefing: the personal secretary welcomes the new CEO and says what the job is.
import { useEffect } from 'preact/hooks';
import { openingBriefing } from '../sim/briefing';
import { NO_CONFIDENCE_LEVEL } from '../sim/board';
import { fullName } from '../sim/org';
import { Sheet } from './common';
import { Portrait } from './portrait';
import { closeSheet, game } from './store';

const introKey = (seed: number) => `sin1.intro.${seed}`;

export function introSeen(seed: number): boolean {
  try { return localStorage.getItem(introKey(seed)) === '1'; } catch { return false; }
}

function markIntroSeen(seed: number): void {
  try { localStorage.setItem(introKey(seed), '1'); } catch { /* ignore */ }
}

export function IntroSheet() {
  const g = game();
  const b = openingBriefing(g);
  const sp = b.speakerId ? g.people[b.speakerId] : null;
  // However the sheet is dismissed (button, Close, scrim), it has been seen.
  useEffect(() => () => markIntroSeen(g.seed), [g.seed]);
  return (
    <Sheet title="Morning briefing">
      {sp && (
        <div class="phead" style={{ paddingBottom: '8px' }}>
          <Portrait id={sp.id} size={72} ring="var(--cyan)" />
          <div style={{ minWidth: 0 }}>
            <div class="pname">{fullName(sp)}</div>
            <div class="small dim">{sp.title}</div>
          </div>
        </div>
      )}
      <div class="inshort">
        <div class="label cyan">In short</div>
        <ul>
          <li>Announce a quarterly profit target (guidance) and beat it.</li>
          <li>Spend your attention on people: you have {g.player.attentionPerMonth} a month.</li>
          <li>Keep board confidence above {NO_CONFIDENCE_LEVEL}, or the board votes you out.</li>
        </ul>
      </div>
      <div class="briefing">
        {b.paragraphs.map((t, i) => <p key={i} class="story">{t}</p>)}
      </div>
      <button class="btn primary block meetbtn" style={{ marginTop: '8px' }} onClick={closeSheet}>Get to work</button>
    </Sheet>
  );
}
