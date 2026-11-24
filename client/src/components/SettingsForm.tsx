// Settings page: profile, caller ID, call defaults, voice, alerts, account (plan sections 4a, 22; round 2 B6).
// Server settings are saved together from a bar that shows while there are unsaved changes.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type Config, type Mode, type ProfileField, type Settings } from '../api';
import { phone, toE164 } from '../format';
import { useCallerId, useSettings } from '../hooks';
import { scrollToId } from '../platform/scroll';
import { border, color, font, maxContent, space } from '../theme';
import { AccountCard } from './Account';
import { CallOptions, checkNumbers, MODE_OPTIONS, type Options } from './CallOptions';
import { AudioCheck, DeviceAlerts } from './DeviceAlerts';
import { ProviderKeysCard } from './Providers';
import { ProtectedDetailsCard } from './Secrets';
import { Button, Card, Cell, Choices, Disclosure, Note, Pill, Row, Screen, Segmented, Stack, StatusLine, SwitchRow, T, TextField, TextLink, text } from './ui';
import { VoicePicker } from './VoicePicker';

type TextKey = ProfileField | 'name' | 'details' | 'timezone';
// The inputs hold strings: null (not set) shows as empty, and an empty field is saved as "" (cleared).
type Form = Omit<Settings, keyof Options | TextKey | 'callback_number'> & Options & Record<TextKey | 'callback_number', string>;
type Errors = Partial<Record<keyof Settings | 'form', string>>;

const GROUPS: { title: string; fields: [ProfileField, string][] }[] = [
  {
    title: 'Insurance',
    fields: [
      ['insurance_carrier', 'Health insurance carrier'],
      ['insurance_member_id', 'Member ID'],
      ['insurance_group_number', 'Group number'],
      ['dental_insurance_carrier', 'Dental insurance carrier'],
      ['dental_insurance_member_id', 'Dental member ID'],
    ],
  },
  {
    title: 'Vehicle',
    fields: [
      ['vehicle', 'Vehicle (year, make, model)'],
      ['vin', 'VIN'],
    ],
  },
  {
    title: 'Travel',
    fields: [
      ['frequent_flyer_numbers', 'Frequent flyer numbers'],
      ['known_traveler_number', 'Known Traveler Number'],
      ['redress_number', 'Redress number'],
    ],
  },
];

const SECTIONS = [
  ['settings-profile', 'Profile'],
  ['settings-keys', 'Provider keys'],
  ['settings-secrets', 'Protected details'],
  ['settings-defaults', 'Call defaults'],
  ['settings-model', 'AI model'],
  ['settings-voice', 'Voice'],
  ['settings-alerts', 'Alerts'],
  ['settings-account', 'Account'],
] as const;
export const CALLBACK_HELP = 'Your phone rings on this number for a hand-over. The AI may also give it to a business that asks for it.';
const SAVED_MS = 3000;
const NAME_FIELD = 'settings-name'; // "Saved." stays this long in the bar

function toForm(settings: Settings): Form {
  const x = { ...settings } as Record<string, unknown>;
  for (const k in x) if (x[k] === null) x[k] = '';
  return {
    ...(x as Form),
    callback_number: settings.callback_number ? phone(settings.callback_number) : '',
    max_minutes: String(settings.max_minutes),
    alert_wait_seconds: String(settings.alert_wait_seconds),
    phone_ring_seconds: String(settings.phone_ring_seconds),
  };
}

