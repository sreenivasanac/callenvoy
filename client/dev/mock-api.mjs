// Dev-only mock of the CallEnvoy console API (plan sections 4, 4a, 10a, 22; round 2 A1-A4; round 3 A1-A5b) with sample calls.
// Not part of the export. Serves client/dist at / too, so the real export can be checked.
//   node dev/mock-api.mjs            -> http://localhost:3020/   (admin: dana@example.com, agent key: dev-key)
// Users: dana@example.com (admin: the server's provider keys, sample calls and agent keys), sam@example.com (new: no
// name, no calls, no keys, 2 free demo calls), riya@example.com (own Twilio and OpenAI keys), and a disabled user. Any other address can sign up while sign-ups are on (the link is printed here).
//   GET  /__mock/signin?as=dana|sam|riya     signs this browser in as that user (sets the session cookie) and opens the console
//   GET  /__mock/last-link              the last emailed sign-in link (also printed on the console)
//   POST /__mock/mail?ready=0|1         email sign-in configured or not (GET /api/auth/me mail_ready)
//   POST /__mock/expire                 ends every session (the next request gets 401 session_expired)
//   POST /__mock/recording?fail=1|0     /r/demo answers 404 (to see the player's error state)
//   POST /__mock/recording?unknown=1|0  the call view gives duration_seconds 0 (length not known)
//   POST /__mock/calls?set=empty|many&as=dana|sam   switches that user's call list
//   POST /__mock/admin?fail=1|0          GET /api/admin/users answers 500 (to see the People error state)
//   POST /__mock/socket?id=<call>&send=replaced|error|drop   acts on that call's open audio socket
//   POST /__mock/alert?id=<call>&state=alerting|none&seconds=20   starts or ends an alert (a new alert_until each time)
//   GET  /__mock/count?id=<call>                           how often GET /api/calls/<id> was asked
//   POST /__mock/demo?on=0|1             the server has a demo line or not (config.demo null, auth/me demo false)
//   GET  /__mock/frame?path=/calls/c_alert&w=390&h=844   that page in a phone-size frame, centered (a headless Chrome window cannot be
//                                        narrower than 500 px; dev/make-screenshots.sh takes the phone picture from this)
//   POST /__mock/anyhost?on=0|1          "another AI service" may be any address (a self-hosted server) or only the known ones
// Calls of dana: c_secret asks for a saved protected detail (permission) and for one to type (secret).
//   POST /__mock/keys?can_save=0|1       key saving on or off (the server has an encryption key or not)
//   /connect?request=demo                an agent's sign-in request ("Claude Desktop"); request=expired answers 404
// Provider keys: a Twilio SID that is not AC + 32 hex, a token or key with "bad" in it, or an OpenAI key without sk- is refused.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 3020);
const DIST = path.resolve(import.meta.dirname, '../dist');
const VOICE_DIR = path.resolve(import.meta.dirname, '../../callenvoy/static/voices');
const OWNER_EMAIL = 'dana@example.com'; // the admin (OWNER_EMAIL on the server)
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;

const VOICES = [
  ['Hannah', 'female', 'US', 'professional, friendly, clear'],
  ['Sarah', 'female', 'US', 'young, soft, conversational'],
  ['Laura', 'female', 'US', 'warm, calm, deeper'],
  ['Sophia', 'female', 'British', 'professional'],
  ['Ethan', 'male', 'US', 'clear, calm, professional'],
  ['Adrian', 'male', 'US', 'deep, slow, steady'],
  ['Jordan', 'male', 'US', 'older, confident, measured'],
  ['Rohan', 'male', 'Indian English', 'professional, measured'],
  ['Vikram', 'male', 'Indian English', 'calm, steady, middle-aged'],
  ['Meera', 'female', 'Indian English', 'friendly, professional, middle-aged'],
].map(([name, gender, accent, style]) => ({ name, gender, accent, style, provider: 'fish', sample_url: `/static/voices/${name.toLowerCase()}.mp3`, default: name === 'Hannah' }));
// The voices of a user without a Fish Audio key (the sample files here are stand-ins).
const OPENAI_VOICES = [
  ['Marin', 'female', 'US', 'warm, natural', 'sarah'], ['Coral', 'female', 'US', 'bright, friendly', 'hannah'], ['Sage', 'female', 'US', 'calm, even', 'laura'],
  ['Cedar', 'male', 'US', 'warm, steady', 'ethan'], ['Ash', 'male', 'US', 'clear, direct', 'jordan'], ['Onyx', 'male', 'US', 'deep, measured', 'adrian'],
].map(([name, gender, accent, style, file]) => ({ name, gender, accent, style, provider: 'openai', sample_url: `/static/voices/${file}.mp3`, default: name === 'Marin' }));

const newProfile = (over = {}) => ({
  name: null, callback_number: null, details: null,
  voice: 'Hannah', ai_model: 'gpt-6-luna', timezone: null, record_calls: true, max_minutes: 30, mode: 'handle', reach: 'app_then_phone', alert_wait_seconds: 20,
  phone_ring_seconds: 25, no_answer: 'ai_handles', alert_on_human: true, listen_in: false, alert_sound: true,
  alert_notification: true, alert_push: true, push_shows_business: true, caller_id: 'callenvoy', leave_voicemail: true,
  name_pronunciation: null, assistant_name: null, email: null, address: null, date_of_birth: null,
  insurance_carrier: null, insurance_member_id: null, insurance_group_number: null, dental_insurance_carrier: null,
  dental_insurance_member_id: null, vehicle: null, vin: null, frequent_flyer_numbers: null, known_traveler_number: null, redress_number: null,
  ...over,
});
// As the server's config.SETTINGS: text fields with their max length, int fields with their range.
const TEXT_LIMITS = { name: 80, timezone: 60, details: 3000, name_pronunciation: 80, assistant_name: 30, email: 120, address: 300, date_of_birth: 40,
  insurance_carrier: 80, insurance_member_id: 60, insurance_group_number: 60, dental_insurance_carrier: 80, dental_insurance_member_id: 60,
  vehicle: 120, vin: 40, frequent_flyer_numbers: 300, known_traveler_number: 40, redress_number: 40 };
const RANGES = { max_minutes: [1, 120], alert_wait_seconds: [5, 120], phone_ring_seconds: [10, 60] };
// As config.py: CallEnvoy's demo line, to pre-fill a first call (round 3 A5b).
const DEMO = { number: '+16562405137', business: 'Northstar Internet', goal: 'Ask billing to remove a wrong charge of 30 dollars on the October bill and get a reference number.',
  facts: 'Service address: 12 Oak Street, Springfield.', menu_tips: 'Billing is option 1.' };
const DAILY_MINUTE_CAP = 240;
let demoOn = true; // this server has a demo line
let anyHost = false; // another AI service: any address allowed (LLM_ANY_HOST=1 on a self-hosted server)
// As config.py: the AI models with list prices per 1M tokens (input, cached input, output), and the other list prices.
const AI_MODELS = [
  { id: 'gpt-6-luna', about: 'fast and the cheapest', price: [0.1, 0.01, 0.5] },
  { id: 'gpt-6.1-terra', about: 'stronger, about 10 times the price', price: [1, 0.05, 5] },
  { id: 'gpt-4.1', about: 'the earlier default; OpenAI ends it on January 14, 2027', price: [2, 0.5, 8] },
];
const PRICES = { twilio_minute: 0.014, twilio_stream_minute: 0.004, twilio_recording_minute: 0.0025, stt_minute: { deepgram: 0.0077, openai: 0.006 }, tts_1k_chars: { fish: 0.015, openai: 0.016 } };
const LLM_SERVICES = { 'Google Gemini': 'https://generativelanguage.googleapis.com/v1beta/openai', OpenRouter: 'https://openrouter.ai/api/v1', Groq: 'https://api.groq.com/openai/v1',
  Together: 'https://api.together.xyz/v1', Fireworks: 'https://api.fireworks.ai/inference/v1', Cerebras: 'https://api.cerebras.ai/v1', DeepSeek: 'https://api.deepseek.com/v1',
  Mistral: 'https://api.mistral.ai/v1', xAI: 'https://api.x.ai/v1', OpenAI: 'https://api.openai.com/v1' };
