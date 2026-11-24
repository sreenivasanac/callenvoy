// Settings > Protected details: secrets such as an SSN or an account PIN that a call may have to say or key in.
// A value is typed once into a password field, stored encrypted, and never shown again: the page gets a label
// and a hint such as "ends in 89". The AI model never sees a value; the server says it or keys it in.
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type Secret, type Secrets } from '../api';
import { day } from '../format';
import { border, color, font, space } from '../theme';
import { Loading } from './Loading';
import { Button, Card, Cell, Note, Row, Stack, T, TextField, text } from './ui';

const HOW = [
  'A value is saved encrypted and never shown again, not to you, not to an agent, not to the admin.',
  'The AI model never sees it. When the business asks, the server says the value on the call or keys it in.',
  'A call may use one only if you allow it for that call: turn it on in New call, or answer when the call asks.',
  'It is masked in the transcript, and the recording pauses while it is said.',
];

/** The saved protected details of the signed-in user (labels and hints only). */
export function useSecrets() {
  const [state, setState] = useState<Secrets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.secrets().then(setState, (e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  return { state, setState, error, load };
}

export function ProtectedDetailsCard({ id }: { id?: string }) {
  const { state, setState, error, load } = useSecrets();
  return (
    <Card label="Protected details" id={id}>
      <Stack>
        <View>
          <T v="h2">Protected details</T>
          <T v="muted">Secrets a call may have to give, such as a Social Security number or an account PIN.</T>
        </View>
        <View style={s.how}>
          {HOW.map((line) => (
            <Text key={line} style={[text.base, s.soft]}>
              {line}
            </Text>
          ))}
        </View>
        <T v="fine">
          To be spoken, a value is sent as text to the voice provider of the call (Fish Audio or OpenAI). Digits that are keyed in go to Twilio. Nobody else gets it.
        </T>
        {!state ? (
          <Loading error={error} retry={load} label="Loading the protected details" />
        ) : (
          <>
            {state.secrets.length ? (
              <View>
                {state.secrets.map((x) => (
                  <SecretRow key={x.label} secret={x} onChange={setState} />
                ))}
              </View>
            ) : (
              <T v="soft">Nothing saved. A call can still ask you for a detail while it runs: you type it, it is used once, and it is not stored.</T>
            )}
            {state.can_save ? (
              <AddSecret onChange={setState} />
            ) : (
              <Note kind="warn" title="Saving is off on this server">
                The server has no encryption key, so it cannot store protected details. If this is your server, set CALLENVOY_SECRET_KEY in its .env file.
              </Note>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}

function SecretRow({ secret, onChange }: { secret: Secret; onChange: (next: Secrets) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.deleteSecret(secret.label));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <View style={s.row} role="group" aria-label={secret.label}>
      <View style={s.fill}>
        <Text style={[text.body, s.strong]}>{secret.label}</Text>
        <Text style={[text.fine, s.num]}>{`${secret.hint === 'saved' ? 'Saved' : `Saved, ${secret.hint}`} · since ${day(secret.created_at)}`}</Text>
        {error ? (
          <Text role="alert" style={text.err}>
            {error}
          </Text>
        ) : null}
      </View>
      <Button label={busy ? 'Removing...' : 'Remove'} a11yLabel={`Remove ${secret.label}`} kind="outline" size="small" busy={busy} onPress={remove} />
    </View>
  );
}

function AddSecret({ onChange }: { onChange: (next: Secrets) => void }) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<{ label?: string; value?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: typeof errors = {};
    if (!label.trim()) e.label = 'Give it a name, like SSN or Account PIN.';
    if (!value.trim()) e.value = 'Type the value.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const sent = { label, value };
    try {
      onChange(await api.saveSecret(label.trim(), value.trim()));
      // The value does not stay in the page. (Only what was sent is cleared: a new one typed meanwhile stays.)
      setLabel((now) => (now === sent.label ? '' : now));
      setValue((now) => (now === sent.value ? '' : now));
    } catch (err) {
      const field = err instanceof ApiError && (err.field === 'label' || err.field === 'value') ? err.field : 'form';
      setErrors({ [field]: (err as Error).message });
    }
    setBusy(false);
  };
  return (
    <View style={s.add}>
      <Text style={text.subhead}>Add one</Text>
      <Row>
        <Cell>
          <TextField label="What it is" value={label} onChangeText={setLabel} placeholder="For example SSN" maxLength={40} autoComplete="off" error={errors.label} help="The AI knows only this name." />
        </Cell>
        <Cell>
          <TextField
            label="The value"
            value={value}
            onChangeText={setValue}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            maxLength={200}
            error={errors.value}
            help="Shown only while you type it."
            onSubmitEditing={save}
          />
        </Cell>
      </Row>
      {errors.form ? (
        <Text role="alert" style={text.err}>
          {errors.form}
        </Text>
      ) : null}
      <View style={s.actions}>
        <Button label={busy ? 'Saving...' : 'Save it'} kind="secondary" busy={busy} onPress={save} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  how: { gap: space.s },
  soft: { color: color.soft },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.ml, paddingVertical: space.l, borderTopWidth: border.thin, borderTopColor: color.line },
  strong: { fontWeight: font.weight.bold },
  num: { fontVariant: ['tabular-nums'] },
  add: { gap: space.ml, paddingTop: space.l, borderTopWidth: border.thin, borderTopColor: color.line },
  actions: { flexDirection: 'row' },
});
