import { useLocalSearchParams } from 'expo-router';
import { Connect } from '../components/Connect';

/** /connect?request=...: the browser step of an agent's sign-in (allow or deny). */
export default function ConnectScreen() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  return <Connect request={request} />;
}