/** As usage.cost: an estimate from list prices, null until the call has ended (or when it never connected). */
function costOf(c) {
  if (!c.finished || !c.talk_seconds) return null;
  const min = Math.ceil(c.talk_seconds / 60);
  const custom = c.ai_model === 'custom';
  const parts = { phone: +(min * (0.014 + 0.004 + (c.recorded ? 0.0025 : 0))).toFixed(4), hearing: +((c.talk_seconds / 60) * 0.0077).toFixed(4),
    ai: custom ? null : +(c.talk_seconds * 0.000004).toFixed(4), voice: +(c.talk_seconds * 0.00004).toFixed(4) };
  return { total: +Object.values(parts).reduce((n, v) => n + (v ?? 0), 0).toFixed(3), parts, complete: !custom, model: custom ? 'llama-4-fast' : 'gpt-6-luna' };
}
/** As calls.evals: plain measures counted from the call's own records. */
function evalsOf(c) {
  const events = c.transcript.filter((l) => l.who === 'event').map((l) => l.text);
  const person = c.transcript.find((l) => l.who === 'ai' && l.at != null);
  return { goal: c.outcome?.result ?? null, reached_person: !!person || !!c.owner_seconds, seconds_to_person: person ? Math.round(c.transcript.findLast((l) => l.who === 'them' && l.at != null && l.at < person.at)?.at ?? person.at) : null,
    keys_pressed: events.filter((e) => e.startsWith('pressed ')).length, questions_asked: c.answered_questions.length + c.open_questions.length,
    ended_by: !c.finished ? null : c.outcome?.summary === 'You hung up the call.' ? 'you' : events.some((e) => /ended by AI/i.test(e)) ? 'ai' : 'them', follow_up: c.follow_up ?? null };
}
/** A call as the API sends it. */
const callView = (c) => ({ ...c, evals: evalsOf(c), cost: costOf(c), secrets_allowed: c.secrets_allowed ?? [], follow_up: undefined, ai_model: undefined });
const graces = new Map(); // call id -> the drop-grace timer (kept off the call object: it is sent as JSON)

const line = (n, sAgo, who, text) => ({ n, t: iso(sAgo * 1000), who, text, at: null });
// The demo recording: the voice samples (CBR 128 kb/s mp3 frames) one after the other, twice: about 2 minutes.
const voiceFiles = fs.existsSync(VOICE_DIR) ? fs.readdirSync(VOICE_DIR).filter((f) => f.endsWith('.mp3')).sort() : [];
const one = Buffer.concat(voiceFiles.map((f) => fs.readFileSync(path.join(VOICE_DIR, f))));
const RECORDING = Buffer.concat([one, one]);
const RECORDING_SECONDS = Math.round((RECORDING.length * 8) / 128000) || 120;
let recordingFails = false;
const holdLines = (s, who = 'Northstar Internet', dialed = '+1 (656) 240-5137', menu = 'For billing, press 1. For technical support, press 2.') => [
  line(0, s, 'event', `Dialing ${dialed}`),
  line(1, s - 4, 'them', `Thank you for calling ${who}. ${menu}`),
  line(2, s - 6, 'event', 'pressed 1'),
  line(3, s - 19, 'them', 'All of our agents are busy. Your call is important to us. Please continue to hold.'),
  line(4, s - 20, 'event', 'waiting on hold'),
];
// A finished call with `at` (seconds into the recording). Fragments of one speaker close together show as one bubble.
const doneLines = (createdAgo) => [
  [null, 'event', 'Dialing +1 (656) 240-5137'],
  [0.8, 'them', 'Thank you for calling Northstar Internet.'],
  [3.1, 'them', 'For billing, press 1. For technical support, press 2.'],
  [6.0, 'event', 'pressed 1'],
  [9.5, 'them', 'All of our agents are busy. Please continue to hold.'],
  [12.0, 'event', 'waiting on hold'],
  [24.2, 'them', 'Hi, thanks for holding, this is Maria in billing. How can I help?'],
  [29.0, 'ai', 'Hi Maria, I am calling on behalf of Dana Reyes about her bill.'],
  [33.4, 'ai', 'It went from 65 to 130 dollars after a plan change she did not ask for.'],
  [40.6, 'them', 'I see that. What is the service address on the account?'],
  [45.2, 'ai', 'One moment, let me check that.'],
  [47.0, 'event', 'asked owner: What is the service address on the account?'],
  [58.7, 'ai', 'It is 1820 SE Alder St, Apartment 4, Portland, Oregon.'],
  [66.3, 'them', 'Thank you. I moved the account back to the old plan.'],
  [70.1, 'them', 'And I added a 65 dollar credit. It shows on the next bill.'],
  [null, 'ai', 'Thank you. Could I have a reference number?'], // start not known: not clickable
  [88.4, 'them', 'Sure, it is N S 4 8 2 1 3 K.'],
  [97.9, 'ai', 'N S 4 8 2 1 3 K. Thanks so much, Maria. Goodbye.'],
  [104.5, 'them', 'Goodbye, have a nice day.'],
  [110.0, 'event', 'call ended by AI'],
].map(([at, who, text], n, all) => {
  const sec = at ?? (n ? all[n - 1][0] + 8 : 0); // a line without `at` still has a time
  return { n, t: new Date(Date.now() - createdAgo + (6 + sec) * 1000).toISOString(), who, text, at: who === 'event' ? null : at };
});
const base = (id, over) => ({
  id, direction: 'outbound', status: 'in_progress', phase: 'talking', finished: false, business: 'Northstar Internet', number: '+16562405137',
  goal: 'My bill went from $65 to $130 after a plan change I did not ask for. Get the plan change reversed and the extra charge credited. Ask for a reference number.',
  mode: 'handle', connect_when: null, reach: 'app_then_phone', listen_in: false, alert_on_human: true, recorded: true, leave_voicemail: true,
  calling_number: '+19186021019', human_at: null, owner: { state: 'none', via: null, alert_until: null, unreachable: false },
  open_questions: [], answered_questions: [], outcome: null, talk_seconds: 0, owner_seconds: 0, error: null,
  created_at: iso(11 * MIN), ended_at: null, transcript: [], next_line: 0, recordings: [], ...over,
});

