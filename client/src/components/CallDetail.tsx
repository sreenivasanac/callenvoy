// Parts of the call screen: header, transcript (with the recording player when finished), question box, outcome, call options.
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type PressableStateCallbackType, type ScrollViewInstance } from 'react-native';
import { api, ApiError, type Call, type Line, type Mode, type Question } from '../api';
import { callSeconds, clock, costText, duration, ENDED_BY, lineAt, mergeLines, modeLine, money, phone, RESULT_TEXT, statusLabel, stepIndex, when } from '../format';
import { useNow } from '../hooks';
import { focusRingProps } from '../platform/focus';
import { border, color, font, lineHeight, lineMaxWidth, radius, space, transcriptHeight, useWide } from '../theme';
import { CallLine } from './CallLine';
import { StatusBadge } from './CallList';
import { RecordingPlayer, usePlayer, type PlayerControl } from './RecordingPlayer';
import { Button, Card, Disclosure, LiveDot, Note, Pill, Segmented, SwitchRow, T, TextField, text } from './ui';

const HAND_SCROLL_PAUSE_MS = 5000; // no automatic scrolling this long after the reader scrolled the transcript
const AUTO_SCROLL_MS = 1000; // scroll events this soon after an automatic scroll are not the reader's

export function CallHeader({ call }: { call: Call }) {
  const wide = useWide();
  const now = useNow(1000, !call.finished);
  const inbound = call.direction === 'inbound';
  const times = call.ended_at
    ? `${when(call.created_at)} – ${clock(call.ended_at)}`
    : `Started ${clock(call.created_at)}`;
  return (
    <Card>
      <View style={[s.head, !wide && s.headNarrow]}>
        <View style={s.fill}>
          <T v="h2" style={s.h2}>
            {call.business}
          </T>
          <View style={s.meta}>
            {call.number ? <Text style={s.metaItem}>{phone(call.number)}</Text> : null}
            <Text style={s.metaItem}>{times}</Text>
            {call.calling_number && !call.finished ? <Text style={s.metaItem}>{`Caller ID ${phone(call.calling_number)}`}</Text> : null}
          </View>
        </View>
        <View style={[s.right, !wide && s.rightNarrow]}>
          <StatusBadge call={call} />
          <Text style={[s.timer, !wide && s.timerNarrow]} aria-label="Call length">
            {duration(callSeconds(call, now))}
          </Text>
        </View>
      </View>
      {inbound ? (
        <Text style={[text.soft, s.goal]}>A business called your CallEnvoy number. The call was forwarded to your phone, so there is no transcript.</Text>
      ) : call.finished ? null : (
        <>
          <Text style={[text.body, s.goal]}>{call.goal}</Text>
          <Text style={[text.fine, s.mode]}>{modeLine(call)}</Text>
          {call.secrets_allowed?.length ? <Text style={[text.fine, s.mode]}>{`May use: ${call.secrets_allowed.join(', ')}`}</Text> : null}
          <CallLine at={stepIndex(call)} tone={statusLabel(call).tone} />
        </>
      )}
    </Card>
  );
}

/** Finished call: the recording player above the transcript, in one card. */
export function CallRecording({ call }: { call: Call }) {
  const rec = call.recorded ? call.recordings?.[0] : undefined;
  if (rec) return <PlayerTranscript call={call} url={rec.url} seconds={rec.duration_seconds} />;
  const note = !call.recorded ? (
    <T v="muted">
      <Text style={s.strong}>Not recorded.</Text> Recording was off for this call.
    </T>
  ) : (call.talk_seconds ?? 0) > 0 ? (
    <T v="muted">The recording is still being processed. It shows here in a minute or two.</T>
  ) : null;
  return <TranscriptLog call={call} top={note} />;
}

/** The recording player above the transcript, in one card. */
export function PlayerTranscript({ call, url, seconds, level }: { call: Call; url: string; seconds: number; level?: 3 }) {
  const player = usePlayer(url, seconds);
  return <TranscriptLog call={call} title="Recording and transcript" player={player} top={<RecordingPlayer player={player} url={url} />} level={level} />;
}

/**
 * Transcript. Live: keeps the scroll position unless the reader is at the bottom.
 * With a player: lines with `at` jump there, and the playing line is highlighted and kept in view.
 */
