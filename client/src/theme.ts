// Design tokens. Use only these values in styles.
// Two themes, light (default) and dark, which follows the device. Every colour is a CSS variable, so one
// StyleSheet serves both themes: `color.fg` is "var(--fg)", and themeCss() (added to the page once, at start)
// gives the variables their values. Change a colour in `palette` only.
// ponytail: CSS variables are web-only; a native app needs useColorScheme and a palette context instead.
import { useWindowDimensions } from 'react-native';

export const palette = {
  light: {
    bg: '#F7F3EC', // the page: warm off-white paper
    card: '#FFFFFF',
    card2: '#F1ECE3', // inset areas: code, hover, the meter
    line: '#E4DDD1', // hairlines between things
    edge: '#8F867A', // the border of a control (3:1 on white)
    fg: '#1A1F2B', // ink
    soft: '#39404E', // secondary body text
    muted: '#5C6370', // helper text (AA on bg and on card)
    link: '#2536C4',
    brand: '#2A3BD8', // the one accent: "you act here" (primary buttons, the alert, a call that needs you)
    onAccent: '#FFFFFF', // text on brand
    secondary: '#E9E3D8', // secondary button, switch off
    danger: '#B3261E', // danger button, error box border
    onDanger: '#FFFFFF',
    selected: '#E3E7FD', // selected tab, choice, the transcript line that plays
    onSelected: '#1B2AA6',
    ok: '#1C7C4A', // talking / live, the go button, meter bars
    okInk: '#FFFFFF', // text on ok
    okSoft: '#E1F2E7',
    okLine: '#9FD2B3',
    okText: '#17603A',
    warn: '#B7791F', // on hold, a question that waits
    questionBg: '#FBEFD3',
    questionInk: '#74480A',
    bad: '#C4352B',
    err: '#A82A21',
    errBg: '#FCE9E6',
    blockedInk: '#7E211A',
    info: '#2F6FA8', // dialing, in the menu, an incoming call
    infoBg: '#E2ECF6',
    infoInk: '#234C73',
    pill: '#ECE6DB', // neutral pill
    bubble: '#F3EFE8', // what the other side said
    bubbleAi: '#E3E7FD', // what the AI said
    scrim: 'rgba(26,31,43,0.45)',
    topbar: 'rgba(247,243,236,0.92)',
    shadow: 'rgba(60,45,20,0.10)',
  },
  dark: {
    bg: '#151412',
    card: '#1E1D1A',
    card2: '#272622',
    line: '#34322D',
    edge: '#7A756B',
    fg: '#F2EFE9',
    soft: '#D3CFC6',
    muted: '#A9A49A',
    link: '#A3ACFF',
    brand: '#98A2FF',
    onAccent: '#0E1030',
    secondary: '#33312C',
    danger: '#E8776B',
    onDanger: '#2A0906',
    selected: '#272B57',
    onSelected: '#D3D8FF',
    ok: '#5FD08F',
    okInk: '#062313',
    okSoft: '#15301F',
    okLine: '#2C6B48',
    okText: '#A6E3BF',
    warn: '#E0B050',
    questionBg: '#3A2C0D',
    questionInk: '#F1D08C',
    bad: '#F08A7E',
    err: '#FFA89E',
    errBg: '#3B1C18',
    blockedInk: '#FFD2CC',
    info: '#7DB7E8',
    infoBg: '#1C2E40',
    infoInk: '#B9D6F0',
    pill: '#33312C',
    bubble: '#2A2925',
    bubbleAi: '#272B57',
    scrim: 'rgba(0,0,0,0.6)',
    topbar: 'rgba(21,20,18,0.92)',
    shadow: 'rgba(0,0,0,0.4)',
  },
} as const;

type ColorName = keyof typeof palette.light;
const names = Object.keys(palette.light) as ColorName[];
export const color = Object.fromEntries(names.map((k) => [k, `var(--${k})`])) as Record<ColorName, string>;

/** The CSS that gives the colour variables their values (light, and dark when the device asks for it), plus the
 *  one animation (a slow pulse on the dot of a call that needs you; off with reduced motion). */
export function themeCss() {
  const vars = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `--${k}:${v}`).join(';');
  return (
    `:root{${vars(palette.light)}}@media (prefers-color-scheme: dark){:root{${vars(palette.dark)}}}` +
    '@keyframes ce-pulse{0%,100%{box-shadow:0 0 0 0 var(--brand)}50%{box-shadow:0 0 0 6px transparent}}' +
    '[data-pulse="on"]{animation:ce-pulse 1.6s ease-out infinite}' +
    '@media (prefers-reduced-motion: reduce){[data-pulse="on"]{animation:none}}'
  );
}

export const space = { xxs: 2, bar: 3, xs: 4, s: 6, sm: 8, seg: 9, m: 10, input: 11, ml: 12, l: 14, xl: 16, btn: 18, xxl: 20, x3: 24, x4: 32, x5: 48 } as const;

export const radius = { bar: 2, s: 8, m: 10, l: 12, xl: 16, pill: 999 } as const;

export const font = {
  size: { xs: 13, s: 14, m: 14, base: 15, body: 16, l: 17, xl: 19, h3: 17, big: 21, h2: 24, h1: 30, heroNarrow: 38, hero: 60 },
  weight: { normal: '400', semi: '600', bold: '700', heavy: '800' },
  // Two faces (files in public/fonts, declared in index.html): Bricolage Grotesque for headings, the name and
  // call timers; Instrument Sans for everything else (the page default, also set in index.html).
  display: "'Bricolage Grotesque', 'Instrument Sans', system-ui, sans-serif",
  body: "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  monoLineHeight: 1.5,
  heroLineHeight: 1.02,
  headLineHeight: 1.15,
  tracking: { brand: -0.3, hero: -1.5, head: -0.4 },
} as const;

export const lineHeight = 1.55;
export const border = { thin: 1, edge: 3, outline: 2 } as const;
export const meter = { height: 22, bars: [6, 12, 18, 10, 20, 14, 8, 16, 22, 12] } as const;
export const countdownHeight = 8;
export const callColumns = [2.4, 1.2, 0.5, 0.7, 0.9] as const; // call list columns on wide screens: business, status, length, cost, started
export const peopleColumns = [2.1, 0.7, 0.9, 0.5, 1.1, 1.6, 1.7] as const; // People table on wide screens: person, joined, last active, calls, minutes, state, actions
export const heroColumns = [5, 6] as const; // product page, wide screens: the headline | the example call
export const readWidth = 680; // a column of running text (privacy, terms, FAQ): under 80 characters a line
export const gridMinWidth = 240; // product page: the narrowest tile in a wrapping grid (one per row on phones)
export const stepBadge = 28; // product page and welcome card: the round step number
export const menuWidth = 260; // the account menu under the top bar
/** Keyboard focus on controls that also show a selected state (transcript lines, seek bar): unlike the brand border. */
export const focusRing = { color: color.fg, width: border.outline, offset: space.xxs } as const;
export const seekBar = { hit: 28, track: 6, thumb: 16, minWidth: 120 } as const; // recording seek bar
export const transcriptHeight = 460;
export const lineMaxWidth = '88%';
export const pressedOpacity = 0.85;
export const disabledOpacity = 0.5;
export const maxContent = 1080;
export const gateWidth = 420;
export const breakpoint = 768;

/** Wide layout (desktop) at 768 px and up, as in the mockups. */
export function useWide() {
  return useWindowDimensions().width >= breakpoint;
}
