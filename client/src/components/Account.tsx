import { type ReactNode, useState } from 'react';
import { Text } from 'react-native';
import { api, ApiError } from '../api';
import { useCalls, useSession } from '../hooks';
import { Button, Card, Note, Sheet, Stack, StatusLine, T, TextField, text } from './ui';

/** Sign out, asking first when a call is live. `ask` starts it; render `sheet` once; `error` when it failed. */
export function useSignOut(): { ask: () => void; sheet: ReactNode; error: string | null } {
  const { signOut } = useSession();
  const { calls } = useCalls();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = calls?.some((c) => !c.finished);
  const out = async () => {
    setConfirm(false);
    setError(null);
    try {
      await signOut();
    } catch {
      setError('Could not sign out. Try again.');
    }
  };
  const sheet = (
    <Sheet title="Sign out while a call is live?" visible={confirm} onClose={() => setConfirm(false)}>
      <T v="soft">The call goes on. You will not get alerts in this browser until you sign in again.</T>
      <Button label="Sign out" kind="danger" full onPress={() => void out()} />
      <Button label="Stay signed in" kind="secondary" full onPress={() => setConfirm(false)} />
    </Sheet>
  );
  return { ask: () => (live ? setConfirm(true) : void out()), sheet, error };
}

/** Settings > Account: who is signed in, Sign out, and Delete account. */
export function AccountCard({ id }: { id?: string }) {
  const { me } = useSession();
  const out = useSignOut();
  return (
    <Card label="Account" id={id}>
      <Stack gap={0}>
        <T v="h2">Account</T>
        <StatusLine first title="Signed in" help={me?.email ?? undefined} right={<Button label="Sign out" kind="secondary" size="small" onPress={out.ask} />} />
        {out.error ? (
          <Text role="alert" style={text.err}>
            {out.error}
          </Text>
        ) : null}
        <DeleteAccount />
      </Stack>
      {out.sheet}
    </Card>
  );
}

/** Deletes the account and everything stored for it, after the user types their address. */
function DeleteAccount() {
  const { me, reload } = useSession();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = me?.email ?? '';
  if (me?.is_admin)
    return <StatusLine title="Delete account" help="The admin account cannot be deleted here. It owns the server's settings." />;
  const close = () => {
    setOpen(false);
    setTyped('');
    setError(null);
  };
  const remove = async () => {
    if (typed.trim().toLowerCase() !== email.toLowerCase()) return setError(`Type ${email} to confirm.`);
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(email);
      await reload(); // signed out now: the start page shows
    } catch (e) {
      // 401: the account is already gone
      if (e instanceof ApiError && e.status === 401) return void reload();
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <StatusLine
        title="Delete account"
        help="Removes your account and everything stored for it. This cannot be undone."
        right={<Button label="Delete account" kind="outline" size="small" onPress={() => setOpen(true)} />}
      />
      <Sheet title="Delete your account?" visible={open} onClose={close}>
        <T v="soft">This deletes, for good:</T>
        <T v="base">Your calls, transcripts, and the recordings kept on this server. Your profile and settings. Your agent keys and provider keys. The devices that get alerts.</T>
        <T v="fine">Live calls are hung up. Recordings that your own Twilio account holds stay there; delete them in Twilio.</T>
        <TextField label={`Type ${email} to confirm`} value={typed} onChangeText={setTyped} autoCapitalize="none" autoComplete="off" error={error} onSubmitEditing={remove} />
        {busy ? <Note kind="hint">Deleting your account...</Note> : null}
        <Button label={busy ? 'Deleting...' : 'Delete my account'} kind="danger" full busy={busy} onPress={remove} />
        <Button label="Keep my account" kind="secondary" full onPress={close} />
      </Sheet>
    </>
  );
}