export function TranscriptLog({ call, title, player, top, level, bare, height }: { call: Call; title?: string; player?: PlayerControl; top?: ReactNode; level?: 3; bare?: boolean; height?: number }) {
  const lines = useMemo(() => mergeLines(call.transcript ?? []), [call.transcript]);
  const ref = useRef<ScrollViewInstance>(null);
  const atBottom = useRef(true);
  const boxes = useRef<Record<number, { y: number; h: number }>>({});
  const view = useRef({ y: 0, h: 0 });
  const handAt = useRef(0);
  const autoAt = useRef(0);
  const them = call.business.split(' ')[0];
  const start = Date.parse(call.created_at);
  const heading = title ?? (call.finished ? 'Transcript' : 'Live transcript');
  const current = player ? lineAt(lines, player.time) : -1;
  const playing = !!player?.playing;

  useEffect(() => {
    if (!playing || current < 0 || Date.now() - handAt.current < HAND_SCROLL_PAUSE_MS) return;
    const box = boxes.current[current];
    const v = view.current;
    if (!box || (box.y >= v.y && box.y + box.h <= v.y + v.h)) return;
    autoAt.current = Date.now();
    ref.current?.scrollTo({ y: Math.max(0, box.y - space.ml), animated: true });
  }, [current, playing]);

  const log = (
      <ScrollView
        ref={ref}
        style={[s.lines, height ? { maxHeight: height } : null]}
        contentContainerStyle={s.linesInner}
        role="log"
        aria-live={call.finished ? undefined : 'polite'}
        aria-label={call.finished ? 'Transcript' : heading}
        scrollEventThrottle={100}
        onLayout={(e) => (view.current.h = e.nativeEvent.layout.height)}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          view.current = { y: contentOffset.y, h: layoutMeasurement.height };
          atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - space.x3;
          if (Date.now() - autoAt.current > AUTO_SCROLL_MS) handAt.current = Date.now();
        }}
        onContentSizeChange={() => !call.finished && atBottom.current && ref.current?.scrollToEnd({ animated: false })}
      >
        {lines.length === 0 ? (
          <Text style={[s.event, s.eventText]}>{call.finished ? 'No transcript for this call.' : 'Nothing said yet. Lines show here as the call goes on.'}</Text>
        ) : (
          lines.map((l, i) => (
            <View key={l.n} onLayout={(e) => (boxes.current[i] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}>
              <LineView line={l} them={them} start={start} now={i === current} onJump={player && l.at != null ? () => player.seek(l.at!, true) : undefined} />
            </View>
          ))
        )}
      </ScrollView>
  );
  if (bare) return log;
  return (
    <Card label={heading}>
      <View style={s.cardHead}>
        <T v="h2" style={s.h2} level={level}>
          {heading}
        </T>
        {call.finished ? (
          <T v="fine">{`${lines.length} line${lines.length === 1 ? '' : 's'}`}</T>
        ) : (
          <View style={s.inline}>
            <LiveDot />
            <T v="fine">Updating</T>
          </View>
        )}
      </View>
      {top ? <View style={s.top}>{top}</View> : null}
      {log}
    </Card>
  );
}

function LineView({ line, them, start, now, onJump }: { line: Line; them: string; start: number; now: boolean; onJump?: () => void }) {
  if (line.who === 'event')
    return (
      <View style={s.event}>
        <Text style={s.eventText}>{line.text}</Text>
      </View>
    );
  const who = line.who === 'them' ? them : line.who === 'ai' ? 'AI' : 'You';
  const t = Date.parse(line.t);
  // Time from the start of the recording when known, else from the start of the call.
  const at = line.at != null ? duration(line.at) : Number.isNaN(t) ? null : duration((t - start) / 1000);
  const bubble = [s.line, line.who === 'ai' && s.lineAi, line.who === 'owner' && s.lineOwner];
  const body = (
    <>
      <Text style={s.who}>
        {who}
        {at ? <Text style={s.whoTime}>{'  ' + at}</Text> : null}
      </Text>
      <Text style={text.base}>{line.text}</Text>
    </>
  );
  if (!onJump) return <View style={[bubble, now && s.lineNow]}>{body}</View>;
  return (
    <Pressable
      role="button"
      aria-label={`Jump to ${at}. ${who}: ${line.text}`}
      aria-current={now ? 'true' : undefined}
      onPress={onJump}
      {...focusRingProps()}
      style={(st: PressableStateCallbackType & { hovered?: boolean }) => [bubble, s.lineJump, st.hovered && s.lineHover, now && s.lineNow]}
    >
      {body}
    </Pressable>
  );
}

