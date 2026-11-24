// Typed client for the CallEnvoy console API (plan sections 3, 4, 4a).

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''; // same origin, at the root of the host
/** Where the console's own static files (sw.js, mic-worklet.js, icon) are served: the export's base path.
 *  Not API_BASE: in local dev the API is on another origin, and a service worker must be same-origin. */
export const WEB_BASE = process.env.EXPO_BASE_URL || '';

export type CallStatus = 'queued' | 'dialing' | 'in_progress' | 'completed' | 'no_answer' | 'busy' | 'failed' | 'canceled';
export type Phase = 'menu' | 'on_hold' | 'talking' | 'connecting_owner' | 'owner_on_call' | null;
export type OwnerState = 'none' | 'alerting' | 'ringing' | 'listening' | 'on_call';
export type Mode = 'handle' | 'transfer';
export type Reach = 'app' | 'phone' | 'app_then_phone';
export type NoAnswer = 'ai_handles' | 'end_politely';

/** `at`: seconds from the start of the recording to the start of the line, or null when not known. */
export type Line = { n: number; t: string; who: 'them' | 'ai' | 'owner' | 'event'; text: string; at?: number | null };
/** `kind`: null is a plain question. "permission" asks whether the call may use a saved protected detail, and
 *  "secret" asks the user to type one for this call. Only the console can answer those two (answerSecret). */
export type Question = { id: string; question: string; answer?: string; kind?: 'permission' | 'secret' | null; label?: string | null };
/** How a call went, counted by the server from the call's own records. */
export type Evals = {
  goal: string | null;
  reached_person: boolean;
  seconds_to_person: number | null;
  keys_pressed: number;
  questions_asked: number;
  ended_by: 'ai' | 'them' | 'you' | 'time_limit' | null;
  follow_up: string | null;
};
/** An estimate in US dollars from list prices. The user's own providers bill it; CallEnvoy bills nothing.
 *  `complete: false`: the AI model's price is not known (the user's own service), and `total` leaves it out. */
export type Cost = { total: number; parts: { phone: number; hearing: number; ai: number | null; voice: number }; complete: boolean; model: string | null };

export type Call = {
  id: string;
  direction: 'outbound' | 'inbound'; // section 22.1: inbound = a business called back, forwarded to the owner
  calling_number: string | null; // section 22.2: caller ID used
  leave_voicemail: boolean;
  status: CallStatus;
  phase: Phase;
  finished: boolean;
  business: string;
  number: string;
  goal: string;
  mode: Mode;
  connect_when: string | null;
  reach: Reach;
  listen_in: boolean;
  alert_on_human: boolean;
  recorded: boolean;
  human_at: string | null;
  owner: { state: OwnerState; via: 'app' | 'phone' | null; alert_until: string | null; unreachable: boolean };
  open_questions: Question[];
  answered_questions: Question[];
  outcome: { result: 'done' | 'partial' | 'not_done' | 'voicemail' | 'no_human' | 'handed_to_owner'; summary: string; details: Record<string, unknown> | null } | null;
  talk_seconds: number | null;
  owner_seconds: number | null;
  error: string | null;
  created_at: string;
  ended_at: string | null;
  transcript?: Line[];
  next_line?: number;
  // Not in the plan's call shape: the recording links of get_recordings, if the server adds them.
  recordings?: { url: string; duration_seconds: number }[];
  evals?: Evals;
  cost?: Cost | null; // null until the call has ended
  secrets_allowed?: string[]; // labels of protected details this call may use
};

// Text settings are null when not set.
export type Settings = {
  name: string | null;
  callback_number: string | null;
  details: string | null;
  voice: string;
  ai_model?: string; // one of config.ai_models
  timezone?: string | null; // IANA name, so the AI knows today's date
  record_calls: boolean;
  max_minutes: number;
  mode: Mode;
  reach: Reach;
  alert_wait_seconds: number;
  phone_ring_seconds: number;
  no_answer: NoAnswer;
  alert_on_human: boolean;
  listen_in: boolean;
  alert_sound: boolean;
  alert_notification: boolean;
  alert_push: boolean;
  push_shows_business: boolean;
  caller_id: CallerId;
  leave_voicemail: boolean;
} & Record<ProfileField, string | null>;

export type CallerId = 'callenvoy' | 'own';

/** Optional calling-profile text fields (plan section 22.4). */
export type ProfileField =
  | 'name_pronunciation'
  | 'assistant_name'
  | 'email'
  | 'address'
  | 'date_of_birth'
  | 'insurance_carrier'
  | 'insurance_member_id'
  | 'insurance_group_number'
  | 'dental_insurance_carrier'
  | 'dental_insurance_member_id'
  | 'vehicle'
  | 'vin'
  | 'frequent_flyer_numbers'
  | 'known_traveler_number'
  | 'redress_number';

/** `provider`: who speaks this voice. The list holds only the voices this user can use. */
export type Voice = { name: string; gender: string; accent: string; style: string; sample_url: string; default?: boolean; provider?: SpeechProvider };
export type SpeechProvider = 'fish' | 'openai';
export type HearingProvider = 'deepgram' | 'openai';

