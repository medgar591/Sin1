// Generated faces. Everything is derived from a hash of the person id (never
// the game RNG), so a face is stable across saves and re-renders.
import type { JSX } from 'preact';
import type { Heritage, Person, PersonId, Role } from '../sim/types';
import { fullName } from '../sim/org';
import { S } from './store';

// --- deterministic randomness -----------------------------------------------

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rnd = () => number;
const pick = <T,>(r: Rnd, a: readonly T[]): T => a[Math.floor(r() * a.length)];
const between = (r: Rnd, a: number, b: number) => a + r() * (b - a);

/** Darken (f < 1) or lighten (f > 1) a #rrggbb colour. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (f < 1) {
    r *= f; g *= f; b *= f;
  } else {
    const t = f - 1;
    r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// --- palettes -------------------------------------------------------------------

const HUMAN_SKIN = ['#f3d2b3', '#e8b98f', '#d19a6d', '#b47a50', '#8d5a38', '#654029'] as const;
const FUR = ['#c98a4b', '#8e6a49', '#a3a3a0', '#e6dccb', '#52423a', '#d9a05b', '#6f5a48'] as const;
const GREEN_SKIN = ['#86c27c', '#6fb48c', '#97cf74', '#5fa57f'] as const;
const GREY_SKIN = ['#9b9d97', '#8a908c', '#a8a39c', '#7f8683'] as const;
const STEEL = ['#aeb8c2', '#9aa7b3', '#c2c9d0', '#8895a3'] as const;
const HAIR = ['#17161a', '#2e231d', '#46301f', '#6a3a22', '#b98f4e', '#caa86a'] as const;
const GREY_HAIR = ['#9ea3a8', '#c9ccd0', '#7c8187'] as const;
const DYED_HAIR = ['#2fa6a0', '#b94a8c', '#4a6fd0', '#d06a3a'] as const;
const GREEN_HAIR = ['#27402a', '#3a5a2c', '#5b4a2a', '#1e2b22'] as const;
const EYES = ['#3a2a20', '#2f5f8a', '#3c7a52', '#8a6a2a', '#6a7480'] as const;
const SUITS = ['#1f2a3a', '#2b2f36', '#171a20', '#3a2230', '#22352f', '#40382c'] as const;
const SHIRTS = ['#c7d2dd', '#a8bdd1', '#e1d8c8', '#b9ccb4', '#d3b9b9'] as const;
const TIES = ['#b3363a', '#2a5fa0', '#2f7f6f', '#6a3a8a', '#8a8f98'] as const;
const TEES = ['#4a6a8a', '#8a4a4a', '#5a7a5a', '#8a7a4a', '#6a5a8a', '#4a8a8a', '#8a5a7a', '#6e7780'] as const;

type HairStyle = 'bald' | 'crop' | 'side' | 'long' | 'bob' | 'bun' | 'curly' | 'mohawk' | 'afro' | 'buzz';
const HAIR_STYLES: HairStyle[] = ['bald', 'crop', 'crop', 'side', 'side', 'long', 'bob', 'bun', 'curly', 'mohawk', 'afro', 'buzz'];
const SYNTH_HAIR: HairStyle[] = ['bald', 'bald', 'buzz', 'crop', 'mohawk'];
type Species = 'cat' | 'fox' | 'dog' | 'rabbit' | 'bear';
const SPECIES: Species[] = ['cat', 'fox', 'dog', 'rabbit', 'bear'];
type Dress = 'suit' | 'shirt' | 'plain';

function dressFor(role: Role): Dress {
  switch (role) {
    case 'ceo': case 'chair': case 'director': case 'officer': case 'divisionHead': case 'subdivisionHead':
      return 'suit';
    case 'teamLead': case 'subteamLead':
      return 'shirt';
    default:
      return 'plain';
  }
}

interface Look {
  heritage: Heritage;
  bg: string;
  skin: string;
  skinDk: string;
  hair: string;
  hairStyle: HairStyle;
  w: number; // half face width
  h: number; // face height
  k: number; // jaw fullness
  j: number; // chin width factor
  eyeStyle: number;
  eyeCol: string;
  eyeGap: number;
  browW: number;
  glasses: boolean;
  beard: boolean;
  species: Species;
  dress: Dress;
  cloth: string;
  tie: string;
  ceo: boolean;
  flip: number[]; // spare random draws for details
}

function lookFor(p: Person): Look {
  const r = mulberry(hashStr(p.id));
  const heritage = p.heritage;
  const skinHuman = pick(r, HUMAN_SKIN);
  const fur = pick(r, FUR);
  const green = pick(r, GREEN_SKIN);
  const grey = pick(r, GREY_SKIN);
  const steel = pick(r, STEEL);
  const skin =
    heritage === 'uplift' ? fur : heritage === 'green' ? green : heritage === 'blighted' ? grey : heritage === 'synth' ? steel : skinHuman;
  const old = p.age >= 52 ? 0.6 : p.age >= 45 ? 0.25 : 0.03;
  let hair: string = pick(r, HAIR);
  const roll = r();
  if (roll < old) hair = pick(r, GREY_HAIR);
  else if (roll > 0.93) hair = pick(r, DYED_HAIR);
  if (heritage === 'green') hair = pick(r, GREEN_HAIR);
  if (heritage === 'synth') hair = shade(steel, 0.55);
  const styled = heritage === 'synth' ? pick(r, SYNTH_HAIR) : pick(r, HAIR_STYLES);
  const hairStyle: HairStyle = heritage === 'uplift' ? 'bald' : styled; // fur, not hair
  const dress = dressFor(p.role);
  const hue = Math.floor(r() * 360);
  return {
    heritage,
    bg: `hsl(${hue} 22% 20%)`,
    skin,
    skinDk: shade(skin, 0.72),
    hair,
    hairStyle,
    w: between(r, 11.4, 14.2),
    h: between(r, 25, 29),
    k: between(r, 0.42, 0.78),
    j: between(r, 0.3, 0.8),
    eyeStyle: Math.floor(r() * 4),
    eyeCol: pick(r, EYES),
    eyeGap: between(r, 4.6, 6),
    browW: between(r, 0.9, 1.7),
    glasses: r() < 0.14,
    beard: r() < 0.16 && p.pronouns !== 'she' && heritage !== 'uplift' && heritage !== 'synth',
    species: pick(r, SPECIES),
    dress,
    cloth: dress === 'suit' ? pick(r, SUITS) : dress === 'shirt' ? pick(r, SHIRTS) : pick(r, TEES),
    tie: pick(r, TIES),
    ceo: p.role === 'ceo',
    flip: [r(), r(), r(), r(), r(), r(), r(), r()],
  };
}

// --- drawing --------------------------------------------------------------------

const T = 17; // top of the head
const CX = 32;

function headPath(l: Look): string {
  const L = CX - l.w;
  const R = CX + l.w;
  const side = T + 11 + (l.h - 11) * l.k;
  return (
    `M${L} ${T + 11} C${L} ${T - 4} ${R} ${T - 4} ${R} ${T + 11} ` +
    `C${R} ${side} ${CX + l.w * l.j} ${T + l.h} ${CX} ${T + l.h} ` +
    `C${CX - l.w * l.j} ${T + l.h} ${L} ${side} ${L} ${T + 11}Z`
  );
}

function HairBack({ l }: { l: Look }) {
  const L = CX - l.w;
  const R = CX + l.w;
  const c = l.hair;
  switch (l.hairStyle) {
    case 'long':
      return <path d={`M${L - 1.5} ${T + 12} C${L - 4} ${T - 8} ${R + 4} ${T - 8} ${R + 1.5} ${T + 12} L${R + 3.5} 56 L${L - 3.5} 56Z`} fill={c} />;
    case 'bob':
      return <path d={`M${L - 1.5} ${T + 12} C${L - 4} ${T - 8} ${R + 4} ${T - 8} ${R + 1.5} ${T + 12} L${R + 2.5} ${T + 27} Q${CX} ${T + 31} ${L - 2.5} ${T + 27}Z`} fill={c} />;
    case 'afro':
      return <circle cx={CX} cy={T + 6} r={l.w + 5.5} fill={c} />;
    default:
      return null;
  }
}

function HairFront({ l }: { l: Look }) {
  const L = CX - l.w;
  const R = CX + l.w;
  const c = l.hair;
  const cap = (hairline: number, o = 1) => (
    <path
      opacity={o}
      fill={c}
      d={
        `M${L - 0.8} ${T + 13} C${L - 1.6} ${T - 6} ${R + 1.6} ${T - 6} ${R + 0.8} ${T + 13} L${R - 0.7} ${T + 13} ` +
        `C${R - 0.7} ${T + hairline + 3} ${R - 4} ${T + hairline} ${CX} ${T + hairline} ` +
        `C${L + 4} ${T + hairline} ${L + 0.7} ${T + hairline + 3} ${L + 0.7} ${T + 13}Z`
      }
    />
  );
  switch (l.hairStyle) {
    case 'bald':
      return null;
    case 'crop':
    case 'long':
    case 'bob':
    case 'afro':
      return cap(4);
    case 'bun':
      return <>{cap(4)}<circle cx={CX} cy={T - 3.5} r="5" fill={c} /></>;
    case 'buzz':
      return cap(2.6, 0.55);
    case 'mohawk':
      return (
        <>
          {cap(2.2, 0.4)}
          <path fill={c} d={`M${CX - 3} ${T + 3} C${CX - 3} ${T - 4} ${CX - 2} ${T - 9} ${CX} ${T - 10} C${CX + 2} ${T - 9} ${CX + 3} ${T - 4} ${CX + 3} ${T + 3}Z`} />
        </>
      );
    case 'curly': {
      const dots = Array.from({ length: 7 }, (_, i) => {
        const a = Math.PI + (i / 6) * Math.PI;
        return <circle key={i} cx={CX + (l.w + 0.8) * Math.cos(a)} cy={T + 10 + 12 * Math.sin(a)} r="3.6" fill={c} />;
      });
      return <>{dots}{cap(3.4)}</>;
    }
    case 'side':
      return (
        <path
          fill={c}
          d={
            `M${L - 0.8} ${T + 13} C${L - 1.6} ${T - 6} ${R + 1.6} ${T - 6} ${R + 0.8} ${T + 13} L${R - 0.7} ${T + 13} ` +
            `C${R - 0.7} ${T + 6} ${CX + 7} ${T + 2.5} ${CX - 2} ${T + 3.2} C${CX - 6} ${T + 4} ${L + 0.7} ${T + 8} ${L + 0.7} ${T + 13}Z`
          }
        />
      );
  }
}

function Ears({ l }: { l: Look }) {
  const L = CX - l.w;
  const R = CX + l.w;
  if (l.heritage === 'uplift') {
    const f = l.skin;
    const inner = shade(f, 1.35);
    const dk = shade(f, 0.7);
    switch (l.species) {
      case 'cat':
        return (
          <>
            <path d={`M${L - 0.5} ${T + 7} L${L + 1} ${T - 7} L${L + 8} ${T - 0.5}Z`} fill={f} />
            <path d={`M${R + 0.5} ${T + 7} L${R - 1} ${T - 7} L${R - 8} ${T - 0.5}Z`} fill={f} />
            <path d={`M${L + 1} ${T + 4} L${L + 1.8} ${T - 3.5} L${L + 5} ${T}Z`} fill={inner} />
            <path d={`M${R - 1} ${T + 4} L${R - 1.8} ${T - 3.5} L${R - 5} ${T}Z`} fill={inner} />
          </>
        );
      case 'fox':
        return (
          <>
            <path d={`M${L - 0.5} ${T + 8} L${L + 0.5} ${T - 10} L${L + 9} ${T - 0.5}Z`} fill={f} />
            <path d={`M${R + 0.5} ${T + 8} L${R - 0.5} ${T - 10} L${R - 9} ${T - 0.5}Z`} fill={f} />
            <path d={`M${L + 1} ${T + 4} L${L + 1.3} ${T - 6} L${L + 5.5} ${T}Z`} fill={dk} />
            <path d={`M${R - 1} ${T + 4} L${R - 1.3} ${T - 6} L${R - 5.5} ${T}Z`} fill={dk} />
          </>
        );
      case 'dog':
        return (
          <>
            <ellipse cx={L - 0.5} cy={T + 11} rx="4" ry="9" fill={dk} transform={`rotate(10 ${L} ${T + 6})`} />
            <ellipse cx={R + 0.5} cy={T + 11} rx="4" ry="9" fill={dk} transform={`rotate(-10 ${R} ${T + 6})`} />
          </>
        );
      case 'rabbit':
        return (
          <>
            <ellipse cx={L + 4.5} cy={T - 7} rx="3.2" ry="11" fill={f} transform={`rotate(-8 ${L + 4.5} ${T - 7})`} />
            <ellipse cx={R - 4.5} cy={T - 7} rx="3.2" ry="11" fill={f} transform={`rotate(8 ${R - 4.5} ${T - 7})`} />
            <ellipse cx={L + 4.5} cy={T - 6.5} rx="1.5" ry="8" fill={inner} transform={`rotate(-8 ${L + 4.5} ${T - 6.5})`} />
            <ellipse cx={R - 4.5} cy={T - 6.5} rx="1.5" ry="8" fill={inner} transform={`rotate(8 ${R - 4.5} ${T - 6.5})`} />
          </>
        );
      case 'bear':
        return (
          <>
            <circle cx={L + 1.5} cy={T + 1.5} r="4.4" fill={f} />
            <circle cx={R - 1.5} cy={T + 1.5} r="4.4" fill={f} />
            <circle cx={L + 1.5} cy={T + 1.8} r="2.2" fill={inner} />
            <circle cx={R - 1.5} cy={T + 1.8} r="2.2" fill={inner} />
          </>
        );
    }
  }
  return (
    <>
      <ellipse cx={L + 0.4} cy={T + 15} rx="2.2" ry="3.4" fill={l.skinDk} />
      <ellipse cx={R - 0.4} cy={T + 15} rx="2.2" ry="3.4" fill={l.skinDk} />
      {l.heritage === 'synth' && (
        <>
          <circle cx={L + 0.4} cy={T + 15} r="1.1" fill="#5fe3f0" opacity=".85" />
          <circle cx={R - 0.4} cy={T + 15} r="1.1" fill="#5fe3f0" opacity=".85" />
        </>
      )}
    </>
  );
}

function Body({ l }: { l: Look }) {
  const shoulders = 'M2 64 C2 54 14 50 26 49 L38 49 C50 50 62 54 62 64Z';
  const neck = `M27.5 ${T + l.h - 5} L36.5 ${T + l.h - 5} L36.5 52 L27.5 52Z`;
  if (l.dress === 'suit') {
    const lapel = shade(l.cloth, 0.78);
    return (
      <>
        <path d={shoulders} fill={l.cloth} />
        <path d={neck} fill={l.skinDk} />
        <path d="M26 49 L38 49 L32 59Z" fill={l.skin} />
        <path d="M27 49 L32 52 L37 49 L32 58Z" fill="#e9eef2" />
        <path d={`M32 52 L30.6 54 L31.4 62 L32 64 L32.6 62 L33.4 54Z`} fill={l.ceo ? '#e0b040' : l.tie} />
        <path d="M24 49 L27 49 L32 60 L29 64 L19 64 Z" fill={lapel} />
        <path d="M40 49 L37 49 L32 60 L35 64 L45 64 Z" fill={lapel} />
      </>
    );
  }
  if (l.dress === 'shirt') {
    return (
      <>
        <path d={shoulders} fill={l.cloth} />
        <path d={neck} fill={l.skinDk} />
        <path d="M26.5 49 L37.5 49 L32 56.5Z" fill={l.skin} />
        <path d="M25.5 49.2 L31.6 56.6 L28 58 L24 52Z" fill={shade(l.cloth, 1.25)} />
        <path d="M38.5 49.2 L32.4 56.6 L36 58 L40 52Z" fill={shade(l.cloth, 1.25)} />
        <path d="M32 57 V64" stroke={shade(l.cloth, 0.7)} stroke-width="0.8" />
      </>
    );
  }
  return (
    <>
      <path d={shoulders} fill={l.cloth} />
      <path d={neck} fill={l.skinDk} />
      <path d="M26.5 49 Q32 57.5 37.5 49Z" fill={l.skin} />
      <path d="M26.5 49 Q32 57.5 37.5 49" fill="none" stroke={shade(l.cloth, 0.75)} stroke-width="1" />
    </>
  );
}

function Eyes({ l, brow }: { l: Look; brow: number }) {
  const y = T + 12.5;
  const xs = [CX - l.eyeGap, CX + l.eyeGap];
  const synth = l.heritage === 'synth';
  const browCol = l.hairStyle === 'bald' || synth ? shade(l.skin, 0.55) : shade(l.hair, 0.85);
  const brows = xs.map((x, i) => {
    const s = i === 0 ? 1 : -1; // inner end points toward the centre
    const outer = x - s * 2.9;
    const inner = x + s * 2.9;
    return (
      <path
        key={`b${i}`}
        d={`M${outer} ${y - 4.6 - brow * 0.2} L${inner} ${y - 4.6 + brow}`}
        stroke={browCol}
        stroke-width={l.browW}
        stroke-linecap="round"
        fill="none"
      />
    );
  });
  if (synth && l.flip[0] < 0.55) {
    // visor
    return (
      <>
        {brows}
        <rect x={CX - l.w + 1.2} y={y - 3} width={(l.w - 1.2) * 2} height="6" rx="3" fill="#0d1a22" />
        <rect x={CX - l.w + 3.2} y={y - 0.7} width={(l.w - 3.2) * 2} height="1.5" rx="0.75" fill="#5fe3f0" />
      </>
    );
  }
  const eyes = xs.map((x, i) => {
    if (synth) return <circle key={i} cx={x} cy={y} r="1.9" fill="#5fe3f0" />;
    switch (l.eyeStyle) {
      case 0:
        return <circle key={i} cx={x} cy={y} r="1.5" fill="#20181a" />;
      case 1:
        return (
          <g key={i}>
            <ellipse cx={x} cy={y} rx="2.5" ry="1.9" fill="#f1f3f4" />
            <circle cx={x} cy={y} r="1.35" fill={l.eyeCol} />
            <circle cx={x} cy={y} r="0.6" fill="#101012" />
          </g>
        );
      case 2:
        return <path key={i} d={`M${x - 2.4} ${y} Q${x} ${y - 1.8} ${x + 2.4} ${y}`} stroke="#20181a" stroke-width="1.5" fill="none" stroke-linecap="round" />;
      default:
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="2.1" fill="#f1f3f4" />
            <circle cx={x} cy={y} r="1.3" fill={l.eyeCol} />
            <circle cx={x} cy={y} r="0.55" fill="#101012" />
          </g>
        );
    }
  });
  return (
    <>
      {brows}
      {eyes}
      {l.glasses && (
        <g fill="none" stroke="#14181c" stroke-width="0.9">
          <circle cx={xs[0]} cy={y} r="3.9" />
          <circle cx={xs[1]} cy={y} r="3.9" />
          <path d={`M${xs[0] + 3.9} ${y} H${xs[1] - 3.9}`} />
        </g>
      )}
    </>
  );
}

function Face({ l, mood }: { l: Look; mood: -1 | 0 | 1 }) {
  const my = T + l.h * 0.79;
  const mouthCol = l.beard ? '#d89a86' : l.heritage === 'uplift' ? '#3a2a2a' : shade(l.skin, 0.5);
  const mouth =
    mood > 0
      ? `M${CX - 4.2} ${my - 0.4} Q${CX} ${my + 4} ${CX + 4.2} ${my - 0.4}`
      : mood < 0
        ? `M${CX - 3.6} ${my + 1.4} Q${CX} ${my - 1.8} ${CX + 3.6} ${my + 1.4}`
        : `M${CX - 3.2} ${my} Q${CX} ${my + 0.5} ${CX + 3.2} ${my}`;
  const uplift = l.heritage === 'uplift';
  const L = CX - l.w;
  const R = CX + l.w;
  const side = T + 11 + (l.h - 11) * l.k;
  return (
    <>
      {/* beard sits under the mouth */}
      {l.beard && (
        <path
          fill={l.hair}
          opacity=".92"
          d={
            `M${L + 0.3} ${T + 16} C${L + 0.4} ${side + 1} ${CX - l.w * l.j} ${T + l.h + 0.7} ${CX} ${T + l.h + 0.7} ` +
            `C${CX + l.w * l.j} ${T + l.h + 0.7} ${R - 0.4} ${side + 1} ${R - 0.3} ${T + 16} ` +
            `C${R - 2} ${T + 19} ${CX + 5} ${my - 2.4} ${CX} ${my - 2.4} C${CX - 5} ${my - 2.4} ${L + 2} ${T + 19} ${L + 0.3} ${T + 16}Z`
          }
        />
      )}
      {uplift && (
        <>
          <ellipse cx={CX} cy={T + l.h * 0.7} rx="6.6" ry="5" fill={shade(l.skin, 1.38)} />
          <path d={`M${CX - 1.9} ${T + 16.4} H${CX + 1.9} L${CX} ${T + 18.8}Z`} fill="#2f2224" />
          <path d={`M${CX} ${T + 18.8} V${my - 0.6}`} stroke="#2f2224" stroke-width="0.7" />
          {l.flip[1] < 0.5 && (
            <path d={`M${CX - 3} ${T + 4} v3.5 M${CX} ${T + 3} v4.5 M${CX + 3} ${T + 4} v3.5`} stroke={shade(l.skin, 0.6)} stroke-width="1.1" stroke-linecap="round" />
          )}
        </>
      )}
      {!uplift && <path d={`M${CX + 0.2} ${T + 14.6} q-1.6 3.6 0 4.6 h1.8`} fill="none" stroke={shade(l.skin, 0.62)} stroke-width="0.9" stroke-linecap="round" opacity=".7" />}
      <path d={mouth} fill="none" stroke={mouthCol} stroke-width="1.3" stroke-linecap="round" />
      <Eyes l={l} brow={mood < 0 ? 1.3 : mood > 0 ? -0.5 : 0.2} />
    </>
  );
}

