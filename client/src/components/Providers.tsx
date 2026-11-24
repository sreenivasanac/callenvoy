// Settings > Provider keys: the user's own Twilio and OpenAI keys (needed for real calls), and the optional
// Deepgram and Fish Audio keys. A key is typed once, checked by the server with the provider, stored encrypted
// and never shown again: the page only gets a hint such as "AC...a3a8".
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type ProviderName, type Providers } from '../api';
import { ago, phone } from '../format';
import { useSettings } from '../hooks';
import { border, color, font, space } from '../theme';
import { Loading } from './Loading';
import { Button, Card, Chips, CopyBlock, Note, Pill, Stack, T, TextField, text } from './ui';

type Field = { key: string; label: string; help?: string; secret?: boolean; tel?: boolean };
type Info = { name: ProviderName; title: string; needed: boolean; what: string; where: string; whereLabel: string; fields: Field[] };

export const PROVIDER_COST = 'Calls are billed by your own Twilio and OpenAI accounts: about 3 to 7 cents a minute in total. CallEnvoy charges nothing.';
const KEY = (help: string): Field[] => [{ key: 'api_key', label: 'API key', secret: true, help }];
const INFO: Info[] = [
  {
    name: 'twilio',
    title: 'Twilio',
    needed: true,
    what: 'The phone line. Twilio places the call and bills the minutes.',
    where: 'https://console.twilio.com',
    whereLabel: 'Open the Twilio console',
    fields: [
      { key: 'account_sid', label: 'Account SID', help: 'Starts with AC. On the first page of the Twilio console.' },
      { key: 'auth_token', label: 'Auth Token', secret: true, help: 'Next to the Account SID.' },
      { key: 'from_number', label: 'Your Twilio phone number', tel: true, help: 'A US or Canada voice number in that account. Calls go out from it.' },
    ],
  },
  {
    name: 'openai',
    title: 'OpenAI',
    needed: true,
    what: 'The AI that talks on the call. Without the two optional keys below it also does the hearing and the voice.',
    where: 'https://platform.openai.com/api-keys',
    whereLabel: 'Create an OpenAI key',
    fields: KEY('Starts with sk-. The account needs some credit.'),
  },
  {
    name: 'deepgram',
    title: 'Deepgram',
    needed: false,
    what: 'Better hearing: it understands phone audio faster and more exactly.',
    where: 'https://console.deepgram.com',
    whereLabel: 'Open the Deepgram console',
    fields: KEY('From API Keys in the Deepgram console.'),
  },
  {
    name: 'fish',
    title: 'Fish Audio',
    needed: false,
    what: 'More voices, including Indian English.',
    where: 'https://fish.audio/app/api-keys',
    whereLabel: 'Create a Fish Audio key',
    fields: KEY('From API keys in your Fish Audio account.'),
  },
  {
    name: 'llm',
    title: 'Another AI service',
    needed: false,
    what: 'A different model for the talking, from a service such as Google Gemini, OpenRouter or Groq. It replaces only that model: the OpenAI key is still needed. After saving, choose "Your own service" as the AI model.',
    where: '',
    whereLabel: '',
    fields: [
      { key: 'api_key', label: 'API key', secret: true, help: 'From that service.' },
      { key: 'model', label: 'Model name', help: 'Exactly as the service lists it. The model must be able to call tools.' },
    ],
  },
];
const CHECKING: Record<ProviderName, string> = { twilio: 'Checking with Twilio...', openai: 'Checking with OpenAI...', deepgram: 'Checking with Deepgram...', fish: 'Checking with Fish Audio...', llm: 'Sending a test request to the service...' };
const OTHER = 'Other address';
const NOT_SAVED = { saved: false, hint: null, checked_at: null };

