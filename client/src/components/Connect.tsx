// /connect?request=<id>: an AI agent asks to use this account (the browser step of the agent's sign-in).
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api';
import { useSession } from '../hooks';
import { saveLocal } from '../platform/storage';
import { border, color, space } from '../theme';
import { Loading } from './Loading';
import { SignInForm } from './SignIn';
import { Button, Gate, Note, T, text } from './ui';

/** Where the emailed sign-in link goes after it signed in (SignInLink reads it once). */
export const AFTER_SIGNIN = 'after_signin';

const CAN = ['Place phone calls for you, and hang them up', 'Read your calls, transcripts, and recordings', 'Read and change your calling profile and call settings'];
const CANNOT = ['See your provider keys', 'Create or remove agent keys', 'Delete your account'];

export function Connect({ request }: { request: string | undefined }) {
  const { me, error: sessionError, reload } = useSession();
  const [info, setInfo] = useState<{ client_name: string; redirect_host: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(!request);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const signedIn = !!me?.signed_in;

  useEffect(() => {
    if (!me || signedIn || !request) return;
    saveLocal(AFTER_SIGNIN, `/connect?request=${encodeURIComponent(request)}`); // come back here after the email link
  }, [me, signedIn, request]);

  useEffect(() => {
    if (!signedIn || !request) return;
    let stop = false;
    api.oauthRequest(request).then(
      (r) => !stop && setInfo(r),
      (e) => !stop && (e instanceof ApiError && e.status === 404 ? setGone(true) : setError((e as Error).message)),
    );
    return () => {
      stop = true;
    };
  }, [signedIn, request]);

  const answer = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'deny');
    setError(null);
    try {
      const { redirect_to } = await api.answerOauthRequest(request!, approve);
      window.location.assign(redirect_to); // back to the agent
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setError((e as Error).message);
      setBusy(null);
    }
  };

  if (!me)
    return (
      <Gate>
        <Loading error={sessionError} retry={() => void reload()} label="Loading" />
      </Gate>
    );
  if (gone)
    return (
      <Gate>
        <Text style={text.brand}>CallEnvoy</Text>
        <T v="h1">This request has expired</T>
        <T v="muted">A sign-in request from an agent works for a few minutes. Start the sign-in again from your agent.</T>
      </Gate>
    );
  if (!signedIn)
    return (
      <Gate>
        <Text style={text.brand}>CallEnvoy</Text>
        <T v="h1">Sign in to connect your agent</T>
        <T v="muted">An AI agent wants to use your CallEnvoy account. Sign in first. The link in the email brings you back to this page, in this browser.</T>
        <SignInForm fieldId="connect-email" />
      </Gate>
    );
  if (!info)
    return (
      <Gate>
        <Loading error={error} label="Loading the request" />
      </Gate>
    );
  return (
    <Gate>
      <Text style={text.brand}>CallEnvoy</Text>
      <T v="h1">{`${info.client_name} wants to place calls with your CallEnvoy account`}</T>
      <T v="muted">{`You are signed in as ${me.email}. After you answer, you go back to ${info.redirect_host}.`}</T>
      <List title="It will be able to" items={CAN} />
      <List title="It will not be able to" items={CANNOT} />
      <T v="fine">The agent gets a key of its own. You can disable or delete it on the Agents page at any time.</T>
      {error ? <Note kind="errsum">{error}</Note> : null}
      <Button label={busy === 'approve' ? 'Connecting...' : `Allow ${info.client_name}`} full busy={busy === 'approve'} disabled={busy === 'deny'} onPress={() => void answer(true)} />
      <Button label={busy === 'deny' ? 'Going back...' : 'Deny'} kind="secondary" full busy={busy === 'deny'} disabled={busy === 'approve'} onPress={() => void answer(false)} />
    </Gate>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={s.list}>
      <Text style={text.label}>{title}</Text>
      <View role="list">
        {items.map((it) => (
          <Text key={it} role="listitem" style={[text.base, s.item]}>
            {it}
          </Text>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  list: { borderTopWidth: border.thin, borderTopColor: color.line, paddingTop: space.ml },
  item: { paddingVertical: space.xxs },
});
