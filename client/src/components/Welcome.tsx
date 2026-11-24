// First-run welcome card on Calls: name, a free demo call, own keys for real calls, an agent.
import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, type Mode } from '../api';
import { toE164 } from '../format';
import { useCalls, useGo, useSession, useSettings } from '../hooks';
import { loadLocal, saveLocal } from '../platform/storage';
import { space } from '../theme';
import { useKeys } from './Agents';
import { PROVIDER_COST } from './Providers';
import { CALLBACK_HELP } from './SettingsForm';
import { MODE_OPTIONS } from './CallOptions';
import { Button, Card, Cell, Disclosure, Pill, Row, Segmented, StepNumber, SwitchRow, T, TextField, TextLink } from './ui';
import { VoicePicker } from './VoicePicker';


/** Shown from the first sign-in (first_run) until the user hides it; remembered on this device. */
export function useWelcome(): [boolean, () => void] {
  const { me } = useSession();
  const key = `welcome.${me?.email ?? ''}`;
  const [open, setOpen] = useState(() => !!me?.first_run || loadLocal(key) === 'open');
  useEffect(() => {
    if (me?.first_run) saveLocal(key, 'open');
  }, [me?.first_run, key]);
  return [
    open,
    () => {
      saveLocal(key, 'hidden');
      setOpen(false);
    },
  ];
}

export function WelcomeCard({ onHide }: { onHide: () => void }) {
  const go = useGo();
  const { settings, config } = useSettings();
  const { calls } = useCalls();
  const { keys } = useKeys();
  const { me } = useSession();
  const prefsKey = `prefs.${me?.email ?? ''}`;
  const [chose, setChose] = useState(() => loadLocal(prefsKey) === 'saved'); // the preferences step was saved on this device
  const hasDemo = !!config?.demo; // most self-hosted servers have no demo line
  const named = !!settings?.name;
  const called = !!calls?.some((c) => c.direction === 'outbound');
  const own = config?.keys; // absent on an older server: then there is no keys step to show as open
  const ready = !own || own.ready;
  const connected = !!keys?.some((k) => k.last_used_at);
  const left = own?.demo_calls_left ?? 0;
  const steps = [named, chose, ...(hasDemo ? [called] : []), ready, connected];
  const done = steps.filter(Boolean).length;
  const count = ['', 'One step', 'Two steps', 'Three steps', 'Four steps', 'Five steps'][steps.length];
  const n = (i: number) => (hasDemo || i < 3 ? i : i - 1); // step numbers without the demo step
  return (
    <Card label="Welcome">
      <View style={s.head}>
        <View style={s.fill}>
          <T v="h2">Welcome to CallEnvoy</T>
          <T v="muted">{done === steps.length ? 'You are set up.' : `${count}. ${done} of ${steps.length} done.`}</T>
        </View>
        {named ? <Button label="Hide" a11yLabel="Hide the welcome steps" kind="link" onPress={onHide} /> : null}
      </View>
      <View role="list" style={s.steps}>
        <Step n={1} done={named} title="Tell the AI who it calls for">
          {named ? <T v="soft">{`The AI says: “I am calling on behalf of ${settings!.name}.”`}</T> : <NameForm />}
        </Step>
        <Step n={2} done={chose} title="Choose how your calls work">
          {chose && settings ? (
            <>
              <T v="soft">{`${settings.mode === 'transfer' ? 'The AI brings you on when a person answers' : 'The AI handles the whole call'}. Calls are ${settings.record_calls ? '' : 'not '}recorded. Voice: ${settings.voice}.`}</T>
              <View style={s.actions}>
                <TextLink label="Change in Settings" onPress={() => go('/settings')} />
              </View>
            </>
          ) : settings && config ? (
            <PrefsForm
              onSaved={() => {
                saveLocal(prefsKey, 'saved');
                setChose(true);
              }}
            />
          ) : null}
        </Step>
        {hasDemo ? (
        <Step n={3} done={called} title="Make a free demo call">
          <T v="soft">
            {`Call our demo line: a test phone line that answers like a business, with a menu, a short hold, and a billing agent.${
              own && !own.ready ? ` It costs you nothing. ${left} free call${left === 1 ? '' : 's'} left.` : ''
            }`}
          </T>
          {!called ? (
            <View style={s.actions}>
              <Button label="Call the demo line" disabled={!named || (!ready && left <= 0)} onPress={() => go('/new?demo=1')} />
            </View>
          ) : null}
          {!named ? <T v="fine">Save your name first.</T> : null}
        </Step>
        ) : null}
        <Step n={n(4)} done={ready} title={hasDemo ? 'Add your keys for real calls' : 'Add your keys'}>
          {own?.server_keys ? (
            <T v="soft">This account uses the server's keys, so real calls already work.</T>
          ) : ready ? (
            <T v="soft">Your Twilio and OpenAI keys are saved. You can call real numbers.</T>
          ) : (
            <>
              <T v="soft">Real numbers run on your own Twilio key (the phone line) and OpenAI key (the AI). {PROVIDER_COST}</T>
              <View style={s.actions}>
                <Button label="Add my keys" kind={called || !hasDemo ? 'primary' : 'secondary'} onPress={() => go('/settings?focus=keys')} />
              </View>
            </>
          )}
        </Step>
        <Step n={n(5)} done={connected} title="Connect an AI agent">
          <T v="soft">Add CallEnvoy to Claude, ChatGPT, Codex, or Cursor. Then ask your agent to make a call. You can also place calls here with New call.</T>
          {!connected ? (
            <View style={s.actions}>
              <Button label="Set up an agent" kind="secondary" onPress={() => go('/agents')} />
            </View>
          ) : null}
        </Step>
      </View>
    </Card>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <View role="listitem" style={s.step}>
      <StepNumber n={n} done={done} />
      <View style={[s.fill, s.body]}>
        <View style={s.title}>
          <T v="h3">{title}</T>
          {done ? <Pill label="Done" tone="ok" /> : null}
        </View>
        {children}
      </View>
    </View>
  );
}

