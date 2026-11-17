// Recorded example calls (public/examples): real calls to CallEnvoy's demo line, shown on the product page and on /examples.
// To add one: put <slug>.mp3 and <slug>.json (a SampleCall) into public/examples and add an entry to index.json.
import type { Call, Line } from './api';

export type SampleCall = {
  business: string;
  goal: string;
  duration_seconds: number;
  outcome: NonNullable<Call['outcome']>;
  lines: { n: number; who: Line['who']; text: string; at: number | null }[];
};

/** The sample as a finished call, so the call screen's transcript and outcome parts show it as they show any call.
 *  Times count from 0 (the start of the recording). */
export function sampleToCall(s: SampleCall): Call {
  const at = (sec: number) => new Date(sec * 1000).toISOString();
  return {
    id: 'sample',
    direction: 'outbound',
    calling_number: null,
    leave_voicemail: false,
    status: 'completed',
    phase: null,
    finished: true,
    business: s.business,
    number: '',
    goal: s.goal,
    mode: 'handle',
    connect_when: null,
    reach: 'app',
    listen_in: false,
    alert_on_human: true,
    recorded: true,
    human_at: null,
    owner: { state: 'none', via: null, alert_until: null, unreachable: false },
    open_questions: [],
    answered_questions: [],
    outcome: s.outcome,
    talk_seconds: s.duration_seconds,
    owner_seconds: null,
    error: null,
    created_at: at(0),
    ended_at: at(s.duration_seconds),
    transcript: s.lines.map((l) => ({ ...l, t: at(l.at ?? 0) })),
  };
}

/** One entry of public/examples/index.json. `audio` and `transcript` are file names in that folder. */
export type Example = {
  slug: string;
  title: string;
  asked: string; // what the user told their agent
  business: string;
  goal: string;
  duration_seconds: number;
  audio: string;
  transcript: string;
  outcome: string;
};

/** Where a recorded call is on the call line (format.STEPS) at `time` seconds into the recording:
 *  0 dialing, 1 in the menu (the other side speaks), 2 on hold, 3 talking to a person, 5 ended. */
export function sampleStep(lines: SampleCall['lines'], time: number, duration: number): number {
  const at = (l: SampleCall['lines'][number] | undefined) => l?.at ?? Infinity;
  if (duration > 0 && time >= duration - 0.5) return 5;
  const firstAi = lines.findIndex((l) => l.who === 'ai');
  // The person: the line of the other side that the AI first answers.
  const person = firstAi > 0 ? lines.slice(0, firstAi).reverse().find((l) => l.who === 'them') : undefined;
  if (time >= at(person)) return 3;
  if (time >= at(lines.find((l) => l.who === 'event' && /hold/i.test(l.text)))) return 2;
  if (time >= at(lines.find((l) => l.who === 'them'))) return 1;
  return 0;
}
