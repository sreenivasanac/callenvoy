import { usePathname } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import type { Call } from '../api';
import { useCalls, useGo, useNow } from '../hooks';
import { border, color, font, radius, space, useWide } from '../theme';
import { Button, PULSE } from './ui';

export function secondsLeft(call: Call, now: number) {
  return call.owner.alert_until ? Math.max(0, Math.ceil((Date.parse(call.owner.alert_until) - now) / 1000)) : null;
}

/** The banner on every screen while a call is alerting the owner: an accent frame, a pulsing dot, and the green
 *  answer button. Calm colours, but nothing else on the page looks like it. */
export function AlertBanner() {
  const { calls, acknowledge } = useCalls();
  const go = useGo();
  const now = useNow();
  const wide = useWide();
  const path = usePathname();
  // Not on the page of that call: its owner panel shows the alert there.
  const call = calls?.find((c) => !c.finished && c.owner.state === 'alerting' && path !== `/calls/${c.id}`);
  if (!call) return null;
  const left = secondsLeft(call, now);
  const transfer = call.mode === 'transfer' || !!call.connect_when;
  const phoneNext = transfer && call.reach === 'app_then_phone' && !!left;
  const open = () => {
    acknowledge(call.id);
    go(`/calls/${call.id}`);
  };
  return (
    <View style={s.banner}>
      <View style={s.dot} aria-hidden {...PULSE} />
      <View style={s.textBox}>
        {/* Only the fixed text is announced; the seconds stay out of the live region. */}
        <Text role="alert" style={s.title}>
          A person answered at {call.business}
        </Text>
        <Text style={s.sub}>{(transfer ? 'They are waiting for you' : 'The AI is talking to them') + (phoneNext ? `. Your phone rings in ${left} s.` : '.')}</Text>
      </View>
      <View style={[s.actions, !wide && s.actionsNarrow]}>
        <View style={!wide && s.grow}>
          <Button label={transfer ? 'Join now' : 'Listen'} kind="go" onPress={open} full />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.l,
    backgroundColor: color.card,
    borderWidth: border.outline,
    borderColor: color.brand,
    borderRadius: radius.xl,
    paddingVertical: space.l,
    paddingHorizontal: space.xl,
  },
  dot: { width: space.ml, height: space.ml, borderRadius: radius.pill, backgroundColor: color.brand },
  textBox: { flex: 1, minWidth: 200 },
  title: { fontFamily: font.display, color: color.fg, fontSize: font.size.xl, fontWeight: font.weight.bold },
  sub: { color: color.soft, fontSize: font.size.base, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: space.sm },
  actionsNarrow: { width: '100%' },
  grow: { flex: 1 },
});
