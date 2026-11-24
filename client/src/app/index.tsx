import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Call } from '../api';
import { CallList, EmptyCalls, LiveCallCard } from '../components/CallList';
import { Loading } from '../components/Loading';
import { useWelcome, WelcomeCard } from '../components/Welcome';
import { Card, Chips, Screen, T, text } from '../components/ui';
import { useCalls } from '../hooks';
import { space, useWide } from '../theme';

type Filter = 'all' | 'live' | 'done' | 'not_done';
const FILTERS = [
  ['all', 'All'],
  ['live', 'Live'],
  ['done', 'Done'],
  ['not_done', 'Not done'],
] as const;
// "Done" is a finished call whose goal was reached; every other finished call is "Not done".
const shows = (c: Call, f: Filter) =>
  f === 'all' || (f === 'live' ? !c.finished : c.finished && (c.outcome?.result === 'done') === (f === 'done'));

/** Calls (home). Each call shows once: live calls as cards on top, finished calls in the list below. */
export default function CallsScreen() {
  const { calls, error, refresh } = useCalls();
  const [filter, setFilter] = useState<Filter>('all');
  const [welcome, hideWelcome] = useWelcome();
  const wide = useWide();
  const live = calls?.filter((c) => !c.finished && shows(c, filter)) ?? [];
  const past = calls?.filter((c) => c.finished && shows(c, filter)) ?? [];
  return (
    <Screen>
      {welcome ? <WelcomeCard onHide={hideWelcome} /> : null}
      <View style={s.head}>
        <T v="h1" style={s.noMargin}>
          Calls
        </T>
        {calls?.length ? <Chips label="Show calls" value={filter} options={FILTERS} onChange={setFilter} /> : null}
      </View>
      {!calls ? (
        <Loading error={error} retry={refresh} label="Loading calls" />
      ) : calls.length === 0 ? (
        <Card>
          <EmptyCalls />
        </Card>
      ) : (
        <>
          {live.length ? (
            <View role="region" aria-label="Live calls" style={[s.live, wide && s.liveWide]}>
              {live.map((c) => (
                <View key={c.id} style={wide && live.length > 1 ? s.half : undefined}>
                  <LiveCallCard call={c} />
                </View>
              ))}
            </View>
          ) : filter === 'live' ? (
            <Card>
              <Text style={[text.muted, s.none]}>No call is live right now.</Text>
            </Card>
          ) : null}
          {past.length ? (
            <Card label="Earlier calls">
              {live.length ? (
                <T v="h2" level={2}>
                  Earlier
                </T>
              ) : null}
              <CallList calls={past} />
            </Card>
          ) : filter === 'done' || filter === 'not_done' ? (
            <Card>
              <Text style={[text.muted, s.none]}>No calls with this status.</Text>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space.ml },
  noMargin: { marginBottom: 0 },
  none: { paddingVertical: space.xl, textAlign: 'center' },
  live: { gap: space.ml },
  liveWide: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { flexGrow: 1, flexBasis: '45%', minWidth: 0 }, // two live calls side by side on wide screens
});