/** The provider keys of the signed-in user. `changed` also reloads the console's config (voices, what can be called). */
export function useProviders() {
  const { reload } = useSettings();
  const [state, setState] = useState<Providers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.providers().then(setState, (e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  const changed = (next: Providers) => {
    setState(next);
    reload();
  };
  return { state, error, load, changed };
}

export function ProviderKeysCard({ id }: { id?: string }) {
  const { state, error, load, changed } = useProviders();
  return (
    <Card label="Provider keys" id={id}>
      <Stack>
        <View>
          <T v="h2">Provider keys</T>
          <T v="muted">Real calls run on your own accounts. You bring the keys, and the bill goes to you.</T>
        </View>
        {!state ? (
          <Loading error={error} retry={load} label="Loading the provider keys" />
        ) : state.server_keys ? (
          <Note kind="saved" title="This account uses the server's keys">
            You are the admin: your calls run on the keys in the server's .env file, with Deepgram for hearing and Fish Audio for the voice. Everyone else brings their own keys here.
          </Note>
        ) : (
          <>
            {!state.can_save ? (
              <Note kind="warn" title="Key saving is off on this server">
                The server has no encryption key, so it cannot store provider keys. The demo line still works. If this is your server, set CALLENVOY_SECRET_KEY in its .env file.
              </Note>
            ) : state.ready ? (
              <Note kind="saved" title="You can call real numbers">{PROVIDER_COST}</Note>
            ) : (
              <Note kind="hint">
                <Text style={[text.base, s.strong]}>Add Twilio and OpenAI to call real numbers.</Text>
                <Text style={text.base}>{PROVIDER_COST} Until then you can call the demo line.</Text>
              </Note>
            )}
            <View>
              {INFO.filter((info) => info.name !== 'llm' || state.llm_services).map((info) => (
                <ProviderRow key={info.name} info={info} state={state} onChange={changed} />
              ))}
            </View>
            <T v="fine">
              Keys are stored encrypted on this server and used only to place your calls. They are never shown again, not to you, not to an agent, not to the admin. Remove a key here at any time; you can also revoke it at the provider.
            </T>
            <T v="fine">{`Now: hearing by ${state.hearing === 'deepgram' ? 'Deepgram' : 'OpenAI'}, voice by ${state.voice_provider === 'fish' ? 'Fish Audio' : 'OpenAI'}.`}</T>
          </>
        )}
      </Stack>
    </Card>
  );
}

function ProviderRow({ info, state, onChange }: { info: Info; state: Providers; onChange: (next: Providers) => void }) {
  const saved = state.providers[info.name] ?? NOT_SAVED;
  // Another AI service: the address comes from a list of known services; a self-hosted server may allow any address.
  const services = info.name === 'llm' ? (state.llm_services ?? {}) : null;
  const [service, setService] = useState('');
  const pick = (name: string) => {
    setService(name);
    setValues((x) => ({ ...x, base_url: name === OTHER ? '' : (services?.[name] ?? '') }));
  };
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const close = () => {
    setOpen(false);
    setValues({});
    setErrors({});
    setService('');
  };
  const save = async () => {
    const missing = Object.fromEntries(info.fields.filter((f) => !values[f.key]?.trim()).map((f) => [f.key, `Enter the ${f.label.replace(/^Your /, '').toLowerCase()}.`]));
    if (services && !values.base_url?.trim()) missing.base_url = state.llm_any_host ? "Pick a service, or enter the service's address." : 'Pick a service.';
    setErrors(missing);
    if (Object.keys(missing).length) return;
    setBusy('save');
    try {
      const body = Object.fromEntries([...info.fields.map((f) => f.key), ...(services ? ['base_url'] : [])].map((k) => [k, values[k].trim()]));
      onChange(await api.saveProvider(info.name, body as { api_key: string }));
      close();
    } catch (e) {
      const field = e instanceof ApiError && e.field && (info.fields.some((f) => f.key === e.field) || (services && e.field === 'base_url')) ? e.field : 'form';
      setErrors({ [field]: (e as Error).message });
    }
    setBusy(null);
  };
  const remove = async () => {
    setBusy('remove');
    setErrors({});
    try {
      onChange(await api.removeProvider(info.name));
    } catch (e) {
      setErrors({ form: (e as Error).message });
    }
    setBusy(null);
  };
  return (
    <View style={s.row} role="group" aria-label={info.title}>
      <View style={s.head}>
        <View style={s.fill}>
          <View style={s.title}>
            <Text style={[text.body, s.strong]}>{info.title}</Text>
            {saved.saved ? <Pill label="Saved" tone="done" /> : <Pill label={info.needed ? 'Needed for real calls' : 'Optional'} tone={info.needed ? 'hold' : 'neutral'} />}
          </View>
          <Text style={text.fine}>{info.what}</Text>
          {saved.saved ? (
            <Text style={[text.fine, s.saved]}>
              {`Key ${saved.hint ?? ''}`}
              {saved.from_number ? `, calls from ${phone(saved.from_number)}` : ''}
              {saved.model ? `, model ${saved.model}` : ''}
              {saved.base_url ? ` at ${host(saved.base_url)}` : ''}
              {saved.checked_at ? `, checked ${ago(saved.checked_at)}` : ''}
            </Text>
          ) : null}
        </View>
        {!open && state.can_save ? (
          <View style={s.actions}>
            <Button label={saved.saved ? 'Replace' : 'Add key'} kind={saved.saved || !info.needed ? 'secondary' : 'primary'} size="small" onPress={() => setOpen(true)} />
            {saved.saved ? <Button label={busy === 'remove' ? 'Removing...' : 'Remove'} a11yLabel={`Remove the ${info.title} key`} kind="outline" size="small" busy={busy === 'remove'} onPress={remove} /> : null}
          </View>
        ) : null}
      </View>
      {open ? (
        <View style={s.form}>
          {info.where ? <Button label={info.whereLabel} kind="link" onPress={() => void Linking.openURL(info.where)} /> : null}
          {services ? (
            <View style={s.inbound}>
              <Text style={text.label}>Service</Text>
              <Chips label="Service" value={service} options={[...Object.keys(services), ...(state.llm_any_host ? [OTHER] : [])].map((n) => [n, n] as const)} onChange={pick} />
              {state.llm_any_host ? (
                <TextField
                  label="Service address"
                  value={values.base_url ?? ''}
                  onChangeText={(v) => setValues((x) => ({ ...x, base_url: v }))}
                  placeholder="https://..."
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  help="The OpenAI-compatible address, usually ending in /v1. This server allows any address."
                  error={errors.base_url}
                />
              ) : errors.base_url ? (
                <Text role="alert" style={text.err}>
                  {errors.base_url}
                </Text>
              ) : values.base_url ? (
                <Text style={text.fine}>{values.base_url}</Text>
              ) : null}
            </View>
          ) : null}
          {info.fields.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              help={f.help}
              value={values[f.key] ?? ''}
              onChangeText={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
              secureTextEntry={f.secret}
              inputMode={f.tel ? 'tel' : undefined}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              error={errors[f.key]}
              onSubmitEditing={save}
            />
          ))}
          {busy === 'save' ? <Note kind="hint">{CHECKING[info.name]}</Note> : null}
          <View style={s.actions}>
            <Button label={busy === 'save' ? 'Checking...' : 'Check and save'} busy={busy === 'save'} onPress={save} />
            <Button label="Cancel" kind="secondary" disabled={busy === 'save'} onPress={close} />
          </View>
        </View>
      ) : null}
      {errors.form ? (
        <Text role="alert" style={text.err}>
          {errors.form}
        </Text>
      ) : null}
      {info.name === 'twilio' && saved.saved && !open ? (
        <View style={s.inbound}>
          <Text style={text.fine}>To get callbacks from a business forwarded to your phone, set this as the voice webhook (HTTP POST) of your Twilio number:</Text>
          <CopyBlock code={state.inbound_url} name="the webhook address" />
        </View>
      ) : null}
    </View>
  );
}

const host = (url: string) => url.replace(/^https?:\/\//, '').split('/')[0];

const s = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  row: { paddingVertical: space.xl, borderTopWidth: border.thin, borderTopColor: color.line, gap: space.ml },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.ml },
  title: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginBottom: space.xxs },
  strong: { fontWeight: font.weight.bold },
  saved: { color: color.soft, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  form: { gap: space.ml, maxWidth: 520 },
  inbound: { gap: space.s },
});