/** `focus: 'name'` moves to the name field (the New call form links there when the name is missing); `focus: 'keys'` to the provider keys. */
export function SettingsForm({ config, settings, focus }: { config: Config; settings: Settings; focus?: string }) {
  const { save, loadCallerId } = useSettings();
  const callerId = useCallerId();
  const [base, setBase] = useState<Form>(() => toForm(settings)); // what the server has
  const [f, setF] = useState<Form>(base);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(t);
  }, [saved]);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: v }));
  };
  useEffect(() => {
    if (focus === 'name') scrollToId('settings-profile', NAME_FIELD);
    if (focus !== 'keys') return;
    // After the first layout: at mount the page is not laid out yet, and the jump would go nowhere.
    const t = setTimeout(() => scrollToId('settings-keys'), 250);
    return () => clearTimeout(t);
  }, [focus]);
  const verified = !!callerId?.verified && !!callerId.number && callerId.number === settings.callback_number;

  const submit = async () => {
    const cb = f.callback_number.trim() ? toE164(f.callback_number) : '';
    const { n, errors: e } = checkNumbers(f, config.ranges, ['max_minutes', 'alert_wait_seconds', 'phone_ring_seconds']);
    const all: Errors = e;
    if (cb == null) all.callback_number = 'Enter a US or Canada number with area code, like (503) 555-0142.';
    if (f.caller_id === 'own' && (!verified || cb !== settings.callback_number)) all.caller_id = 'Verify your callback number first.';
    setErrors(all);
    setSaved(false);
    if (Object.keys(all).length) return;
    setBusy(true);
    try {
      // An empty string removes a text field (plan section 3, save_profile).
      // Only the changed fields go out: an unchanged one may hold a value that an agent saved since this
      // page loaded, and sending the old value back would undo it.
      const all = { ...f, callback_number: cb ?? '', ...(n as Pick<Settings, 'max_minutes' | 'alert_wait_seconds' | 'phone_ring_seconds'>) };
      const changed = Object.fromEntries(Object.entries(all).filter(([k]) => f[k as keyof Form] !== base[k as keyof Form]));
      const next = await save(changed as Partial<Settings>);
      setBase(toForm(next));
      setF(toForm(next));
      setSaved(true);
      if (next.callback_number !== settings.callback_number) void loadCallerId().catch(() => {}); // a new number: ask again
    } catch (err) {
      const field = err instanceof ApiError && err.field && err.field in f ? (err.field as keyof Settings) : 'form';
      setErrors({ [field]: (err as Error).message });
      // A field inside a closed group: open the group, so the error shows at the field.
      const g = GROUPS.find((g) => g.fields.some(([k]) => k === field));
      if (g) setOpen((o) => ({ ...o, [g.title]: true }));
    }
    setBusy(false);
  };

  const count = Object.keys(errors).filter((k) => k !== 'form').length;
  const textField = (k: TextKey, label: string, extra?: object) => (
    <TextField key={k} label={label} optional={k !== 'name'} value={f[k]} onChangeText={set(k)} error={errors[k]} maxLength={config.text_limits[k]} {...extra} />
  );

  const discard = () => {
    setF(base);
    setErrors({});
  };
  const l = config.limits;
  const bar =
    dirty || busy || saved ? (
      <View style={s.bar}>
        <View style={s.barInner}>
          <View style={s.barText}>
            {count > 0 ? (
              <Text role="alert" style={text.err}>{`Fix ${count} field${count > 1 ? 's' : ''} to save.`}</Text>
            ) : errors.form ? (
              <Text role="alert" style={text.err}>
                {errors.form}
              </Text>
            ) : (
              <Text role="status" style={text.base}>
                {dirty ? 'You have unsaved changes.' : 'Saved.'}
              </Text>
            )}
          </View>
          {dirty || busy ? (
            <View style={s.inline}>
              <Button label="Discard" kind="secondary" size="small" disabled={busy} onPress={discard} />
              <Button label={busy ? 'Saving...' : 'Save changes'} size="small" busy={busy} onPress={submit} />
            </View>
          ) : null}
        </View>
      </View>
    ) : null;

  return (
    <Screen footer={bar}>
      <View>
        <T v="h1">Settings</T>
        <View role="navigation" aria-label="Settings sections" style={s.sections}>
          {SECTIONS.map(([id, label]) => (
            <TextLink key={id} label={label} onPress={() => scrollToId(id)} />
          ))}
        </View>
      </View>
      <Card label="Profile" id="settings-profile">
        <Stack>
          <View>
            <T v="h2">Profile</T>
            <T v="muted">The AI uses this on every call. Agents can read and update it too.</T>
          </View>
          <Text style={text.subhead}>About you</Text>
          <Row>
            <Cell>{textField('name', 'Your name', { autoComplete: 'name', nativeID: NAME_FIELD })}</Cell>
            <Cell>
              <TextField
                label="Callback number"
                value={f.callback_number}
                onChangeText={set('callback_number')}
                inputMode="tel"
                autoComplete="tel"
                error={errors.callback_number}
                help={CALLBACK_HELP}
              />
            </Cell>
          </Row>
          <CallerIdStatus key={settings.callback_number ?? ''} saved={settings.callback_number} />
          <Row>
            <Cell>{textField('name_pronunciation', 'How to say your name', { help: 'For example: DAH-nuh RAY-ess' })}</Cell>
            <Cell>{textField('assistant_name', 'A first name for the AI', { help: 'Empty: the AI does not give itself a name.' })}</Cell>
          </Row>
          <Row>
            <Cell>{textField('email', 'Email', { inputMode: 'email', autoComplete: 'email' })}</Cell>
            <Cell>{textField('date_of_birth', 'Date of birth')}</Cell>
          </Row>
          {textField('address', 'Address', { autoComplete: 'street-address' })}
          {'timezone' in settings
            ? textField('timezone', 'Your time zone', { autoCapitalize: 'none', autoCorrect: false, help: 'So the AI knows today\'s date and time. A name like America/Los_Angeles. Set from this browser at first.' })
            : null}
          {textField('details', 'Anything else the AI may share', {
            rows: 4,
            help: 'Only what is written here, in the call request, or in your answers is shared. Leave out anything you would not say to a support agent.',
          })}
          {GROUPS.map((g) => (
            <Disclosure key={g.title} title={g.title} open={!!open[g.title]} onToggle={() => setOpen((o) => ({ ...o, [g.title]: !o[g.title] }))}>
              <Stack>{g.fields.map(([k, label]) => textField(k, label))}</Stack>
            </Disclosure>
          ))}
        </Stack>
      </Card>

      <ProviderKeysCard id="settings-keys" />
      <ProtectedDetailsCard id="settings-secrets" />

      <Card label="Call defaults" id="settings-defaults">
        <Stack>
          <View>
            <T v="h2">Call defaults</T>
            <T v="muted">Used for every new call. A call can change any of them.</T>
          </View>
          <Segmented label="When a person answers" value={f.mode} options={MODE_OPTIONS} onChange={(v) => set('mode')(v as Mode)} />
          <CallOptions
            o={f}
            onChange={(patch) => {
              setSaved(false);
              setF((x) => ({ ...x, ...patch }));
            }}
            errors={errors}
            config={config}
            ownVerified={verified}
            reachHelp="App, then phone: an alert first; if you do not join in time, your phone rings."
          />
          <Text style={text.subhead}>Limits</Text>
          <View style={s.limits}>
            {[
              `${settings.max_minutes} minutes planned per call, ${config.ranges.max_minutes[1]} at most`,
              `Up to ${l.max_concurrent_calls} calls at the same time`,
              `${l.daily_minute_cap} call minutes per day${(l.my_minutes_today ?? l.minutes_used_today) != null ? ` (${l.my_minutes_today ?? l.minutes_used_today} used today)` : ''}`,
              'US and Canada numbers only; premium and Caribbean area codes are blocked',
              `Calls are ${settings.record_calls ? '' : 'not '}recorded by default (setting above)`,
            ].map((t) => (
              <Text key={t} style={[text.base, s.limit]}>
                {t}
              </Text>
            ))}
          </View>
        </Stack>
      </Card>

      {config.ai_models?.length ? (
        <Card label="AI model" id="settings-model">
          <Stack>
            <View>
              <T v="h2">AI model</T>
              <T v="muted">The model that listens to the words and decides what to say and which key to press.</T>
            </View>
            <Choices
              label="Model for your calls"
              value={f.ai_model ?? config.ai_models[0].id}
              options={config.ai_models.map((m) => ({ id: m.id, title: m.id === 'custom' ? 'Your own service' : m.id, about: sentence(m.about), right: priceText(m.price) }))}
              onChange={set('ai_model')}
              help="Prices are the provider's list prices per 1 million tokens. A two-minute call uses about 15,000, most of them at the lower repeat rate."
            />
            <T v="fine">A cheaper model can mishandle a phone menu or hang up too early. Try a model on the demo line before you trust it with a real call.</T>
          </Stack>
        </Card>
      ) : null}

      <Card label="AI voice" id="settings-voice">
        <Stack>
          <T v="h2" style={s.noMargin}>
            AI voice
          </T>
          <VoicePicker label="Default voice" voices={config.voices} value={f.voice} onChange={set('voice')} help="An agent can still pick a different voice for a single call." />
          {config.voice_provider === 'openai' ? (
            <View style={s.inline}>
              <T v="fine">These are OpenAI voices. A Fish Audio key adds more voices, including Indian English.</T>
              <TextLink label="Add a Fish Audio key" onPress={() => scrollToId('settings-keys')} />
            </View>
          ) : null}
        </Stack>
      </Card>

      <Card label="Alerts" id="settings-alerts">
        <Stack gap={0}>
          <T v="h2">Alerts</T>
          <T v="muted">How you hear that a person is on the line. Saved for all your devices.</T>
          <SwitchRow title="Sound" help="A ring while the console is open." value={f.alert_sound} onChange={set('alert_sound')} />
          <SwitchRow title="Browser notification" value={f.alert_notification} onChange={set('alert_notification')} />
          <SwitchRow title="Push to my devices" value={f.alert_push} onChange={set('alert_push')} />
          <SwitchRow
            title="Show the business name in push alerts"
            help="Off: the lock screen only says a person is on the line."
            value={f.push_shows_business}
            onChange={set('push_shows_business')}
          />
        </Stack>
      </Card>
      <DeviceAlerts config={config} />
      <AudioCheck />

      <AccountCard id="settings-account" />
    </Screen>
  );
}