function Marks({ l }: { l: Look }) {
  const L = CX - l.w;
  const R = CX + l.w;
  if (l.heritage === 'synth') {
    return (
      <g stroke="#53626f" stroke-width="0.7" fill="none" opacity=".85">
        <path d={`M${R - 3.2} ${T + 9} V${T + 20} L${R - 6} ${T + 23}`} />
        <path d={`M${CX - 4} ${T + 1.4} H${CX + 4}`} />
        <circle cx={L + 4} cy={T + 19} r="1.1" fill="#5fe3f0" stroke="none" opacity=".9" />
        <path d={`M${CX} ${T - 0.5} V${T + 3}`} />
      </g>
    );
  }
  if (l.heritage === 'blighted') {
    const f = l.flip;
    return (
      <g fill="#34332f" opacity=".5">
        <circle cx={CX - 6 + f[2] * 4} cy={T + 7 + f[3] * 4} r={1.2 + f[4] * 1.8} />
        <circle cx={CX + 3 + f[5] * 6} cy={T + 15 + f[6] * 6} r={1 + f[7] * 2.2} />
        <ellipse cx={CX + 5 + f[3] * 3} cy={T + 5 + f[2] * 3} rx="2.4" ry="1.5" />
        <circle cx={CX - 7 + f[6] * 3} cy={T + 19 + f[5] * 3} r={1 + f[4] * 1.2} />
      </g>
    );
  }
  return null;
}

