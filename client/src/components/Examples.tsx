// Recorded example calls (public/examples): the card with the call line, the player and the transcript, and the
// /examples page that lists them.
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WEB_BASE } from '../api';
import { duration } from '../format';
import { sampleStep, sampleToCall, type Example, type SampleCall } from '../sample';
import { border, color, font, radius, space } from '../theme';
import { TranscriptLog } from './CallDetail';
import { CallLine } from './CallLine';
import { Loading } from './Loading';
import { RecordingPlayer, usePlayer } from './RecordingPlayer';
import { Pill, T, text } from './ui';

const DIR = `${WEB_BASE}/examples`;
const STEP_TONE = ['info', 'info', 'hold', 'ok', 'ok', 'done'] as const;

function useJson<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let stop = false;
    setError(null);
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: T) => !stop && setData(j))
      .catch(() => !stop && setError('The example call could not be loaded. Check your connection and try again.'));
    return () => {
      stop = true;
    };
  }, [url, tick]);
  return { data, error, retry: () => setTick((t) => t + 1) };
}

export const useExamples = () => useJson<Example[]>(`${DIR}/index.json`);

/** One recorded call: what was asked, the call line that follows the recording, the player, the transcript
 *  (click a line to jump), and the result. `id`: for a link that scrolls here. */
export function ExampleCard({ example, id, transcriptHeight = 300 }: { example: Example; id?: string; transcriptHeight?: number }) {
  const { data: sample, error, retry } = useJson<SampleCall>(`${DIR}/${example.transcript}`);
  const url = `${DIR}/${example.audio}`;
  const player = usePlayer(url, example.duration_seconds);
  const call = useMemo(() => (sample ? sampleToCall(sample) : null), [sample]);
  const step = sample ? sampleStep(sample.lines, player.time, player.duration) : 0;
  const started = player.playing || player.time > 0;
  return (
    <View nativeID={id} style={s.card} role="region" aria-label={`Example call: ${example.title}`}>
      <View style={s.head}>
        <View style={s.fill}>
          <Text style={text.fine}>{`A real call, ${duration(example.duration_seconds)} long`}</Text>
          <T v="h3" level={3} style={s.title}>
            {example.business}
          </T>
        </View>
        {step === 5 ? <Pill label="Done" tone="done" /> : started ? <Pill label="Playing" tone="info" live /> : null}
      </View>
      {example.note ? <Text style={[text.base, s.note]}>{example.note}</Text> : null}
      <View style={s.asked}>
        <Text style={text.label}>The user asked their agent</Text>
        <Text style={text.base}>{`“${example.asked}”`}</Text>
      </View>
      <CallLine at={started ? step : -1} tone={STEP_TONE[step]} short />
      <RecordingPlayer player={player} url={url} />
      {call ? <TranscriptLog call={call} player={player} bare height={transcriptHeight} /> : <Loading error={error} retry={retry} label="Loading the transcript" />}
      <View style={s.result}>
        <Text style={text.label}>The result</Text>
        <Text style={[text.base, s.strong]}>{example.outcome}</Text>
      </View>
    </View>
  );
}

/** /examples: every recorded call. */
export function ExamplesList() {
  const { data, error, retry } = useExamples();
  if (!data) return <Loading error={error} retry={retry} label="Loading the example calls" />;
  return (
    <View style={s.list}>
      {data.map((e) => (
        <View key={e.slug} style={s.item}>
          <T v="h2" style={s.itemTitle}>
            {e.title}
          </T>
          <ExampleCard example={e} id={e.slug} transcriptHeight={420} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  card: { backgroundColor: color.card, borderWidth: border.thin, borderColor: color.line, borderRadius: radius.xl, padding: space.xxl, gap: space.l, boxShadow: `0 18px 40px ${color.shadow}` },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.ml },
  title: { fontFamily: font.display, fontSize: font.size.big },
  note: { color: color.muted },
  asked: { backgroundColor: color.card2, borderRadius: radius.m, paddingVertical: space.ml, paddingHorizontal: space.l },
  result: { borderTopWidth: border.thin, borderTopColor: color.line, paddingTop: space.ml },
  strong: { fontWeight: font.weight.semi },
  list: { gap: space.x5 },
  item: { gap: space.ml },
  itemTitle: { marginBottom: 0 },
});