/** Open question from the AI with an answer box. Works while the owner listens. */
export function QuestionBox({ callId, q }: { callId: string; q: Question }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!answer.trim()) return setError('Type an answer first.');
    setBusy(true);
    setError(null);
    try {
      await api.answer(callId, q.id, answer.trim());
      setSent(true); // the question leaves the list on the next update
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <View style={s.question} role="region" aria-label="Question from the AI">
      <Text style={s.qTitle}>The AI needs an answer. The person on the phone is waiting.</Text>
      <Text style={s.q}>{q.question}</Text>
      {sent ? (
        <Note kind="saved">Answer sent. The AI tells them now.</Note>
      ) : (
        <>
          <TextField label="Your answer" rows={2} value={answer} onChangeText={setAnswer} maxLength={1000} error={error} />
          <Button label={busy ? 'Sending...' : 'Send answer'} busy={busy} onPress={send} />
        </>
      )}
    </View>
  );
}

/** A request about a protected detail: allow a saved one on this call, or type one for it. Only the console can
 *  answer, and the person on the phone is waiting, so this sits at the top of the call page. */
export function SecretBox({ callId, q }: { callId: string; q: Question }) {
  const typed = q.kind === 'secret';
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [sent, setSent] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const send = async (allow: boolean) => {
    setError(null);
    setFieldError(null);
    if (allow && typed && !value.trim()) return setFieldError(`Type the ${q.label ?? 'detail'} first.`);
    setBusy(allow ? 'yes' : 'no');
    try {
      await api.answerSecret(callId, q.id, allow, allow && typed ? value.trim() : undefined);
      setValue(''); // the value does not stay in the page
      setSent(allow); // the request leaves the list on the next update
    } catch (e) {
      if (e instanceof ApiError && e.field === 'value') setFieldError(e.message);
      else setError((e as Error).message);
    }
    setBusy(null);
  };
  return (
    <View style={s.question} role="region" aria-label="The call needs your OK">
      <Text role="alert" style={s.qTitle}>
        The call needs your OK. The person on the phone is waiting.
      </Text>
      <Text style={s.q}>{q.question}</Text>
      {sent != null ? (
        <Note kind="saved">{sent ? (typed ? 'Given. It is said on the call now, and not stored.' : 'Allowed. It is given on the call now.') : 'Not given. The AI says it cannot share that.'}</Note>
      ) : (
        <>
          {typed ? (
            <TextField
              label={q.label ?? 'The detail'}
              value={value}
              onChangeText={setValue}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              maxLength={200}
              help="Used on this call only. It is not stored, not shown in the transcript, and the AI model does not see it."
              error={fieldError}
              onSubmitEditing={() => void send(true)}
            />
          ) : (
            <Text style={text.fine}>The AI model does not see the value. The server says it or keys it in, and it is masked in the transcript.</Text>
          )}
          {error ? (
            <Text role="alert" style={text.err}>
              {error}
            </Text>
          ) : null}
          <View style={s.answers}>
            <Button label={busy === 'yes' ? 'Sending...' : typed ? 'Give it' : 'Allow'} busy={busy === 'yes'} disabled={busy === 'no'} onPress={() => void send(true)} />
            <Button label={typed ? "Don't give" : "Don't allow"} kind="secondary" busy={busy === 'no'} disabled={busy === 'yes'} onPress={() => void send(false)} />
          </View>
        </>
      )}
    </View>
  );
}

const LIVE_MODES = [
  ['handle', 'The AI handles the call'],
  ['transfer', 'Bring me on when a person answers'],
] as const;