/** Whose keys place this user's calls. `ready`: real calls can be placed (own Twilio and OpenAI keys, or the
 *  server's for the admin). Without that, only the free demo-line calls (`demo_calls_left`). */
export type KeysState = { ready: boolean; server_keys: boolean; demo_calls_left: number; can_save: boolean };

/** `llm`: another OpenAI-compatible AI service for the talking (optional). */
export type ProviderName = 'twilio' | 'openai' | 'deepgram' | 'fish' | 'llm';
/** A saved provider key as shown: never the key, only a hint such as "AC...a3a8". */
export type ProviderKey = { saved: boolean; hint: string | null; checked_at: string | null; from_number?: string | null; note?: string | null; base_url?: string | null; model?: string | null };
export type Providers = {
  can_save: boolean; // false: the server has no encryption key, so nobody can save keys
  ready: boolean;
  server_keys: boolean; // the admin: calls use the server's own keys
  hearing: HearingProvider;
  voice_provider: SpeechProvider;
  inbound_url: string; // the voice webhook for the user's Twilio number (callbacks from a business)
  llm_services?: Record<string, string>; // name -> address of the AI services this server allows
  llm_any_host?: boolean; // a self-hosted server that allows any address
  providers: Record<Exclude<ProviderName, 'llm'>, ProviderKey> & { llm?: ProviderKey };
};
/** A protected detail as listed: the label and a hint, never the value. */
export type Secret = { label: string; hint: string; created_at: string };
export type Secrets = { can_save: boolean; secrets: Secret[] };
/** `price`: dollars per 1M tokens (input, cached input, output); null when not known. */
export type AiModel = { id: string; about: string; price: [number, number, number] | null };
export type TwilioKeys = { account_sid: string; auth_token: string; from_number: string };

export type Config = {
  app_name: string;
  mcp_url: string;
  voices: Voice[];
  /** Per user. `minutes_used_today` is the same number as `my_minutes_today` (kept for older consoles). */
  limits: { max_call_minutes: number; max_concurrent_calls: number; daily_minute_cap: number; minutes_used_today?: number; my_minutes_today?: number };
  keys?: KeysState;
  ai_models?: AiModel[];
  voice_provider?: SpeechProvider;
  hearing?: HearingProvider;
  ranges: Record<'max_minutes' | 'alert_wait_seconds' | 'phone_ring_seconds', [number, number]>;
  text_limits: Record<string, number>;
  vapid_public_key: string | null;
  /** The server's own test line, to pre-fill a first call. null: this server has none (most self-hosted ones). */
  demo?: { number: string; business: string; goal: string; facts: string; menu_tips: string } | null;
};

/** The place_call fields (the console form sends the same). */
export type NewCall = {
  to: string;
  business: string;
  goal: string;
  facts?: string;
  menu_tips?: string;
  flexibility?: string;
  on_behalf_of?: string;
  mode?: Mode;
  connect_when?: string;
  reach?: Reach;
  alert_on_human?: boolean;
  listen_in?: boolean;
  alert_wait_seconds?: number;
  no_answer?: NoAnswer;
  max_minutes?: number;
  voice?: string;
  record?: boolean;
  from?: CallerId;
  leave_voicemail?: boolean;
  /** Labels of saved protected details this call may give. Counts only from the console. */
  allow_secrets?: string[];
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly field?: string, readonly code?: string) {
    super(message);
  }
}

/** An agent key as listed; the full key is only in the answer to createKey. */
export type ApiKey = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; disabled: boolean };
/** `first_run`: the user has no profile name yet (the console shows the welcome steps).
 *  `demo`: this server has a demo line (absent on an older server: then it has one). */
export type AuthMe = { signed_in: boolean; email: string | null; mail_ready: boolean; is_admin: boolean; signups_open: boolean; first_run: boolean; demo?: boolean };
/** A user as the admin sees them: usage only. */
export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_seen_at: string | null;
  disabled: boolean;
  is_admin: boolean;
  calls: number;
  minutes: number;
  minutes_today: number;
  live_calls: number;
  own_keys?: boolean; // has saved Twilio and OpenAI keys (else: demo calls only)
};

let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

// The console signs in with the session cookie; agents use keys.
async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Cannot reach the CallEnvoy server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = toError(res.status, data);
    if (res.status === 401 && (err.code === 'session_expired' || err.code === 'no_credential')) onUnauthorized();
    throw err;
  }
  return data as T;
}

// Errors come as {detail, field?} or, for sign-in and keys, {error, code}.
function toError(status: number, data: { detail?: unknown; field?: string; error?: unknown; code?: string } | null): ApiError {
  const msg = typeof data?.detail === 'string' ? data.detail : typeof data?.error === 'string' ? data.error : null;
  if (status === 401) return new ApiError('You are signed out. Sign in again.', 401, undefined, data?.code);
  if (msg) return new ApiError(msg, status, data?.field, data?.code);
  return new ApiError(`The server answered with an error (${status}). Try again.`, status, undefined, data?.code);
}