function sampleCalls() {
  return [
    base('c_alert', { phase: 'connecting_owner', mode: 'transfer', owner: { state: 'alerting', via: 'app', alert_until: null, unreachable: false },
      transcript: [...holdLines(655), line(5, 18, 'them', 'Hi, thanks for holding, this is Maria in billing. How can I help?'),
        line(6, 15, 'ai', 'Hi, I am calling on behalf of Dana Reyes. One moment please, I am bringing them on the line.'), line(7, 14, 'event', 'alert sent')] }),
    base('c_talk', { business: 'Summit Health Insurance', number: '+18885550193', created_at: iso(12 * MIN),
      open_questions: [{ id: 'q_1', question: 'What is the service address on the account?' }],
      transcript: [...holdLines(715), line(5, 40, 'them', 'Thanks. And what is the service address on the account?'),
        line(6, 37, 'ai', 'One moment, let me check that.'), line(7, 36, 'event', 'asked owner: What is the service address on the account?')] }),
    base('c_secret', { business: 'Evergreen Credit Union', number: '+15035550161', created_at: iso(7 * MIN), secrets_allowed: [],
      goal: 'Ask why the debit card was declined yesterday and get it unblocked.',
      open_questions: [{ id: 'q_p', question: 'The call asks for your SSN. Allow it for this call?', kind: 'permission', label: 'SSN' },
        { id: 'q_s', question: 'The call asks for: Card PIN. Type it to give it on this call only.', kind: 'secret', label: 'Card PIN' }],
      transcript: [...holdLines(415, 'Evergreen Credit Union', '+1 (503) 555-0161', 'For card services, press 1. For loans, press 2.'), line(5, 30, 'them', 'This is Jordan in card services. To open the account I need the last four of the Social Security number and the card PIN.'),
        line(6, 27, 'ai', 'One moment.'), line(7, 26, 'event', 'asked owner: The call asks for your SSN. Allow it for this call?')] }),
    base('c_hold', { business: 'Cascade Power & Light', number: '+15035550178', phase: 'on_hold', created_at: iso(4 * MIN), transcript: holdLines(230) }),
    base('c_phone', { business: 'Bayview Dental', number: '+14155550126', phase: 'owner_on_call', created_at: iso(6 * MIN),
      owner: { state: 'on_call', via: 'phone', alert_until: null, unreachable: false },
      transcript: [...holdLines(350), line(5, 30, 'event', 'owner took the call'), line(6, 20, 'owner', 'Hi, this is Dana. I would like to move my cleaning to next week.')] }),
    base('c_done', { status: 'completed', phase: null, finished: true, created_at: iso(60 * MIN), ended_at: iso(60 * MIN - (RECORDING_SECONDS + 6) * 1000), talk_seconds: RECORDING_SECONDS,
      outcome: { result: 'done', summary: 'Maria in billing moved the account back to the old plan and added a $65 credit, which shows on the next bill.', details: { reference_number: 'NS48213K', credit: '$65.00, next bill' } },
      answered_questions: [{ id: 'q_0', question: 'What is the service address on the account?', answer: '1820 SE Alder St, Apt 4, Portland OR 97214' }],
      recordings: [{ url: '/r/demo', duration_seconds: RECORDING_SECONDS }],
      transcript: doneLines(60 * MIN) }),
    base('c_partial', { business: 'Lakeview Fitness', number: '+15035550133', status: 'completed', phase: null, finished: true, created_at: iso(5 * 60 * MIN), ended_at: iso(5 * 60 * MIN - 236_000), talk_seconds: 236,
      goal: 'Ask whether the monthly plan can switch to the yearly offer, and whether the annual fee already paid carries over.', secrets_allowed: ['Member PIN'], ai_model: 'custom',
      follow_up: 'Visit the club between 12 and 5 to switch the plan at the front desk.',
      outcome: { result: 'partial', summary: 'Jared at the club said the switch is possible but must be done in person. Whether the annual fee carries over was not confirmed.', details: { spoke_to: 'Jared', best_time: '12:00 to 5:00' } },
      recordings: [{ url: '/r/demo', duration_seconds: RECORDING_SECONDS }],
      transcript: [[null, 'event', 'Dialing +1 (503) 555-0133'], [2.0, 'them', 'Thank you for calling Lakeview Fitness. Say membership, billing, or team.'], [8.1, 'ai', 'Membership.'],
        [14.0, 'them', 'Hey, this is Jared. How may I help you?'], [18.2, 'ai', 'Hi Jared, I am calling on behalf of Dana Reyes about switching to the yearly plan.'],
        [26.0, 'them', 'Can I get the member PIN for the account?'], [29.5, 'event', 'gave Member PIN by voice'], [36.0, 'them', 'I heard the PIN as [Member PIN]. Thanks. The switch has to be done in the club.'],
        [48.0, 'ai', 'Understood. Does the annual fee that was already paid carry over?'], [55.0, 'them', 'I believe so, but the front desk has to look at it.'], [62.0, 'ai', 'Thank you, Jared. Goodbye.'], [66.0, 'event', 'call ended by AI']]
        .map(([at, who, text], n) => ({ n, t: iso(5 * 60 * MIN - (at ?? 0) * 1000), who, text, at: who === 'event' ? null : at })) }),
    base('c_handed', { business: 'City Water Billing', number: '+19715550110', status: 'completed', phase: null, finished: true, recorded: false,
      created_at: iso(26 * 60 * MIN), ended_at: iso(26 * 60 * MIN - 756_000), talk_seconds: 756, owner_seconds: 44,
      outcome: { result: 'handed_to_owner', summary: 'You took over after the AI gave the account number. The account was moved back to the old plan.', details: {} },
      transcript: [line(0, 93600, 'event', 'owner took the call'), line(1, 93590, 'owner', 'Great, thank you. Bye.')] }),
    base('c_failed', { business: 'Ridgeline Auto Insurance', number: '+18005550147', status: 'failed', phase: null, finished: true, created_at: iso(3 * 24 * 60 * MIN),
      ended_at: iso(3 * 24 * 60 * MIN), talk_seconds: 0, error: 'Twilio could not place the call: the number is not reachable.' }),
    base('c_in', { direction: 'inbound', business: 'Northstar Internet', number: '+16562405137', status: 'completed', phase: null, finished: true, recorded: false,
      created_at: iso(30 * MIN), ended_at: iso(28 * MIN), talk_seconds: 95, goal: '', calling_number: null }),
    // A business calling back right now: forwarded to the owner's phone.
    base('c_in_live', { direction: 'inbound', business: 'Northstar Internet', number: '+16562405137', phase: null, recorded: false,
      created_at: iso(MIN), talk_seconds: 60, goal: '', calling_number: null }),
  ];
}
let alertStart = Date.now();
let alertLen = 20_000;

function live(c) {
  // The alert repeats every 30 s so the countdown can be seen.
  if (c.id === 'c_alert' && (c.owner.state === 'alerting' || c.pending)) {
    if (Date.now() - alertStart > alertLen) alertStart = Date.now();
    c.owner.alert_until = new Date(alertStart + alertLen).toISOString();
  }
  if (!c.finished) c.talk_seconds = Math.round((Date.now() - Date.parse(c.created_at)) / 1000);
  // A call placed from the form moves dialing -> menu -> on hold.
  if (c.placedAt && !c.finished) {
    const s = (Date.now() - c.placedAt) / 1000;
    c.status = s < 4 ? 'dialing' : 'in_progress';
    c.phase = s < 4 ? null : s < 10 ? 'menu' : 'on_hold';
    if (s > 6 && c.transcript.length === 1) c.transcript.push(line(1, 0, 'them', `Thank you for calling ${c.business}. For billing, press 1.`));
    if (s > 9 && c.transcript.length === 2) c.transcript.push(line(2, 0, 'event', 'pressed 1'));
  }
  c.next_line = c.transcript.length;
  return c;
}

// ---- Users: each has their own calls, keys, profile and caller-ID state ----
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no look-alike characters
const newKey = () => 'ce_live_' + Array.from(crypto.randomBytes(32), (b) => ALPHABET[b % ALPHABET.length]).join('');
const withPrefix = (k) => ({ ...k, prefix: k.key.slice(0, 12) });
const DAY = 24 * 60 * MIN;
const newUser = (id, email, over = {}) => ({ id, email, created_at: iso(0), last_seen_at: iso(0), disabled: false, calls: [], keys: [], profile: newProfile(), verifiedAt: 0,
  providers: { twilio: null, openai: null, deepgram: null, fish: null, llm: null }, demoCalls: 0, secrets: [], ...over });
// ---- Provider keys: the admin uses the server's; everyone else brings Twilio and OpenAI (Deepgram and Fish are optional) ----
const DEMO_CALLS = 2; // free demo-line calls of a user without own keys
const PROVIDERS = ['twilio', 'openai', 'deepgram', 'fish', 'llm'];
let canSave = true;
const isAdmin = (u) => u.email === OWNER_EMAIL;
const keysReady = (u) => isAdmin(u) || !!(u.providers.twilio && u.providers.openai);
const hint = (v) => `${v.slice(0, 2)}...${v.slice(-4)}`;
const keysState = (u) => ({ ready: keysReady(u), server_keys: isAdmin(u), demo_calls_left: Math.max(0, DEMO_CALLS - u.demoCalls), can_save: canSave });
const hearing = (u) => (isAdmin(u) || u.providers.deepgram ? 'deepgram' : 'openai');
const voiceProvider = (u) => (isAdmin(u) || u.providers.fish ? 'fish' : 'openai');
const providersView = (u) => ({ can_save: canSave, ready: keysReady(u), server_keys: isAdmin(u), hearing: hearing(u), voice_provider: voiceProvider(u),
  inbound_url: `https://callenvoy.pragnyalabs.com/twilio/inbound/${u.id}`, llm_services: LLM_SERVICES, llm_any_host: anyHost,
  providers: Object.fromEntries(PROVIDERS.map((n) => [n, { saved: !!u.providers[n], hint: u.providers[n]?.hint ?? null, checked_at: u.providers[n]?.checked_at ?? null,
    ...(n === 'twilio' ? { from_number: u.providers.twilio?.from_number ?? null, note: null } : {}),
    ...(n === 'llm' ? { base_url: u.providers.llm?.base_url ?? null, model: u.providers.llm?.model ?? null } : {}) }])) });