/** While the call runs: who handles it, and whether the user is alerted when a person answers. The AI is told at once. */
export function ModeSwitch({ call }: { call: Call }) {
  // What the user chose shows at once; the call's own values take over again when the next update brings them.
  const [chosen, setChosen] = useState<{ mode?: Mode; alert_on_human?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setChosen({}), [call.mode, call.alert_on_human]);
  const change = async (patch: { mode?: Mode; alert_on_human?: boolean }) => {
    setError(null);
    setChosen((c) => ({ ...c, ...patch }));
    try {
      await api.setMode(call.id, patch);
    } catch (e) {
      setChosen({});
      setError((e as Error).message);
    }
  };
  const mode = chosen.mode ?? call.mode;
  return (
    <Card label="How this call is handled">
      <T v="h3" level={2}>
        How this call is handled
      </T>
      <Segmented
        label="When a person answers"
        value={mode}
        options={LIVE_MODES}
        onChange={(m) => void change({ mode: m })}
        help={mode === 'transfer' ? 'The AI gets through the menu and the hold, then brings you on.' : 'The AI does the whole call. You can still listen or join.'}
      />
      <SwitchRow title="Alert me when a person answers" value={chosen.alert_on_human ?? call.alert_on_human} onChange={(v) => void change({ alert_on_human: v })} />
      {error ? (
        <Text role="alert" style={text.err}>
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

/** A finished call: did it reach its goal, what to do next, the facts it brought back, and how it went. */
export function OutcomeCard({ call, level }: { call: Call; level?: 3 }) {
  const st = statusLabel(call);
  const o = call.outcome;
  const details = Object.entries(o?.details ?? {}).filter(([, v]) => v != null && v !== '');
  const e = call.evals;
  const cost = call.cost;
  // Plain measures of the call, each shown only when there is something to say.
  const went: [string, string][] = [];
  if (e?.seconds_to_person != null) went.push(['A person answered after', duration(e.seconds_to_person)]);
  else if (e && call.status === 'completed' && !e.reached_person) went.push(['A person answered', 'No']);
  if (e?.keys_pressed) went.push(['Menu keys pressed', String(e.keys_pressed)]);
  if (e?.questions_asked) went.push(['Questions it asked you', String(e.questions_asked)]);
  if (call.owner_seconds) went.push(['You on the call', duration(call.owner_seconds)]);
  if (e?.ended_by) went.push(['Ended by', ENDED_BY[e.ended_by]]);
  if (call.talk_seconds) went.push(['Length', duration(call.talk_seconds)]);
  return (
    <Card label="How it went">
      <View style={[s.inline, s.result]}>
        <T v="h2" level={level} style={s.h2}>
          {o ? RESULT_TEXT[o.result] ?? 'Outcome' : call.status === 'failed' ? 'The call did not go through' : 'Ended without an outcome'}
        </T>
        <Pill label={st.text} tone={st.tone} />
      </View>
      {call.error ? <Note kind="errsum">{call.error}</Note> : null}
      {o?.summary ? <Text style={[text.body, s.summary]}>{o.summary}</Text> : null}
      {e?.follow_up ? (
        <Text style={[text.body, s.summary]}>
          <Text style={s.strong}>Next: </Text>
          {e.follow_up}
        </Text>
      ) : null}
      {details.map(([k, v]) => (
        <View key={k} style={s.kv}>
          <Text style={[text.base, s.kvKey]}>{label(k)}</Text>
          <Text style={[text.base, s.fill]}>{typeof v === 'string' ? v : JSON.stringify(v)}</Text>
        </View>
      ))}
      {went.length || cost ? <Text style={[text.subhead, s.subhead]}>How it went</Text> : null}
      {went.map(([k, v]) => (
        <View key={k} style={s.kv}>
          <Text style={[text.base, s.kvKey]}>{k}</Text>
          <Text style={[text.base, s.fill, s.num]}>{v}</Text>
        </View>
      ))}
      {cost ? (
        <>
          <View style={s.kv}>
            <Text style={[text.base, s.kvKey]}>Estimated cost</Text>
            <View style={s.fill}>
              <Text style={[text.base, s.num]}>{costText(cost)}</Text>
              <Text style={[text.fine, s.num]}>
                {`Phone ${money(cost.parts.phone)}, hearing ${money(cost.parts.hearing)}, AI model ${
                  cost.parts.ai == null ? 'not known' : money(cost.parts.ai)
                }, voice ${money(cost.parts.voice)}`}
              </Text>
            </View>
          </View>
          <Text style={[text.fine, s.costNote]}>
            {`An estimate from list prices. ${cost.complete ? '' : 'The price of your own AI service is not known, so it is left out. '}Your own providers bill it. CallEnvoy bills nothing.`}
          </Text>
        </>
      ) : null}
      {call.answered_questions.length ? (
        <>
          <Text style={[text.subhead, s.subhead]}>Questions asked</Text>
          {call.answered_questions.map((q, i) => (
            <View key={q.id} style={i > 0 && s.answered}>
              <Text style={[text.m, s.strong]}>{q.question}</Text>
              <Text style={[text.m, { color: color.soft }]}>{q.answer}</Text>
            </View>
          ))}
        </>
      ) : null}
    </Card>
  );
}

const label = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');

/** What the call was asked to do and how, collapsed (finished calls). */
export function CallRequest({ call }: { call: Call }) {
  return (
    <Card label="Call options">
      <Disclosure title="Call options">
        <View style={s.request}>
          <Text style={text.label}>Goal</Text>
          <Text style={text.soft}>{call.goal}</Text>
          <Text style={text.fine}>{modeLine(call)}</Text>
          {call.calling_number ? <Text style={text.fine}>{`Caller ID ${phone(call.calling_number)}`}</Text> : null}
          <Text style={text.fine}>{call.recorded ? 'Recorded' : 'Not recorded'}</Text>
          {call.secrets_allowed?.length ? <Text style={text.fine}>{`May use: ${call.secrets_allowed.join(', ')}`}</Text> : null}
        </View>
      </Disclosure>
    </Card>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  h2: { marginBottom: 0 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.ml },
  headNarrow: { flexDirection: 'column' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl, rowGap: space.xxs, marginTop: space.xs },
  metaItem: { color: color.muted, fontSize: font.size.base, fontVariant: ['tabular-nums'] },
  right: { alignItems: 'flex-end', gap: space.s },
  rightNarrow: { flexDirection: 'row', alignItems: 'center', gap: space.ml, flexWrap: 'wrap' },
  timer: { fontFamily: font.display, color: color.fg, fontSize: font.size.h1, fontWeight: font.weight.bold, fontVariant: ['tabular-nums'] },
  timerNarrow: { fontSize: font.size.h2 },
  goal: { marginTop: space.xl },
  mode: { marginTop: space.s },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.ml, marginBottom: space.ml },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  lines: { maxHeight: transcriptHeight, borderTopWidth: border.thin, borderTopColor: color.line },
  linesInner: { paddingVertical: space.l, paddingRight: space.ml, gap: space.m }, // room for the scroll bar
  top: { marginBottom: space.ml },
  line: { maxWidth: lineMaxWidth, alignSelf: 'flex-start', paddingVertical: space.sm, paddingHorizontal: space.ml, borderRadius: radius.l, borderTopLeftRadius: radius.bar, backgroundColor: color.bubble, borderWidth: border.thin, borderColor: 'transparent' },
  lineAi: { alignSelf: 'flex-end', backgroundColor: color.bubbleAi, borderTopLeftRadius: radius.l, borderTopRightRadius: radius.bar },
  lineOwner: { alignSelf: 'flex-end', backgroundColor: color.okSoft, borderTopLeftRadius: radius.l, borderTopRightRadius: radius.bar },
  lineJump: { cursor: 'pointer' },
  lineHover: { borderColor: color.edge },
  lineNow: { borderColor: color.brand },
  request: { gap: space.s, marginTop: space.xs },
  subhead: { marginTop: space.xl, marginBottom: space.s },
  event: { alignSelf: 'center', paddingHorizontal: space.sm },
  eventText: { color: color.muted, fontSize: font.size.s, textAlign: 'center' },
  who: { color: color.soft, fontSize: font.size.xs, fontWeight: font.weight.bold },
  whoTime: { color: color.muted, fontWeight: font.weight.normal, fontVariant: ['tabular-nums'] },
  question: { borderWidth: border.thin, borderColor: color.warn, backgroundColor: color.questionBg, borderRadius: radius.xl, padding: space.xl, gap: space.m },
  qTitle: { color: color.questionInk, fontSize: font.size.m, fontWeight: font.weight.bold },
  q: { color: color.fg, fontSize: font.size.xl, fontWeight: font.weight.semi, lineHeight: font.size.xl * lineHeight },
  result: { gap: space.ml, marginBottom: space.ml, flexWrap: 'wrap' },
  summary: { marginBottom: space.m },
  kv: { flexDirection: 'row', gap: space.l, paddingVertical: space.sm, borderTopWidth: border.thin, borderTopColor: color.line },
  kvKey: { color: color.muted, width: space.x5 * 3.6, flexShrink: 1 },
  num: { fontVariant: ['tabular-nums'] },
  costNote: { marginTop: space.sm },
  answers: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  strong: { color: color.fg, fontWeight: font.weight.bold },
  answered: { borderTopWidth: border.thin, borderTopColor: color.line, paddingTop: space.m, marginTop: space.m },
});