function Leaves({ l }: { l: Look }) {
  if (l.heritage !== 'green') return null;
  const L = CX - l.w;
  const R = CX + l.w;
  const leaf = (x: number, y: number, rot: number, c: string, k: number) => (
    <ellipse key={k} cx={x} cy={y} rx="3.3" ry="1.5" fill={c} transform={`rotate(${rot} ${x} ${y})`} />
  );
  const flip = l.flip[3] < 0.5;
  const sx = flip ? R : L;
  return (
    <>
      {leaf(sx + (flip ? -2 : 2), T + 1, flip ? 40 : -40, '#5fbf5a', 0)}
      {leaf(sx + (flip ? 1 : -1), T + 4, flip ? -20 : 20, '#8fdc72', 1)}
      {leaf(CX + (flip ? -5 : 5), T - 3.2, flip ? -60 : 60, '#4aa653', 2)}
      <path
        d={flip ? `M${R + 0.5} ${T + 10} q3 -5 -1 -9` : `M${L - 0.5} ${T + 10} q-3 -5 1 -9`}
        fill="none"
        stroke="#4aa653"
        stroke-width="1"
        stroke-linecap="round"
      />
    </>
  );
}

export function moodOf(satisfaction: number): -1 | 0 | 1 {
  return satisfaction >= 65 ? 1 : satisfaction < 40 ? -1 : 0;
}

