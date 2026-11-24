import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type Config, type Mode, type NewCall, type Settings } from '../api';
import { phone, toE164 } from '../format';
import { useCallerId, useGo } from '../hooks';
import { color, space, useWide } from '../theme';
import { CallOptions, checkNumbers, MODE_OPTIONS, type Options } from './CallOptions';
import { PROVIDER_COST } from './Providers';
import { Button, Card, Field, Note, Segmented, Stack, SwitchRow, T, TextField, TextLink, text } from './ui';
import { VoicePicker } from './VoicePicker';

type Errors = Partial<Record<keyof NewCall | keyof Options | 'form', string>>;

/** The place_call form. Every option starts from the saved settings. */
// The server's field names for the two options whose settings name differs.
const TO_SETTING: Record<string, keyof Options> = { record: 'record_calls', from: 'caller_id' };

/** `demo`: CallEnvoy's demo line, filled in for a first call. */
export function CallForm({ config, settings, demo }: { config: Config; settings: Settings; demo?: Config['demo'] }) {
  // The saved protected details (labels only): the user turns on the ones this call may give.
  const [secrets, setSecrets] = useState<string[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  useEffect(() => {
    api.secrets().then((x) => setSecrets(x.secrets.map((y) => y.label)), () => {}); // none shown if this fails: the call can still ask
  }, []);
  const wide = useWide();
  const go = useGo();
  const named = !!settings.name; // the server refuses a call without the profile name
  const callerId = useCallerId();
  const ownVerified = !!callerId?.verified && !!callerId.number && callerId.number === settings.callback_number;
  const [f, setF] = useState({
    to: demo ? phone(demo.number) : '',
    business: demo?.business ?? '',
    goal: demo?.goal ?? '',
    facts: demo?.facts ?? '',
    menu_tips: demo?.menu_tips ?? '',
    flexibility: '',
    on_behalf_of: '',
    connect_when: '',
    mode: settings.mode as Mode,
    voice: settings.voice,
    reach: settings.reach,
    no_answer: settings.no_answer,
    caller_id: settings.caller_id,
    alert_on_human: settings.alert_on_human,
    listen_in: settings.listen_in,
    record_calls: settings.record_calls,
    leave_voicemail: settings.leave_voicemail,
    alert_wait_seconds: String(settings.alert_wait_seconds),
    phone_ring_seconds: String(settings.phone_ring_seconds),
    max_minutes: String(settings.max_minutes),
  });
  // Own caller ID only once the number is verified (the state loads after the form opens).
  const from = f.caller_id === 'own' && ownVerified ? 'own' : 'callenvoy';
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [needKeys, setNeedKeys] = useState(false); // the server refused for missing keys: link to them
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const needsPhone = f.reach === 'phone' && (f.mode === 'transfer' || !!f.connect_when.trim() || f.listen_in);

  const submit = async () => {
    if (!named) return;
    const { n, errors: e } = checkNumbers(f, config.ranges, ['alert_wait_seconds', 'max_minutes']) as { n: Record<string, number>; errors: Errors };
    const to = toE164(f.to);
    if (!to) e.to = 'Enter a US or Canada number with area code, like (503) 555-0142.';
    if (!f.business.trim()) e.business = 'Say who you are calling.';
    if (f.goal.trim().length < 5) e.goal = 'Say what the call should get done (at least 5 characters).';
    if (needsPhone && !settings.callback_number) e.reach = 'Transfer by phone needs a callback number. Add one in Settings, or choose App.';
    setErrors(e);
    if (Object.keys(e).length) {
      if (e.alert_wait_seconds || e.max_minutes || e.reach || e.caller_id) setMore(true);
      return;
    }
    const opt = (s: string) => s.trim() || undefined;
    const body: NewCall = {
      to: to!,
      business: f.business.trim(),
      goal: f.goal.trim(),
      facts: opt(f.facts),
      menu_tips: opt(f.menu_tips),
      flexibility: opt(f.flexibility),
      on_behalf_of: opt(f.on_behalf_of),
      connect_when: opt(f.connect_when),
      mode: f.mode,
      reach: f.reach,
      no_answer: f.no_answer,
      alert_on_human: f.alert_on_human,
      listen_in: f.listen_in,
      record: f.record_calls,
      from,
      leave_voicemail: f.leave_voicemail,
      voice: f.voice,
      alert_wait_seconds: n.alert_wait_seconds,
      max_minutes: n.max_minutes,
      ...(allowed.length ? { allow_secrets: allowed } : {}),
    };
    setBusy(true);
    try {
      const { id } = await api.placeCall(body);
      router.replace(`/calls/${id}`);
    } catch (err) {
      setBusy(false);
      const name = err instanceof ApiError && err.field ? (TO_SETTING[err.field] ?? err.field) : '';
      const field = name in f ? (name as keyof Errors) : 'form';
      setErrors({ [field]: err instanceof Error ? err.message : 'The call could not be placed.' });
      setNeedKeys(err instanceof ApiError && (err.code === 'keys_needed' || err.code === 'demo_limit'));
      if (field !== 'form' && !['to', 'business', 'goal', 'facts', 'mode'].includes(field)) setMore(true);
    }
  };

  const count = Object.keys(errors).filter((k) => k !== 'form').length;
  const modeHelp =
    f.mode === 'transfer'
      ? 'The AI gets through the menu and the hold, then brings you on the line.'
      : 'The AI does the whole call. You can still listen or join.';
  const reachHelp = `App: an alert in this console and on your devices. Phone: rings ${settings.callback_number ? phone(settings.callback_number) : 'your callback number'}.`;

  // Without own keys only the demo line can be called: say so before the user fills in a form that would fail.
  const keys = config.keys;
  const demoOnly = !!keys && !keys.ready;
  if (demoOnly && (!demo || keys.demo_calls_left <= 0)) return <KeysNeeded left={config.demo ? keys.demo_calls_left : 0} named={named} demo={!!config.demo} />;

  return (
    <Card label="New call">
      <Stack>
        <View>
          <T v="h1" level={2}>
            New call
          </T>
          <T v="muted">Every option starts from your Settings.</T>
        </View>
        {!named && (
          <Note kind="blocked" title="Add your name first.">
            <T v="base" style={s.blockedText}>
              The AI says it is calling on behalf of you, so it needs your name.
            </T>
            <TextLink label="Set your name" onPress={() => go('/settings?focus=name')} />
          </Note>
        )}
        {demo && (
          <Note kind="hint">
            {`This is CallEnvoy's demo line: a test phone line that answers like a business, with a menu, a short hold, and a billing agent. Press Call now to try it.${
              demoOnly ? ` It is free: ${keys.demo_calls_left} demo call${keys.demo_calls_left === 1 ? '' : 's'} left.` : ''
            }`}
          </Note>
        )}
        {count > 0 && <Note kind="errsum">{`Fix ${count} field${count > 1 ? 's' : ''} to place the call.`}</Note>}
        <TextField
          label="Number to call"
          value={f.to}
          onChangeText={set('to')}
          inputMode="tel"
          autoComplete="off"
          placeholder="+1 (555) 555-0100"
          help={demoOnly ? 'The demo line. Other numbers need your own Twilio and OpenAI keys.' : 'US or Canada numbers only.'}
          editable={!demoOnly}
          error={errors.to}
        />
        <TextField label="Business" value={f.business} onChangeText={set('business')} placeholder="For example Northstar Internet" maxLength={120} error={errors.business} />
        <TextField
          label="Goal"
          rows={3}
          value={f.goal}
          onChangeText={set('goal')}
          placeholder="What should the call get done?"
          maxLength={1500}
          help="The AI says this in one short sentence to the person who answers."
          error={errors.goal}
        />
        <TextField
          label="Details the AI may share"
          optional
          rows={3}
          value={f.facts}
          onChangeText={set('facts')}
          placeholder="Account number, dates, anything the AI may say"
          maxLength={3000}
          help="Added to the details in Settings for this call only."
          error={errors.facts}
        />
        <Segmented label="When a person answers" value={f.mode} options={MODE_OPTIONS} onChange={set('mode')} help={modeHelp} />
        {secrets.length && !demo ? (
          <Field label="This call may use" help="Your protected details. The call gives one you turn on here only when the business asks for it. For the others it asks you first.">
            <View>
              {secrets.map((label) => (
                <SwitchRow key={label} title={label} value={allowed.includes(label)} onChange={(on) => setAllowed((a) => (on ? [...a, label] : a.filter((x) => x !== label)))} />
              ))}
            </View>
          </Field>
        ) : null}

        <Button
          label={more ? '▾ Fewer options' : '▸ More options (voice, recording, how to reach you)'}
          kind="link"
          expanded={more}
          onPress={() => setMore(!more)}
        />
        {more && (
          <Stack>
            <Text style={text.subhead}>The call</Text>
            <TextField
              label="Menu tips"
              optional
              value={f.menu_tips}
              onChangeText={set('menu_tips')}
              maxLength={300}
              placeholder="For example: billing is option 1"
              help="Hints only. The AI still waits for the real menu."
              error={errors.menu_tips}
            />
            <TextField
              label="What the AI may accept without asking you"
              optional
              rows={2}
              value={f.flexibility}
              onChangeText={set('flexibility')}
              maxLength={1500}
              error={errors.flexibility}
            />
            <TextField
              label="On behalf of"
              value={f.on_behalf_of}
              onChangeText={set('on_behalf_of')}
              placeholder={settings.name || 'Your name'}
              maxLength={80}
              help="From Settings when empty."
              error={errors.on_behalf_of}
            />
            <Text style={text.subhead}>Hand-over</Text>
            <TextField
              label="Also hand over when"
              optional
              value={f.connect_when}
              onChangeText={set('connect_when')}
              maxLength={300}
              placeholder="For example: if they need to speak to me"
              help="Optional custom condition, in your words."
              error={errors.connect_when}
            />
            <CallOptions
              o={f}
              onChange={(patch) => setF((x) => ({ ...x, ...patch }))}
              errors={errors}
              config={config}
              ownVerified={ownVerified}
              perCall
              reachHelp={reachHelp}
            />
            <VoicePicker label="AI voice" voices={config.voices} value={f.voice} onChange={set('voice')} />
          </Stack>
        )}

        {errors.form && <Note kind="errsum">{errors.form}</Note>}
        {needKeys && <TextLink label="Add your keys in Settings" onPress={() => go('/settings?focus=keys')} />}
        <View style={[s.foot, wide && s.footWide]}>
          <Button label={busy ? 'Calling...' : 'Call now'} size="big" busy={busy} disabled={!named} onPress={submit} full={!wide} />
          <T v="fine">The number is dialed right away.</T>
        </View>
      </Stack>
    </Card>
  );
}

/** New call without own keys, and no demo call filled in (or none left): the two things the user can do. */
function KeysNeeded({ left, named, demo }: { left: number; named: boolean; demo: boolean }) {
  const go = useGo();
  return (
    <Card label="New call">
      <Stack>
        <View>
          <T v="h1" level={2}>
            {left > 0 ? 'Try the demo line first' : 'Add your keys to place calls'}
          </T>
          <T v="soft">
            {left > 0
              ? `You have ${left} free demo call${left === 1 ? '' : 's'}. The demo line is a test phone line with a menu, a short hold, and a billing agent. It shows a whole call in about two minutes.`
              : demo
                ? 'You have used your free demo calls.'
                : 'Calls run on your own Twilio and OpenAI accounts. Save the two keys once, then call any US or Canada number.'}
          </T>
        </View>
        <Note kind="hint">
          <Text style={text.base}>
            {demo ? 'Real numbers need your own Twilio and OpenAI keys. ' : ''}
            {PROVIDER_COST}
          </Text>
        </Note>
        {left > 0 && !named ? <T v="fine">Save your name first (on the Calls page, or in Settings): the AI says who it calls for.</T> : null}
        <View style={s.choices}>
          {left > 0 ? <Button label="Call the demo line" disabled={!named} onPress={() => go('/new?demo=1')} /> : null}
          <Button label="Add my keys" kind={left > 0 ? 'secondary' : 'primary'} onPress={() => go('/settings?focus=keys')} />
        </View>
      </Stack>
    </Card>
  );
}

const s = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.ml },
  foot: { gap: space.l },
  footWide: { flexDirection: 'row', alignItems: 'center' },
  blockedText: { color: color.blockedInk },
});