/** Step 1: the profile name (required to place a call) and, optionally, the callback number. */
function NameForm() {
  const { save, config } = useSettings();
  const [name, setName] = useState('');
  const [callback, setCallback] = useState('');
  const [errors, setErrors] = useState<{ name?: string; callback_number?: string }>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const cb = callback.trim() ? toE164(callback) : null;
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'Enter your name. The AI says it to the person who answers.';
    if (callback.trim() && !cb) e.callback_number = 'Enter a US or Canada number with area code, like (503) 555-0142.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await save({ name: name.trim(), ...(cb ? { callback_number: cb } : {}) }); // step 1 shows done once the name is saved
    } catch (err) {
      const field = err instanceof ApiError && err.field === 'callback_number' ? 'callback_number' : 'name';
      setErrors({ [field]: (err as Error).message });
      setBusy(false);
    }
  };
  return (
    <View style={s.form}>
      <Row>
        <Cell>
          <TextField label="Your name" value={name} onChangeText={setName} autoComplete="name" maxLength={config?.text_limits.name} error={errors.name} onSubmitEditing={submit} />
        </Cell>
        <Cell>
          <TextField
            label="Callback number"
            optional
            value={callback}
            onChangeText={setCallback}
            inputMode="tel"
            autoComplete="tel"
            error={errors.callback_number}
            help={CALLBACK_HELP}
          />
        </Cell>
      </Row>
      <Button label={busy ? 'Saving...' : 'Save'} busy={busy} onPress={submit} />
    </View>
  );
}

/** Step 2: what happens when a person answers, recording, and the voice. Each starts from the current setting. */
function PrefsForm({ onSaved }: { onSaved: () => void }) {
  const { settings, config, save } = useSettings();
  const [mode, setMode] = useState<Mode>(settings!.mode);
  const [record, setRecord] = useState(settings!.record_calls);
  const [voice, setVoice] = useState(settings!.voice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await save({ mode, record_calls: record, voice }); // saving the mode also tells agents not to ask each time
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <View style={s.form}>
      <Segmented
        label="When a person answers"
        value={mode}
        options={MODE_OPTIONS}
        onChange={setMode}
        help={mode === 'transfer' ? 'The AI gets through the menu and the hold, then brings you on the line.' : 'The AI does the whole call. You can still listen in or take over.'}
      />
      <SwitchRow title="Record calls" help="So you can hear what was said. Some US states require everyone on a call to agree to a recording; that is on you as the caller." value={record} onChange={setRecord} />
      <Disclosure title={`Voice: ${voice}`}>
        <VoicePicker label="AI voice" voices={config!.voices} value={voice} onChange={setVoice} />
      </Disclosure>
      {error ? <T v="fine">{error}</T> : null}
      <View style={s.actions}>
        <Button label={busy ? 'Saving...' : 'Save'} busy={busy} onPress={submit} />
      </View>
      <T v="fine">You can change all of this in Settings, and for a single call.</T>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.ml },
  steps: { gap: space.xxl, marginTop: space.xl },
  step: { flexDirection: 'row', gap: space.l, alignItems: 'flex-start' },
  body: { gap: space.sm },
  title: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.ml },
  form: { gap: space.ml },
});