function FaceSvg({ p }: { p: Person }) {
  const l = lookFor(p);
  const mood = moodOf(p.satisfaction);
  const head = headPath(l);
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
      <rect width="64" height="64" fill={l.bg} />
      <HairBack l={l} />
      <Body l={l} />
      <Ears l={l} />
      <path d={head} fill={l.skin} />
      {l.heritage === 'synth' && <path d={head} fill="#fff" opacity=".12" transform="translate(-1.6 -1.2) scale(.94) translate(2 1.6)" />}
      <Marks l={l} />
      <Face l={l} mood={mood} />
      <HairFront l={l} />
      <Leaves l={l} />
    </svg>
  );
}

// --- public components ----------------------------------------------------------

interface PortraitProps {
  /** A person id; null or unknown draws an empty (vacant) seat. */
  id: PersonId | null | undefined;
  size?: number;
  /** Ring colour, e.g. 'var(--red)'. */
  ring?: string;
  /** Small status dot at the bottom-right corner. */
  dot?: string;
  onClick?: () => void;
}

export function Portrait({ id, size = 40, ring, dot, onClick }: PortraitProps) {
  const p = id ? S.game?.people[id] : undefined;
  const style = { width: `${size}px`, height: `${size}px`, ...(ring ? { '--ring': ring } : {}) } as JSX.CSSProperties;
  const gone = !!p && p.status !== 'active';
  return (
    <span class={`pw ${onClick ? 'tap' : ''}`} style={style} onClick={onClick} title={p ? fullName(p) : 'Vacant'}>
      {p ? (
        <span class={`pt ${gone ? 'gone' : ''}`}>
          <FaceSvg p={p} />
        </span>
      ) : (
        <span class="pt vacant" />
      )}
      {dot && p && <i class="pdot" style={{ background: dot, width: `${Math.max(7, size * 0.26)}px`, height: `${Math.max(7, size * 0.26)}px` }} />}
    </span>
  );
}

/** Portrait with name and title beside it. */
export function PersonBadge({ id, size = 36, sub, onClick }: { id: PersonId | null | undefined; size?: number; sub?: string; onClick?: () => void }) {
  const p = id ? S.game?.people[id] : undefined;
  return (
    <span class={`pbadge ${onClick ? 'tap' : ''}`} onClick={onClick}>
      <Portrait id={id} size={size} />
      <span class="grow">
        <span class="t">{p ? fullName(p) : 'Vacant'}</span>
        <span class="s">{sub ?? p?.title ?? ''}</span>
      </span>
    </span>
  );
}
