import { useState } from 'react';
import { View } from 'react-native';
import { KeysCard, SetupCard, SignInCard, ToolsCard, useConnectionCheck, useKeys, type FreshKey } from '../components/Agents';
import { Loading } from '../components/Loading';
import { Screen, T } from '../components/ui';
import { useSettings } from '../hooks';

/** Agents: sign in from an agent (no key), or use a key; and what the agent can do. */
export default function AgentsScreen() {
  const { config, error, reload } = useSettings();
  const keys = useKeys();
  const [fresh, setFresh] = useState<FreshKey | null>(null); // the key just created; shown once
  const check = useConnectionCheck(fresh, keys.setKeys, keys.gen);
  return (
    <Screen>
      <View>
        <T v="h1">Agents</T>
        <T v="muted">Connect Claude, ChatGPT, Codex, Cursor, or any MCP client. Then ask it to make a call. Every call it places shows on the Calls page.</T>
      </View>
      {config ? <SignInCard url={config.mcp_url} /> : <Loading error={error} retry={reload} label="Loading the MCP address" />}
      <KeysCard {...keys} reload={() => void keys.reload()} onCreated={setFresh} fresh={fresh} check={check} />
      {config ? <SetupCard url={config.mcp_url} fresh={fresh} /> : null}
      <ToolsCard />
    </Screen>
  );
}
