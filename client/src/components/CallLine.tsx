// The call as a phone line with five stops. Used on the call page, on live call cards and on the product page.
import { StyleSheet, Text, View } from 'react-native';
import { STEPS, type Tone } from '../format';
import { border, color, font, radius, space, useWide } from '../theme';

const SHORT_STEPS = ['Dialing', 'Menu', 'Hold', 'Talking', 'Ended']; // phone widths
const TONE_COLOR: Partial<Record<Tone, string>> = { info: color.info, hold: color.warn, ok: color.ok, alert: color.brand };

/** The call as a phone line with five stops (Dialing, In menu, On hold, Talking, Ended): stops behind are
 *  filled, the current one is larger and takes the colour of the call's state, the ones ahead are empty.
 *  `at` is the index of the current stop (STEPS.length: the call has ended). */
export function CallLine({ at, tone = 'info', short }: { at: number; tone?: Tone; short?: boolean }) {
  const wide = useWide() && !short; // `short`: one-word labels also on wide screens (a narrow card)
  const now = TONE_COLOR[tone] ?? color.info;
  return (
    <View style={s.track} role="list" aria-label="Call progress">
      {STEPS.map((label, i) => {
        const done = i < at;
        const here = i === at;
        return (
          <View key={label} role="listitem" aria-current={here ? 'step' : undefined} style={s.stop}>
            <View style={s.rail}>
              <View style={[s.wire, i === 0 && s.wireNone, (done || here) && s.wireDone]} />
              <View style={[s.knob, done && s.knobDone, here && [s.knobNow, { backgroundColor: now, borderColor: now }]]} />
              <View style={[s.wire, i === STEPS.length - 1 && s.wireNone, done && s.wireDone]} />
            </View>
            <Text style={[s.stopText, !wide && s.stopTextNarrow, done && s.stopTextDone, here && s.stopTextNow]}>{wide ? label : SHORT_STEPS[i]}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  track: { flexDirection: 'row', marginTop: space.s },
  stop: { flex: 1, alignItems: 'center', gap: space.s },
  rail: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', height: space.xl },
  wire: { flex: 1, height: border.outline, backgroundColor: color.line },
  wireDone: { backgroundColor: color.fg },
  wireNone: { backgroundColor: 'transparent' },
  knob: { width: space.m, height: space.m, borderRadius: radius.pill, borderWidth: border.outline, borderColor: color.edge, backgroundColor: color.card },
  knobDone: { backgroundColor: color.fg, borderColor: color.fg },
  knobNow: { width: space.xl, height: space.xl },
  stopText: { color: color.muted, fontSize: font.size.s, textAlign: 'center' },
  stopTextNarrow: { fontSize: font.size.xs },
  stopTextDone: { color: color.soft },
  stopTextNow: { color: color.fg, fontWeight: font.weight.bold },
});