export const api = {
  config: () => request<Config>('GET', '/api/config'),
  listCalls: (limit: number) => request<Call[]>('GET', `/api/calls?limit=${limit}`),
  placeCall: (body: NewCall) => request<{ id: string }>('POST', '/api/calls', body),
  getCall: (id: string, waitSeconds: number, sinceLine: number, signal?: AbortSignal) =>
    request<Call>('GET', `/api/calls/${encodeURIComponent(id)}?wait_seconds=${waitSeconds}&since_line=${sinceLine}`, undefined, signal),
  hangUp: (id: string) => request<unknown>('POST', `/api/calls/${encodeURIComponent(id)}/hang-up`),
  answer: (id: string, question_id: string, answer: string) =>
    request<unknown>('POST', `/api/calls/${encodeURIComponent(id)}/answer`, { question_id, answer }),
  connect: (id: string, mode: 'join' | 'listen', reach: 'phone' | 'app') =>
    request<unknown>('POST', `/api/calls/${encodeURIComponent(id)}/connect`, { mode, reach }),
  handBack: (id: string) => request<unknown>('POST', `/api/calls/${encodeURIComponent(id)}/hand-back`),
  audioTicket: (id: string) => request<{ ticket: string; expires_in: number }>('POST', `/api/calls/${encodeURIComponent(id)}/audio-ticket`),
  profile: () => request<Settings>('GET', '/api/profile'),
  saveProfile: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/profile', patch),
  addPushDevice: (sub: { endpoint: string; keys: { p256dh: string; auth: string }; label: string }) =>
    request<unknown>('POST', '/api/push/subscriptions', sub),
  removePushDevice: (endpoint: string) => request<unknown>('DELETE', '/api/push/subscriptions', { endpoint }),
  testPush: () => request<{ sent: number }>('POST', '/api/push/test'),
  callerId: () => request<{ number: string | null; verified: boolean }>('GET', '/api/caller-id'),
  verifyCallerId: () => request<{ validation_code: string | null }>('POST', '/api/caller-id/verify'),
  me: () => request<AuthMe>('GET', '/api/auth/me'),
  requestLink: (email: string) => request<{ ok: true }>('POST', '/api/auth/request', { email }),
  verifyLink: (token: string) => request<{ ok: true; email: string }>('POST', '/api/auth/verify', { token }),
  signOut: () => request<unknown>('POST', '/api/auth/sign-out'),
  keys: () => request<{ keys: ApiKey[] }>('GET', '/api/keys'),
  createKey: (name: string) => request<ApiKey & { key: string }>('POST', '/api/keys', { name }),
  updateKey: (id: string, patch: { disabled?: boolean; name?: string }) => request<ApiKey>('PATCH', `/api/keys/${encodeURIComponent(id)}`, patch),
  deleteKey: (id: string) => request<unknown>('DELETE', `/api/keys/${encodeURIComponent(id)}`),
  users: () => request<{ signups_open: boolean; users: AdminUser[] }>('GET', '/api/admin/users'),
  updateUser: (id: string, disabled: boolean) => request<unknown>('PATCH', `/api/admin/users/${encodeURIComponent(id)}`, { disabled }),
  removeUser: (id: string) => request<unknown>('DELETE', `/api/admin/users/${encodeURIComponent(id)}`),
  setSignups: (open: boolean) => request<unknown>('PUT', '/api/admin/settings', { signups_open: open }),
  providers: () => request<Providers>('GET', '/api/providers'),
  /** The server checks the key with the provider before it saves; a bad key is a 400 with `field`. */
  saveProvider: (name: ProviderName, body: TwilioKeys | { api_key: string } | { base_url: string; api_key: string; model: string }) =>
    request<Providers>('PUT', `/api/providers/${name}`, body),
  removeProvider: (name: ProviderName) => request<Providers>('DELETE', `/api/providers/${name}`),
  secrets: () => request<Secrets>('GET', '/api/secrets'),
  saveSecret: (label: string, value: string) => request<Secrets>('POST', '/api/secrets', { label, value }),
  deleteSecret: (label: string) => request<Secrets>('DELETE', `/api/secrets/${encodeURIComponent(label)}`),
  /** The user's answer about a protected detail on a live call: allow a saved one, or type one (`value`). */
  answerSecret: (id: string, question_id: string, allow: boolean, value?: string) =>
    request<unknown>('POST', `/api/calls/${encodeURIComponent(id)}/secret`, { question_id, allow, ...(value != null ? { value } : {}) }),
  /** Changes a live call's mode or its "alert me" switch. Returns the call without the transcript. */
  setMode: (id: string, patch: { mode?: Mode; alert_on_human?: boolean }) => request<Call>('POST', `/api/calls/${encodeURIComponent(id)}/mode`, patch),
  deleteAccount: (confirm: string) => request<unknown>('DELETE', '/api/account', { confirm }),
  /** An agent's sign-in request (the /connect page). 404: expired or unknown. */
  oauthRequest: (id: string) => request<{ client_name: string; redirect_host: string }>('GET', `/api/oauth/request/${encodeURIComponent(id)}`),
  answerOauthRequest: (id: string, approve: boolean) => request<{ redirect_to: string }>('POST', `/api/oauth/request/${encodeURIComponent(id)}`, { approve }),
};