const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
const dollars = (n: number) => `$${n < 1 ? n.toFixed(2) : n.toFixed(n % 1 ? 2 : 0)}`;
/** "$0.10 in, $0.50 out" per 1M tokens, or a note when the price is not known. */
const priceText = (p: [number, number, number] | null) => (p ? `${dollars(p[0])} in, ${dollars(p[2])} out` : 'price not known');

/** Callback number state for caller ID, with Verify (plan section 22.2). */
function CallerIdStatus({ saved }: { saved: string | null }) {
  const { callerId, loadCallerId } = useSettings();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = !!callerId?.verified && callerId.number === saved;
  const reload = () => loadCallerId().catch((e) => setError((e as Error).message));
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const { validation_code } = await api.verifyCallerId();
      setCode(validation_code);
      // No code: the number is already verified with Twilio; reload the state so it shows Verified.
      if (validation_code == null) await reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <View>
      <StatusLine
        title="Your number as caller ID"
        help={saved ? phone(saved) : 'Save a callback number first.'}
        right={verified ? <Pill label="Verified" tone="ok" /> : <Pill label="Not verified" />}
      />
      {!verified && saved ? (
        <Stack gap={space.sm}>
          {code ? (
            <Note kind="hint">
              <Text style={[text.base, s.code]}>Your code: {code}</Text>
              <Text style={text.base}>{`Twilio now calls ${phone(saved)} and asks for this code. Type it on the phone keypad.`}</Text>
            </Note>
          ) : null}
          <View style={s.inline}>
            <Button label={busy ? 'Starting...' : code ? 'Send a new code' : 'Verify'} kind="secondary" size="small" busy={busy} onPress={verify} />
            {code ? <Button label="Check again" kind="secondary" size="small" onPress={() => void reload()} /> : null}
          </View>
          {error ? (
            <Text role="alert" style={text.err}>
              {error}
            </Text>
          ) : null}
        </Stack>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  noMargin: { marginBottom: 0 },
  sections: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl, rowGap: space.xs },
  limits: { gap: space.s },
  limit: { color: color.soft },
  bar: { borderTopWidth: border.thin, borderTopColor: color.line, backgroundColor: color.card, paddingVertical: space.ml, paddingHorizontal: space.xl, boxShadow: `0 -6px 18px ${color.shadow}` },
  barInner: { width: '100%', maxWidth: maxContent, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.ml },
  barText: { flexGrow: 1, flexShrink: 1 },
  err: { marginTop: space.s },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  code: { fontWeight: font.weight.bold },
});
