// A face-to-face moment: who spoke, what they said, and how it came out.
import type { PersonId } from '../sim/types';
import { fullName } from '../sim/org';
import { Sheet } from './common';
import { Portrait } from './portrait';
import { closeSheet, game, openPerson } from './store';

export function SceneSheet({ speakerId, line, message, ok }: { speakerId: PersonId; line: string; message: string; ok: boolean }) {
  const p = game().people[speakerId];
  if (!p) return null;
  return (
    <Sheet title="Face to face">
      <div class="scene">
        <Portrait id={speakerId} size={104} ring={ok ? 'var(--cyan)' : 'var(--red)'} onClick={() => openPerson(speakerId)} />
        <div class="who">{fullName(p)}</div>
        <div class="small dim">{p.title}</div>
        <div class="story speech">{line}</div>
        <div class={`outcome ${ok ? '' : 'red'}`}>{message}</div>
        <button class="btn primary block" onClick={closeSheet}>Continue</button>
      </div>
    </Sheet>
  );
}