const secretsView = (u) => ({ can_save: canSave, secrets: u.secrets.map(({ label, hint, created_at }) => ({ label, hint, created_at })) });
const users = [
  newUser('u_dana', OWNER_EMAIL, {
    created_at: iso(40 * DAY), last_seen_at: iso(2 * MIN), calls: sampleCalls(),
    profile: newProfile({ name: 'Dana Reyes', callback_number: '+15035550142', details: 'Home address: 1820 SE Alder St, Apt 4, Portland OR 97214', email: OWNER_EMAIL, timezone: 'America/Los_Angeles' }),
    secrets: [{ label: 'SSN', hint: 'ends in 89', created_at: iso(9 * DAY) }, { label: 'Member PIN', hint: 'saved', created_at: iso(2 * DAY) }],
    keys: [
      { id: 'k_env', name: 'First key (.env)', key: 'dev-key', created_at: iso(30 * DAY), last_used_at: iso(2 * DAY), disabled: false },
      { id: 'k_old', name: 'Old laptop, Claude Desktop with a long name', key: newKey(), created_at: iso(9 * DAY), last_used_at: null, disabled: true },
    ].map(withPrefix),
  }),
  newUser('u_sam', 'sam@example.com', { created_at: iso(3 * DAY), last_seen_at: iso(3 * DAY) }),
  newUser('u_riya', 'riya@example.com', { created_at: iso(5 * DAY), last_seen_at: iso(20 * MIN), profile: newProfile({ name: 'Riya Shah', callback_number: '+14085550164', voice: 'Marin' }),
    providers: { twilio: { hint: 'AC...91f2', from_number: '+14085550190', checked_at: iso(4 * DAY) }, openai: { hint: 'sk...Zq4A', checked_at: iso(4 * DAY) }, deepgram: null, fish: null, llm: null },
    calls: [base('c_r1', { business: 'Lakeside Dental', number: '+14085550111', status: 'completed', phase: null, finished: true, created_at: iso(2 * DAY), ended_at: iso(2 * DAY - 190_000), talk_seconds: 190, calling_number: '+14085550190',
      goal: 'Move my cleaning from Thursday to any afternoon next week.', outcome: { result: 'done', summary: 'The cleaning is moved to Tuesday at 2:30 PM with the same hygienist.', details: { new_time: 'Tuesday 2:30 PM' } } })] }),
  newUser('u_long', 'alexandra.konstantinopoulou-whitfield@longdomain-example.org', {
    created_at: iso(12 * DAY), last_seen_at: iso(6 * DAY), disabled: true, profile: newProfile({ name: 'Alexandra Konstantinopoulou-Whitfield' }),
    calls: [base('c_l1', { status: 'completed', phase: null, finished: true, created_at: iso(7 * DAY), ended_at: iso(7 * DAY - 400_000), talk_seconds: 400 })],
  }),
];
const userByEmail = (email) => users.find((u) => u.email === email.toLowerCase());
const callById = (id) => users.flatMap((u) => u.calls).find((c) => c.id === id);
const verified = (u) => !!u.verifiedAt && Date.now() > u.verifiedAt; // caller ID: verified 10 s after Verify
let signupsOpen = true;
let adminFails = false;
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const minutes = (calls) => Math.round(calls.reduce((n, c) => n + (c.talk_seconds ?? 0), 0) / 60);
/** As GET /api/admin/users: usage only, no call content. */
const usage = (u) => ({
  id: u.id, email: u.email, name: u.profile.name, created_at: u.created_at, last_seen_at: u.last_seen_at, disabled: u.disabled,
  is_admin: u.email === OWNER_EMAIL, calls: u.calls.length, minutes: minutes(u.calls), minutes_today: minutes(u.calls.filter((c) => isToday(c.created_at))),
  live_calls: u.calls.filter((c) => !c.finished).length, own_keys: !!(u.providers.twilio && u.providers.openai),
});

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': 'http://localhost:8081', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookie = (req, name) => (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const sessions = new Map(); // session id (the server stores it hashed) -> user id
const linkTokens = new Map(); // token -> { email, until } (one use, bound to one address)
const linkRequests = []; // [time, address] of POST /api/auth/request, for the rate limits
let mailReady = true;
let lastLink = null;
const newSession = (res, u) => {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, u.id);
  u.last_seen_at = iso(0);
  res.setHeader('set-cookie', `ce_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`);
};
const sessionUser = (req) => users.find((u) => u.id === sessions.get(cookie(req, 'ce_session'))) ?? null;
/** { user, kind: 'owner' | 'agent' }, or the 401 code. */
function credential(req) {
  const sid = cookie(req, 'ce_session');
  const su = sessionUser(req);
  if (su) return su.disabled ? 'account_disabled' : { user: su, kind: 'owner' };
  const h = req.headers.authorization;
  if (!h) return sid ? 'session_expired' : 'no_credential';
  const token = h.replace(/^(Bearer\s+)+/i, '').trim();
  const user = users.find((u) => u.keys.some((x) => x.key === token));
  const k = user?.keys.find((x) => x.key === token);
  if (!k) return 'bad_key';
  if (k.disabled) return 'key_disabled';
  if (user.disabled) return 'account_disabled';
  if (!k.last_used_at || Date.now() - Date.parse(k.last_used_at) > MIN) k.last_used_at = iso(0); // at most once a minute
  return { user, kind: 'agent' };
}
const ERRORS = { no_credential: 'Sign in or send an API key.', session_expired: 'Your session has ended. Sign in again.', bad_key: 'Unknown API key.', key_disabled: 'This API key is disabled.',
  account_disabled: 'This account is disabled.' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function auth(req, res, p) {
  if (p === '/api/auth/me') {
    const u = sessionUser(req);
    const on = !!u && !u.disabled;
    return send(res, 200, { signed_in: on, email: on ? u.email : null, mail_ready: mailReady, is_admin: on && u.email === OWNER_EMAIL, signups_open: signupsOpen, first_run: on && !u.profile.name, demo: demoOn });
  }
  if (p === '/api/auth/request' && req.method === 'POST') {
    const email = String((await readBody(req)).email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return send(res, 400, { error: 'Enter a valid email address.', code: 'bad_email' });
    const u = userByEmail(email);
    if (u?.disabled) return send(res, 403, { error: 'This account is disabled.', code: 'account_disabled' });
    if (!u && !signupsOpen) return send(res, 403, { error: 'New accounts are closed right now.', code: 'signups_closed' });
    // As config.py: 3 per address per hour, 60 per day in total (the mock has one client IP, so no IP limit).
    while (linkRequests.length && linkRequests[0][0] < Date.now() - DAY) linkRequests.shift();
    if (linkRequests.length >= 60 || linkRequests.filter(([t, a]) => a === email && t > Date.now() - 60 * MIN).length >= 3)
      return send(res, 429, { error: 'Too many sign-in requests. Try again later.', code: 'rate_limited' });
    linkRequests.push([Date.now(), email]);
    if (mailReady) {
      const t = crypto.randomBytes(24).toString('hex');
      linkTokens.set(t, { email, until: Date.now() + 15 * MIN });
      lastLink = `http://localhost:${PORT}/signin?token=${t}`;
      console.log(`sign-in link for ${email}: ${lastLink}`);
    }
    return send(res, 200, { ok: true });
  }
  if (p === '/api/auth/verify' && req.method === 'POST') {
    const { token } = await readBody(req);
    const link = linkTokens.get(token);
    linkTokens.delete(token);
    if (!link || link.until < Date.now()) return send(res, 400, { error: 'This sign-in link was used or has expired.', code: 'bad_link' });
    let u = userByEmail(link.email);
    if (u?.disabled) return send(res, 403, { error: 'This account is disabled.', code: 'account_disabled' });
    if (!u) users.push((u = newUser(`u_${crypto.randomBytes(4).toString('hex')}`, link.email))); // the account starts at the first sign-in
    newSession(res, u);
    return send(res, 200, { ok: true, email: u.email });
  }
  if (p === '/api/auth/sign-out' && req.method === 'POST') {
    sessions.delete(cookie(req, 'ce_session'));
    res.setHeader('set-cookie', 'ce_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { detail: 'Not found' });
}

/** Admin routes (round 3 A4): 404 for everyone but the admin; usage only. */
async function adminRoutes(req, res, p, me) {
  if (me.email !== OWNER_EMAIL) return send(res, 404, { detail: 'Not found' });
  const m = req.method;
  if (p === '/api/admin/users' && m === 'GET') {
    if (adminFails) return send(res, 500, { detail: 'The user list could not be loaded.' });
    return send(res, 200, { signups_open: signupsOpen, users: users.map(usage) });
  }
  if (p === '/api/admin/settings' && m === 'PUT') {
    const b = await readBody(req);
    if (typeof b.signups_open !== 'boolean') return send(res, 400, { detail: 'signups_open must be true or false.', field: 'signups_open' });
    signupsOpen = b.signups_open;
    return send(res, 200, { signups_open: signupsOpen });
  }
  const u = users.find((x) => x.id === /^\/api\/admin\/users\/([^/]+)$/.exec(p)?.[1]);
  if (!u) return send(res, 404, { detail: 'No user with that id.' });
  if (u === me) return send(res, 400, { detail: 'You cannot disable or remove your own account.' });
  // Live calls of that user are hung up first.
  const hangUpAll = () => u.calls.filter((c) => !c.finished).forEach((c) => Object.assign(c, { finished: true, status: 'canceled', phase: null, ended_at: iso(0) }));
  if (m === 'PATCH') {
    const b = await readBody(req);
    if (typeof b.disabled !== 'boolean') return send(res, 400, { detail: 'disabled must be true or false.', field: 'disabled' });
    u.disabled = b.disabled;
    if (u.disabled) hangUpAll();
    return send(res, 200, usage(u));
  }
  if (m === 'DELETE') {
    hangUpAll();
    users.splice(users.indexOf(u), 1);
    for (const [sid, id] of sessions) if (id === u.id) sessions.delete(sid);
    return send(res, 204);
  }
  return send(res, 404, { detail: 'Not found' });
}

const keyView = ({ key, ...k }) => k;

async function keyRoutes(req, res, p, { keys }) {
  const m = req.method;
  if (p === '/api/keys' && m === 'GET') return send(res, 200, { keys: keys.map(keyView) });
  if (p === '/api/keys' && m === 'POST') {
    const name = String((await readBody(req)).name ?? '').trim();
    if (!name || name.length > 40) return send(res, 400, { detail: 'The name must be 1-40 characters.', field: 'name' });
    if (keys.length >= 20) return send(res, 409, { detail: 'At most 20 keys. Delete one first.' });
    const key = newKey();
    const k = { id: `k_${crypto.randomBytes(4).toString('hex')}`, name, key, prefix: key.slice(0, 12), created_at: iso(0), last_used_at: null, disabled: false };
    keys.push(k);
    return send(res, 201, { ...keyView(k), key });
  }
  const k = keys.find((x) => x.id === p.split('/')[3]);
  if (!k) return send(res, 404, { detail: 'No key with that id.' });
  if (m === 'PATCH') {
    const b = await readBody(req);
    if (typeof b.disabled === 'boolean') k.disabled = b.disabled;
    if (typeof b.name === 'string' && b.name.trim()) k.name = b.name.trim().slice(0, 40);
    return send(res, 200, keyView(k));
  }
  if (m === 'DELETE') {
    keys.splice(keys.indexOf(k), 1);
    return send(res, 204);
  }
  return send(res, 404, { detail: 'Not found' });
}

/** Provider keys (console session only). The server checks a key with its provider before saving; here a short wait and shape rules stand in. */
async function providerRoutes(req, res, p, u) {
  const m = req.method;
  if (p === '/api/providers' && m === 'GET') return send(res, 200, providersView(u));
  const name = p.split('/')[3];
  if (!PROVIDERS.includes(name)) return send(res, 404, { detail: 'Not found' });
  if (m === 'DELETE') { u.providers[name] = null; if (name === 'llm' && u.profile.ai_model === 'custom') u.profile.ai_model = 'gpt-6-luna'; return send(res, 200, providersView(u)); }
  if (m !== 'PUT') return send(res, 404, { detail: 'Not found' });
  if (!canSave) return send(res, 409, { detail: 'Key saving is off on this server.' });
  const b = await readBody(req);
  await sleep(1200);
  if (name === 'twilio') {
    const sid = String(b.account_sid ?? '').trim(), token = String(b.auth_token ?? '').trim(), d = String(b.from_number ?? '').replace(/\D/g, '');
    if (!/^AC[0-9a-f]{32}$/i.test(sid)) return send(res, 400, { detail: 'An Account SID starts with AC and has 34 characters.', field: 'account_sid' });
    if (token.length < 16 || /bad/i.test(token)) return send(res, 400, { detail: 'Twilio did not accept this Account SID and Auth Token. Copy both again from the Twilio console.', field: 'auth_token' });
    if (d.length < 10 || d.length > 11) return send(res, 400, { detail: 'Enter the Twilio phone number that places the calls, like +14155550123.', field: 'from_number' });
    if (d.endsWith('0000')) return send(res, 400, { detail: 'This number is not a voice number in that Twilio account.', field: 'from_number' });
    u.providers.twilio = { hint: hint(sid), from_number: `+1${d.slice(-10)}`, checked_at: iso(0) };
  } else if (name === 'llm') {
    const base = String(b.base_url ?? '').trim().replace(/\/$/, ''), key = String(b.api_key ?? '').trim(), model = String(b.model ?? '').trim();
    if (!/^https?:\/\/.{4,}/.test(base)) return send(res, 400, { detail: "enter the service's address, starting with https://", field: 'base_url' });
    if (!anyHost && !Object.values(LLM_SERVICES).includes(base)) return send(res, 400, { detail: `this server only allows these services: ${Object.keys(LLM_SERVICES).join(', ')}. On your own server, LLM_ANY_HOST=1 allows any address`, field: 'base_url' });
    if (key.length < 8 || /bad/i.test(key)) return send(res, 400, { detail: 'the service does not accept this key', field: 'api_key' });
    if (!model || /nope/i.test(model)) return send(res, 400, { detail: 'the service refused the test request (404). The model does not exist.', field: 'model' });
    u.providers.llm = { hint: hint(key), checked_at: iso(0), base_url: base, model };
  } else {
    const key = String(b.api_key ?? '').trim();
    const who = { openai: 'OpenAI', deepgram: 'Deepgram', fish: 'Fish Audio' }[name];
    if (key.length < 12 || /bad/i.test(key) || (name === 'openai' && !key.startsWith('sk-'))) return send(res, 400, { detail: `${who} did not accept this key. Copy it again.`, field: 'api_key' });
    u.providers[name] = { hint: hint(key), checked_at: iso(0) };
  }
  return send(res, 200, providersView(u));
}

/** An agent's browser sign-in (OAuth): the /connect page reads the request and answers it. */
async function oauthRoutes(req, res, p, u) {
  const id = p.split('/')[4];
  if (id !== 'demo') return send(res, 404, { detail: 'This sign-in request has expired. Start again from your agent.' });
  if (req.method === 'GET') return send(res, 200, { client_name: 'Claude Desktop', redirect_host: 'claude.ai' });
  const b = await readBody(req);
  if (b.approve && !u.keys.some((k) => k.name === 'Claude Desktop (signed in)'))
    u.keys.push(withPrefix({ id: `k_${crypto.randomBytes(4).toString('hex')}`, name: 'Claude Desktop (signed in)', key: newKey(), created_at: iso(0), last_used_at: null, disabled: false }));
  return send(res, 200, { redirect_to: `/__mock/oauth-done?approved=${b.approve ? 1 : 0}` });
}

/** /r/demo with Range support (206, Accept-Ranges, Content-Range), as the server serves the cached mp3. */
function recording(req, res) {
  if (recordingFails || !RECORDING.length) return send(res, 404, { detail: 'No such recording.' });
  const size = RECORDING.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const head = { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes' };
  if (!m) {
    res.writeHead(200, { ...head, 'content-length': size });
    return res.end(RECORDING);
  }
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (start > end || start < 0) {
    res.writeHead(416, { 'content-range': `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...head, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
  res.end(RECORDING.subarray(start, end + 1));
}

const tickets = new Set();
const sockets = new Map(); // call id -> the open audio socket
const counts = {}; // call id -> GET /api/calls/<id> requests

async function api(req, res, p, q) {
  if (p.startsWith('/api/auth/')) return auth(req, res, p);
  const cred = credential(req);
  if (typeof cred === 'string') return send(res, 401, { error: ERRORS[cred], code: cred });
  const { user: u, kind: who } = cred;
  const { profile, calls } = u;
  // As the server: keys, push, admin and the audio ticket (it lets its holder hear and speak on a call) need a console session.
  const ownerOnly = p.startsWith('/api/keys') || p.startsWith('/api/push/') || p.startsWith('/api/admin/') || p.endsWith('/audio-ticket') || p.startsWith('/api/providers') || p.startsWith('/api/oauth/') || p === '/api/account' || p.startsWith('/api/secrets') || p.endsWith('/secret');
  if (who === 'agent' && ownerOnly) return send(res, 403, { error: 'agent keys cannot use this; sign in to the console', code: 'owner_only' });
  const origin = req.headers.origin;
  if (who === 'owner' && req.method !== 'GET' && origin && origin !== `http://localhost:${PORT}`) return send(res, 403, { detail: 'Wrong origin.' });
  if (p.startsWith('/api/keys')) return keyRoutes(req, res, p, u);
  if (p.startsWith('/api/admin/')) return adminRoutes(req, res, p, u);
  const m = req.method;
  if (p.startsWith('/api/providers')) return providerRoutes(req, res, p, u);
  if (p.startsWith('/api/oauth/request/')) return oauthRoutes(req, res, p, u);
  if (p === '/api/account' && m === 'DELETE') {
    const b = await readBody(req);
    if (isAdmin(u)) return send(res, 400, { detail: 'The admin account cannot be deleted here.' });
    if (String(b.confirm ?? '').trim().toLowerCase() !== u.email) return send(res, 400, { detail: 'Type your email address to confirm.', field: 'confirm' });
    await sleep(600);
    users.splice(users.indexOf(u), 1);
    for (const [sid, id] of sessions) if (id === u.id) sessions.delete(sid);
    res.setHeader('set-cookie', 'ce_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return send(res, 204);
  }
  if (p.startsWith('/api/secrets')) {
    if (m === 'GET') return send(res, 200, secretsView(u));
    if (m === 'POST') {
      const b = await readBody(req);
      const label = String(b.label ?? '').trim().replace(/\s+/g, ' '), value = String(b.value ?? '').trim();
      if (!canSave) return send(res, 400, { detail: 'saving is off on this server (CALLENVOY_SECRET_KEY is not set)' });
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._/#-]{0,39}$/.test(label)) return send(res, 400, { detail: 'a label is 1 to 40 letters, digits and spaces, like "SSN" or "Account PIN"', field: 'label' });
      if (!value || value.length > 200) return send(res, 400, { detail: 'a value is 1 to 200 characters', field: 'value' });
      await sleep(400);
      const old = u.secrets.find((x) => x.label.toLowerCase() === label.toLowerCase());
      const hint = value.length >= 6 ? `ends in ${value.slice(-2)}` : 'saved';
      if (old) old.hint = hint; else u.secrets.push({ label, hint, created_at: iso(0) });
      return send(res, 201, secretsView(u));
    }
    const label = decodeURIComponent(p.split('/')[3] ?? '').toLowerCase();
    const at = u.secrets.findIndex((x) => x.label.toLowerCase() === label);
    if (m !== 'DELETE' || at < 0) return send(res, 404, { detail: 'no protected detail with that label' });
    u.secrets.splice(at, 1);
    return send(res, 200, secretsView(u));
  }
  if (p === '/api/config') return send(res, 200, { app_name: 'CallEnvoy', mcp_url: 'https://callenvoy.pragnyalabs.com/mcp', demo: demoOn ? DEMO : null,
    ai_models: [...AI_MODELS, ...(u.providers.llm ? [{ id: 'custom', about: `your own service: ${u.providers.llm.model}`, price: null }] : [])], prices: PRICES,
    voices: voiceProvider(u) === 'fish' ? VOICES : OPENAI_VOICES, voice_provider: voiceProvider(u), hearing: hearing(u), keys: keysState(u),
    limits: { max_call_minutes: 120, max_concurrent_calls: 2, daily_minute_cap: DAILY_MINUTE_CAP, // per user; minutes_used_today is the same number, kept for older consoles
      minutes_used_today: minutes(calls.filter((c) => isToday(c.created_at))), my_minutes_today: minutes(calls.filter((c) => isToday(c.created_at))) },
    defaults: Object.fromEntries(Object.keys(profile).map((k) => [k, null])), // not used by the console
    choices: { ai_model: [...AI_MODELS.map((x) => x.id), 'custom'], caller_id: ['callenvoy', 'own'], mode: ['handle', 'transfer'], reach: ['app', 'phone', 'app_then_phone'], no_answer: ['ai_handles', 'end_politely'] },
    ranges: RANGES, text_limits: TEXT_LIMITS, vapid_public_key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' });
  if (p === '/api/profile' && m === 'GET') return send(res, 200, profile);
  if (p === '/api/profile' && m === 'PUT') {
    const b = await readBody(req);
    if (b.max_minutes != null && (b.max_minutes < 1 || b.max_minutes > 120)) return send(res, 400, { detail: 'max_minutes must be 1-120.', field: 'max_minutes' });
    if (b.caller_id === 'own' && !verified(u)) return send(res, 400, { detail: 'Verify your callback number before you use it as caller ID.', field: 'caller_id' });
    for (const [k, v] of Object.entries(b)) if (TEXT_LIMITS[k] && typeof v === 'string' && v.length > TEXT_LIMITS[k]) return send(res, 400, { detail: `At most ${TEXT_LIMITS[k]} characters.`, field: k });
    if (/^x+$/i.test(b.vin ?? '')) return send(res, 400, { detail: 'That is not a VIN.', field: 'vin' }); // to see a field error inside a closed group
    // As save_profile: null is skipped, "" clears the field.
    for (const [k, v] of Object.entries(b)) if (v !== null && k in profile) profile[k] = v === '' ? null : v;
    return send(res, 200, profile);
  }
  if (p === '/api/caller-id') return send(res, 200, { number: profile.callback_number || null, verified: verified(u) });
  if (p === '/api/caller-id/verify') {
    if (verified(u)) return send(res, 200, { validation_code: null }); // already verified with Twilio
    u.verifiedAt = Date.now() + 10_000;
    return send(res, 200, { validation_code: '482913' });
  }
  if (p === '/api/push/test') return send(res, 200, { sent: 2 });
  if (p === '/api/push/subscriptions') return send(res, 200, { ok: true });
  if (p === '/api/calls' && m === 'GET') return send(res, 200, calls.map((c) => ({ ...callView(live(c)), transcript: undefined })));
  if (p === '/api/calls' && m === 'POST') {
    const b = await readBody(req);
    if (!profile.name) return send(res, 400, { detail: 'Set your name first (Settings, or callenvoy_save_profile): the AI says who it calls for.' });
    if (!keysReady(u)) { // without own keys: only the demo line, a few times
      const to = String(b.to ?? '').replace(/\D/g, '');
      if (!demoOn || !DEMO.number.endsWith(to.slice(-10)) || to.length < 10) return send(res, 403, { detail: 'Real numbers need your own Twilio and OpenAI keys. Add them in Settings, or call the demo line.', field: 'keys', code: 'keys_needed' });
      if (u.demoCalls >= DEMO_CALLS) return send(res, 429, { detail: 'You have used your free demo calls. Add your own Twilio and OpenAI keys to place more calls.', field: 'keys', code: 'demo_limit' });
      u.demoCalls += 1;
    }
    // Shared service limits: the message says nothing about other users.
    if (/limit/i.test(b.goal ?? '')) return send(res, 429, { error: "The service's daily limit of call minutes is reached. Try again tomorrow.", code: 'daily_limit' });
    if (/busy/i.test(b.goal ?? '')) return send(res, 429, { error: 'The service is busy with other calls. Try again in a few minutes.', code: 'service_busy' });
    if (b.reach === 'phone' && b.mode === 'transfer' && !profile.callback_number) return send(res, 400, { detail: 'Transfer by phone needs a callback number. Add one in Settings, or choose App.', field: 'reach' });
    const id = `c_${crypto.randomBytes(4).toString('hex')}`;
    const allow = Array.isArray(b.allow_secrets) && who === 'owner' ? b.allow_secrets : []; // counts only from the console
    const unknown = allow.find((l) => !u.secrets.some((x) => x.label.toLowerCase() === String(l).toLowerCase()));
    if (unknown) return send(res, 400, { detail: `no protected detail named ${unknown}`, field: 'allow_secrets' });
    calls.unshift(base(id, { ...b, allow_secrets: undefined, secrets_allowed: allow, number: b.to, status: 'queued', phase: null, created_at: iso(0), placedAt: Date.now(), recorded: b.record ?? true,
      calling_number: b.from === 'own' && b.to !== DEMO.number ? profile.callback_number : '+19186021019', /* the demo line answers only the CallEnvoy number */ transcript: [line(0, 0, 'event', `Dialing ${b.to}`)] }));
    return send(res, 200, { id });
  }
  const cm = /^\/api\/calls\/([^/]+)(?:\/([a-z-]+))?$/.exec(p);
  const c = cm && calls.find((x) => x.id === cm[1]);
  if (cm && !c) return send(res, 404, { detail: 'No call with that id.' });
  if (c && !cm[2]) {
    counts[c.id] = (counts[c.id] ?? 0) + 1;
    if (Number(q.get('wait_seconds')) > 0 && !c.finished) await sleep(2000); // a short stand-in for the long-poll
    const since = Number(q.get('since_line') ?? 0);
    live(c);
    return send(res, 200, { ...callView(c), transcript: c.transcript.filter((l) => l.n >= since) });
  }
  const ok = (message) => send(res, 200, { ok: true, message });
  switch (cm?.[2]) {
    case 'hang-up': sockets.get(c.id)?.end('ended'); Object.assign(c, { finished: true, status: 'completed', phase: null, ended_at: iso(0), outcome: { result: 'not_done', summary: 'You hung up the call.', details: {} } }); c.owner.state = 'none'; return ok('Hung up.');
    case 'answer': { const b = await readBody(req); const qn = c.open_questions.find((x) => x.id === b.question_id); if (qn) { c.open_questions = c.open_questions.filter((x) => x !== qn); c.answered_questions.push({ ...qn, answer: b.answer }); c.transcript.push(line(c.transcript.length, 0, 'event', 'owner answered')); } return ok('Sent.'); }
    case 'secret': { // the user's answer about a protected detail (console only)
      const b = await readBody(req); const qn = c.open_questions.find((x) => x.id === b.question_id && x.kind);
      if (c.finished) return send(res, 409, { detail: 'the call has ended' });
      if (!qn) return send(res, 404, { detail: `no such request ${b.question_id} on this call`, field: 'question_id' });
      if (b.allow && qn.kind === 'secret' && !String(b.value ?? '').trim()) return send(res, 400, { detail: 'type the value (1 to 200 characters)', field: 'value' });
      await sleep(500);
      const said = b.allow ? (qn.kind === 'secret' ? 'given for this call (not stored)' : 'allowed') : 'not allowed';
      c.open_questions = c.open_questions.filter((x) => x !== qn); c.answered_questions.push({ ...qn, answer: said });
      if (b.allow && qn.kind === 'permission') c.secrets_allowed = [...(c.secrets_allowed ?? []), qn.label];
      c.transcript.push(line(c.transcript.length, 0, 'event', `${qn.label}: ${said}`));
      if (b.allow) c.transcript.push(line(c.transcript.length, 0, 'event', `gave ${qn.label} by voice`));
      return send(res, 200, { ok: true, question_id: qn.id, answer: said });
    }
    case 'mode': { // a live call's mode and its "alert me" switch
      const b = await readBody(req);
      if (c.finished) return send(res, 409, { detail: 'the call has ended' });
      if (b.mode != null && !['handle', 'transfer'].includes(b.mode)) return send(res, 400, { detail: 'mode must be "handle" or "transfer"', field: 'mode' });
      await sleep(300);
      if (b.mode && b.mode !== c.mode) { c.mode = b.mode; c.transcript.push(line(c.transcript.length, 0, 'event', b.mode === 'transfer' ? 'changed: bring me on when a person answers' : 'changed: the AI handles the call')); }
      if (typeof b.alert_on_human === 'boolean') c.alert_on_human = b.alert_on_human;
      return send(res, 200, { ...callView(live(c)), transcript: undefined });
    }
    case 'connect': c.pending = false; /* an open browser socket stays open */ c.owner = { ...c.owner, state: 'ringing', via: 'phone', alert_until: null }; c.transcript.push(line(c.transcript.length, 0, 'event', 'ringing owner')); return ok('Ringing.');
    case 'hand-back': c.owner = { ...c.owner, state: 'none', via: null }; c.phase = 'talking'; c.transcript.push(line(c.transcript.length, 0, 'event', 'owner handed the call back')); return ok('Handed back.');
    case 'audio-ticket': { const t = crypto.randomBytes(16).toString('hex'); tickets.add(`${c.id}:${t}`); return send(res, 200, { ticket: t, expires_in: 30 }); }
  }
  return send(res, 404, { detail: 'Not found' });
}

// Minimal WebSocket for /audio/<id>: state messages and a 440 Hz tone as call audio.
function audioSocket(req, socket) {
  const id = decodeURIComponent(req.url.split('/').pop());
  const c = callById(id);
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const frame = (op, data) => { const len = data.length; const head = len < 126 ? Buffer.from([0x80 | op, len]) : Buffer.from([0x80 | op, 126, len >> 8, len & 255]); socket.write(Buffer.concat([head, data])); };
  const state = (owner) => { if (c) {
    // Listening during a pending hand-over keeps alert_until: the fallback still fires then.
    c.pending = owner === 'listening' && (c.owner.state === 'alerting' || c.pending);
    c.owner = { ...c.owner, state: owner, via: 'app', alert_until: c.pending ? c.owner.alert_until : null }; c.phase = owner === 'on_call' ? 'owner_on_call' : 'talking'; c.transcript.push(line(c.transcript.length, 0, 'event', owner === 'on_call' ? 'owner took the call' : 'owner is listening')); } frame(1, Buffer.from(JSON.stringify({ type: 'state', owner, phase: c?.phase ?? null }))); };
  let authed = false; let t = 0; let timer; const mic = { n: 0, bytes: 0 };
  const json = (m) => frame(1, Buffer.from(JSON.stringify(m)));
  let gone = false; // closed on purpose (by the client or by us)
  // Server messages: ended / replaced, then close.
  const link = { end: (type) => { gone = true; json({ type }); clearInterval(timer); frame(8, Buffer.alloc(0)); socket.end(); },
    error: (message) => json({ type: 'error', message }), drop: () => socket.destroy() };
  socket.on('data', (buf) => {
    for (let i = 0; i < buf.length;) { // parse client frames (always masked)
      const op = buf[i] & 15; let len = buf[i + 1] & 127; let o = i + 2;
      if (len === 126) { len = buf.readUInt16BE(o); o += 2; } else if (len === 127) { len = Number(buf.readBigUInt64BE(o)); o += 8; }
      const mask = buf.subarray(o, o + 4); const data = Buffer.from(buf.subarray(o + 4, o + 4 + len)).map((b, k) => b ^ mask[k % 4]); i = o + 4 + len;
      if (op === 8) { gone = true; clearInterval(timer); if (c) c.owner = { ...c.owner, state: 'none', via: null }; return socket.end(); }
      if (op === 2) { mic.n++; mic.bytes = len; continue; } // microphone audio: counted, then dropped
      if (op !== 1) continue;
      const msg = JSON.parse(data.toString());
      if (!authed) {
        if (!c || !tickets.delete(`${id}:${msg.ticket}`)) return socket.end();
        authed = true;
        sockets.get(id)?.end('replaced'); // one browser link per call: the older one is told and closed
        sockets.set(id, link);
        // A reconnect within the grace keeps the call; otherwise the owner starts as a listener.
        if (c.owner.state === 'on_call' && c.owner.via === 'app') { clearTimeout(graces.get(id)); json({ type: 'state', owner: 'on_call', phase: c.phase }); }
        else state('listening');
        timer = setInterval(() => { const pcm = Buffer.alloc(640); for (let k = 0; k < 320; k++, t++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * t) / 8000) * 6000 * (0.5 + 0.5 * Math.sin(t / 4000))), k * 2); frame(2, pcm); }, 40);
      } else if (msg.type === 'join') { if (c.owner.state !== 'on_call') state('on_call'); } // join is a no-op when already on the call
      else if (msg.type === 'hand_back') state('listening');
    }
  });
  socket.on('close', () => {
    clearInterval(timer);
    if (sockets.get(id) === link) sockets.delete(id);
    // Dropped while on the call: the server waits 5 s (OWNER_DROP_GRACE_SECONDS), then hands back.
    if (!gone && c?.owner.state === 'on_call' && c.owner.via === 'app') graces.set(id, setTimeout(() => { c.owner = { ...c.owner, state: 'none', via: null }; c.phase = 'talking'; }, 5000));
    else if (!gone && c && sockets.get(id) == null && c.owner.via === 'app') c.owner = { ...c.owner, state: 'none', via: null }; if (mic.n) console.log(`audio ${id}: ${mic.n} mic messages of ${mic.bytes} bytes`); });
  socket.on('error', () => clearInterval(timer));
}

const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.txt': 'text/plain', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204);
  if (url.pathname === '/__mock/socket') {
    const l = sockets.get(url.searchParams.get('id')); const what = url.searchParams.get('send');
    if (!l) return send(res, 404, { detail: 'No open socket.' });
    if (what === 'error') l.error('You do not have the call.'); else if (what === 'drop') l.drop(); else l.end('replaced');
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/__mock/alert') {
    const c = callById(url.searchParams.get('id')); if (!c) return send(res, 404, {});
    const on = url.searchParams.get('state') === 'alerting'; alertStart = Date.now(); alertLen = 1000 * Number(url.searchParams.get('seconds') ?? 20);
    c.owner = { state: on ? 'alerting' : 'none', via: on ? 'app' : null, alert_until: null, unreachable: false };
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/__mock/signin') {
    newSession(res, userByEmail(`${url.searchParams.get('as') ?? 'dana'}@example.com`) ?? users[0]);
    res.writeHead(302, { location: '/' });
    return res.end();
  }
  if (url.pathname === '/__mock/frame') {
    const n = (k, d) => Number(url.searchParams.get(k)) || d, path = url.searchParams.get('path') ?? '/';
    if (!path.startsWith('/') || path.startsWith('//')) return send(res, 400, { detail: 'path must start with one /' }); // this server's pages only
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><body style="margin:0"><iframe src="${path.replace(/[<>"&]/g, '')}" style="border:0;display:block;margin:0 auto;width:${n('w', 390)}px;height:${n('h', 844)}px"></iframe>`);
  }
  if (url.pathname === '/__mock/last-link') return send(res, 200, { url: lastLink });
  if (url.pathname === '/__mock/mail') { mailReady = url.searchParams.get('ready') !== '0'; return send(res, 200, { mail_ready: mailReady }); }
  if (url.pathname === '/__mock/expire') { sessions.clear(); return send(res, 200, { ok: true }); }
  if (url.pathname === '/__mock/recording') {
    const q = url.searchParams;
    if (q.has('fail')) recordingFails = q.get('fail') === '1';
    if (q.has('unknown')) for (const c of users.flatMap((u) => u.calls)) for (const r of c.recordings ?? []) r.duration_seconds = q.get('unknown') === '1' ? 0 : RECORDING_SECONDS;
    return send(res, 200, { fail: recordingFails });
  }
  if (url.pathname === '/__mock/count') return send(res, 200, { count: counts[url.searchParams.get('id')] ?? 0 });
  if (url.pathname === '/__mock/calls') {
    const u = userByEmail(`${url.searchParams.get('as') ?? 'dana'}@example.com`); if (!u) return send(res, 404, {});
    u.calls = url.searchParams.get('set') === 'empty' ? [] : sampleCalls(); return send(res, 200, { calls: u.calls.length });
  }
  if (url.pathname === '/__mock/demo') { demoOn = url.searchParams.get('on') !== '0'; return send(res, 200, { demo: demoOn }); }
  if (url.pathname === '/__mock/anyhost') { anyHost = url.searchParams.get('on') === '1'; return send(res, 200, { any_host: anyHost }); }
  if (url.pathname === '/__mock/keys') { canSave = url.searchParams.get('can_save') !== '0'; return send(res, 200, { can_save: canSave }); }
  if (url.pathname === '/__mock/oauth-done') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<p style="font:16px system-ui;margin:40px">The agent would continue from here (approved=${url.searchParams.get('approved')}). <a href="/agents">Back to the console</a></p>`);
  }
  if (url.pathname === '/__mock/admin') { adminFails = url.searchParams.get('fail') === '1'; return send(res, 200, { fail: adminFails }); }
  const p = url.pathname;
  if (p.startsWith('/api/')) return api(req, res, p, url.searchParams);
  if (p === '/r/demo') return recording(req, res);
  if (p.startsWith('/r/')) return send(res, 404, { detail: 'No such recording.' });
  if (p.startsWith('/static/voices/')) {
    const f = path.join(VOICE_DIR, path.basename(p));
    if (!fs.existsSync(f)) return send(res, 404, { detail: 'No sample.' });
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    return fs.createReadStream(f).pipe(res);
  }
  let f = path.join(DIST, path.normalize(p));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); // single-page app
  if (!fs.existsSync(f)) return send(res, 503, { detail: 'Run `pnpm --dir client exec expo export --platform web` first.' });
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
server.on('upgrade', (req, socket) => (req.url.startsWith('/audio/') ? audioSocket(req, socket) : socket.destroy()));
server.listen(PORT, () => console.log(`mock CallEnvoy on http://localhost:${PORT}/  (sign in: ${OWNER_EMAIL} or sam@example.com, or open /__mock/signin?as=sam; agent key: dev-key)`));
