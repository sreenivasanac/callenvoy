import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type PressableStateCallbackType } from 'react-native';
import type { Call } from '../api';
import { callSeconds, costText, duration, ownerLabel, phone, statusLabel, stepIndex, when } from '../format';
import { useGo, useNow } from '../hooks';
import { border, callColumns, color, font, radius, space, useWide } from '../theme';
import { CallLine } from './CallLine';
import { Button, Pill, TableHead, text } from './ui';

/** Status pill plus the owner-state pill of a call. */
export function StatusBadge({ call }: { call: Call }) {
  const st = statusLabel(call);
  const owner = ownerLabel(call);
  return (
    <View style={s.badges}>
      {call.direction === 'inbound' && <Pill label="Incoming" tone="info" />}
      <Pill label={st.text} tone={st.tone} live={st.live} />
      {owner && <Pill label={owner.text} tone={owner.tone} live={owner.live} />}
    </View>
  );
}

export function CallList({ calls }: { calls: Call[] }) {
  const wide = useWide();
  const now = useNow(1000, calls.some((c) => !c.finished));
  return (
    <View>
      {wide && <TableHead titles={['Business', 'Goal', 'Length', 'Cost', 'Started']} flex={callColumns} />}
      <View role="list">
        {calls.map((c, i) => (
          <CallRow key={c.id} call={c} now={now} first={i === 0} />
        ))}
      </View>
    </View>
  );
}

/** One line about the result: the outcome summary, or the error. */
const summary = (c: Call) => c.outcome?.summary || c.error || null;

function CallRow({ call, now, first }: { call: Call; now: number; first: boolean }) {
  const wide = useWide();
  const len = duration(callSeconds(call, now));
  const started = when(call.created_at);
  const sum = summary(call);
  const cost = call.cost ? costText(call.cost) : ''; // an estimate; nothing for a call that never connected
  return (
    <View role="listitem" style={!first && s.divider}>
      <Pressable
        role="link"
        aria-label={`${call.business}, ${statusLabel(call).text}`}
        onPress={() => router.push(`/calls/${call.id}`)}
        style={(st: PressableStateCallbackType & { hovered?: boolean }) => [s.row, wide && s.cols, (st.hovered || st.pressed) && s.hover]}
      >
        {wide ? (
          <>
            <View style={{ flex: callColumns[0] }}>
              <Text style={s.biz} numberOfLines={1}>
                {call.business}
              </Text>
              {sum ? (
                <Text style={s.small} numberOfLines={1}>
                  {sum}
                </Text>
              ) : null}
            </View>
            <View style={{ flex: callColumns[1] }}>
              <StatusBadge call={call} />
            </View>
            <Text style={[s.small, { flex: callColumns[2] }]}>{len}</Text>
            <Text style={[s.small, { flex: callColumns[3] }]}>{cost}</Text>
            <Text style={[s.small, { flex: callColumns[4] }]}>{started}</Text>
          </>
        ) : (
          <>
            <View style={s.narrowTop}>
              <Text style={[s.biz, s.fill]}>{call.business}</Text>
              <StatusBadge call={call} />
            </View>
            {sum ? (
              <Text style={s.small} numberOfLines={1}>
                {sum}
              </Text>
            ) : null}
            <View style={s.narrowMeta}>
              <Text style={s.small}>{started}</Text>
              <Text style={s.small}>{len}</Text>
              {cost ? <Text style={s.small}>{cost}</Text> : null}
            </View>
          </>
        )}
      </Pressable>
    </View>
  );
}

/** A live call on Calls: who, the state, the time, and the call line. The whole card opens the call.
 *  A call that waits for the user gets the accent frame. */
export function LiveCallCard({ call }: { call: Call }) {
  const now = useNow();
  const go = useGo();
  const st = statusLabel(call);
  const needsYou = call.owner.state === 'alerting' || call.owner.state === 'ringing' || call.open_questions.some((q) => q.kind);
  return (
    <Pressable
      role="link"
      aria-label={`Open the call to ${call.business}, ${st.text}`}
      onPress={() => go(`/calls/${call.id}`)}
      style={(p: PressableStateCallbackType & { hovered?: boolean }) => [s.live, needsYou && s.liveAlert, (p.hovered || p.pressed) && !needsYou && s.liveHover]}
    >
      <View style={s.liveRow}>
        <View style={s.liveText}>
          <Text style={s.liveBiz} numberOfLines={1}>
            {call.business}
          </Text>
          <Text style={s.small}>{phone(call.number)}</Text>
        </View>
        <Text style={s.timer} aria-label="Call length">
          {duration(callSeconds(call, now))}
        </Text>
      </View>
      <StatusBadge call={call} />
      {call.direction === 'outbound' ? <CallLine at={stepIndex(call)} tone={st.tone} short /> : null}
    </Pressable>
  );
}

/** "No calls yet" with the two ways to start one. */
export function EmptyCalls() {
  const go = useGo();
  return (
    <View style={s.empty}>
      <Text style={[text.body, s.emptyTitle]}>No calls yet</Text>
      <Text style={[text.muted, s.center]}>Start a call here, or add CallEnvoy to an AI agent and ask it to call a business for you.</Text>
      <View style={s.emptyActions}>
        <Button label="New call" onPress={() => go('/new')} />
        <Button label="Add to an agent" kind="secondary" onPress={() => go('/agents')} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, alignItems: 'center', flexShrink: 1 },
  cols: { flexDirection: 'row', alignItems: 'center', gap: space.ml },
  divider: { borderTopWidth: border.thin, borderTopColor: color.line },
  row: { paddingVertical: space.ml, paddingHorizontal: space.xs, gap: space.xxs },
  hover: { backgroundColor: color.card2, borderRadius: radius.m },
  narrowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.ml },
  biz: { color: color.fg, fontSize: font.size.body, fontWeight: font.weight.semi },
  small: { color: color.muted, fontSize: font.size.s, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', paddingVertical: space.x4 - space.xs, paddingHorizontal: space.ml },
  emptyTitle: { fontSize: font.size.l, fontWeight: font.weight.bold, marginBottom: space.xs },
  center: { textAlign: 'center' },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.ml, marginTop: space.xl },
  narrowMeta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.l },
  live: { backgroundColor: color.card, borderWidth: border.thin, borderColor: color.line, borderRadius: radius.xl, padding: space.xxl, gap: space.m },
  liveAlert: { borderWidth: border.outline, borderColor: color.brand },
  liveHover: { borderColor: color.edge },
  liveRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.l },
  liveText: { flex: 1, minWidth: 0 },
  liveBiz: { fontFamily: font.display, color: color.fg, fontSize: font.size.big, fontWeight: font.weight.bold },
  timer: { fontFamily: font.display, color: color.fg, fontSize: font.size.h2, fontWeight: font.weight.bold, fontVariant: ['tabular-nums'] },
});
