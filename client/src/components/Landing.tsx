// Product page for signed-out visitors: what CallEnvoy does, a real example call as proof, who pays for calls,
// and the email sign-in.
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { track } from '../platform/analytics';
import { scrollToId } from '../platform/scroll';
import { border, color, countdownHeight, font, gateWidth, heroColumns, lineHeight, radius, readWidth, space, useWide } from '../theme';
import { ExampleCard, useExamples } from './Examples';
import { Loading } from './Loading';
import { PublicPage, REPO_URL } from './Public';
import { SignInForm } from './SignIn';
import { Button, Card, Pill, Stack, StepNumber, T, TextLink, text } from './ui';

const ID = { sample: 'example-call', start: 'get-started', email: 'signin-email' };

const STEPS = [
  ['Say who to call and what to get done', 'A phone number, the business, and the goal in a sentence or two. Add details it may share, like an account number.'],
  ['It gets through the menu and the hold', 'It presses the menu keys and waits on hold, for as long as it takes. You do something else.'],
  ['It talks to the person, or brings you in', 'It handles the call and reports back: a short outcome, the transcript, and the recording. Or it alerts you when a person answers, and you take the call.'],
];
const KEYS = [
  ['The first call is free', 'Call our demo line: a test phone line with a menu, a hold, and a billing agent. It shows the whole thing in about two minutes.'],
  ['Real calls run on your accounts', 'You add your own Twilio key (the phone line) and OpenAI key (the AI). CallEnvoy places your calls with them and with nothing else.'],
  ['About 3 to 7 cents a minute, paid to them', 'Twilio and OpenAI bill you directly. CallEnvoy charges nothing and adds nothing on top.'],
];
const FAQ: [string, string][] = [
  ['Will they know it is an AI?', 'It says it is calling on your behalf. It does not announce that it is an AI. If someone sincerely asks, it says it is an AI assistant. It never claims to be you.'],
  ['Are calls recorded?', 'Yes at first, so you can hear what was said. You can turn recording off in Settings, or for one call. Some US states require everyone on a call to agree to a recording. That is your responsibility as the caller.'],
  ['Which numbers can it call?', 'Numbers in the US and Canada. Premium-rate numbers are blocked, and it cannot call emergency services.'],
  ['What does it cost?', 'CallEnvoy is free. The demo line call costs you nothing. Real calls cost about 3 to 7 cents a minute, which you pay to your own Twilio and OpenAI accounts.'],
  ['Is my data private?', 'Your calls, transcripts, recordings, and details are visible only to your account. The person who runs this server sees usage numbers, not what was said. Your provider keys are stored encrypted. You can delete your account and everything in it from Settings.'],
];

export function Landing() {
  const wide = useWide();
  const { signin } = useLocalSearchParams<{ signin?: string }>();
  const { data: examples, error, retry } = useExamples();
  const start = () => scrollToId(ID.start, ID.email);
  useEffect(() => {
    if (signin) start(); // "Sign in" on another public page
  }, [signin]);
  const example = examples?.[0];
  return (
    <PublicPage title="CallEnvoy: an AI that makes your phone calls" onSignIn={start}>
      <View style={[s.hero, wide && s.heroWide]}>
        <View style={[s.pitch, wide && { flex: heroColumns[0] }, wide && s.pitchWide]}>
          <T v="hero" style={!wide && s.heroNarrow}>
            An AI that makes your phone calls
          </T>
          <Text style={s.lead}>It gets through the phone menu, waits on hold, and talks to the person. You can listen in and take over at any time.</Text>
          <View style={s.actions}>
            <Button
              label="Get started"
              onPress={() => {
                track('get-started');
                start();
              }}
            />
            <Button
              label="Hear a real call"
              kind="secondary"
              onPress={() => {
                track('hear-sample');
                scrollToId(ID.sample);
              }}
            />
          </View>
          <T v="fine">Sign in with an email link. Your first call, to our demo line, is free.</T>
        </View>
        <View style={wide && { flex: heroColumns[1] }}>
          {example ? <ExampleCard example={example} id={ID.sample} /> : <Loading error={error} retry={retry} label="Loading the example call" />}
          <View style={s.more}>
            <TextLink label="More example calls" onPress={() => router.push('/examples')} />
          </View>
        </View>
      </View>

      <Section title="How it works">
        <View style={[s.steps, wide && s.row]}>
          {STEPS.map(([title, body], i) => (
            <View key={title} style={[s.step, wide && s.fill]}>
              <StepNumber n={i + 1} />
              <T v="h3">{title}</T>
              <T v="soft">{body}</T>
            </View>
          ))}
        </View>
      </Section>

      <Section title="It is your call. Step in when you want." intro="Most phone agents work alone. This one lets you listen and take the call, from the browser or your phone.">
        <View style={[s.split, wide && s.row]}>
          <View style={[s.points, wide && s.fill]}>
            <Point title="Listen in">Hear both sides live while the AI works. Nobody on the call hears you.</Point>
            <Point title="Take over">One button, and you are talking. The AI goes silent and keeps following.</Point>
            <Point title="Hand back">Give the call back when your part is done. The AI carries on from what was said.</Point>
            <Point title="Hold for me">Or let it only do the waiting. It alerts you when a person answers, then rings your phone.</Point>
          </View>
          <View style={wide && s.fill}>
            <AlertPicture />
          </View>
        </View>
      </Section>

      <Section title="Your keys, your bill" intro="CallEnvoy is not a paid service. It is the software. The calls run on accounts you own.">
        <View style={[s.steps, wide && s.row]}>
          {KEYS.map(([title, body]) => (
            <View key={title} style={[s.fact, wide && s.fill]}>
              <T v="h3">{title}</T>
              <T v="soft">{body}</T>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Two ways to start a call">
        <View style={[s.steps, wide && s.row]}>
          <Card style={[s.way, wide && s.fill]}>
            <T v="h3">From your AI agent</T>
            <T v="soft">Add CallEnvoy to Claude, ChatGPT, Codex, or Cursor through MCP. Then ask in your own words:</T>
            <View style={s.quote}>
              <Text style={text.base}>“Call my internet provider and get the wrong $30 charge taken off my October bill. Ask for a reference number.”</Text>
            </View>
          </Card>
          <Card style={[s.way, wide && s.fill]}>
            <T v="h3">From this website</T>
            <T v="soft">Fill in the number, the business, and the goal. Follow the call live with its transcript, and join it from your browser or your phone.</T>
          </Card>
        </View>
      </Section>

      <Section title="Open source">
        <View style={s.readable}>
          <T v="soft">Read how it works, report a problem, or run your own copy on your own server. The code is on GitHub.</T>
          <Button
            label="See the code on GitHub"
            kind="secondary"
            onPress={() => {
              track('github');
              void Linking.openURL(REPO_URL);
            }}
          />
        </View>
      </Section>

      <Section title="Questions">
        <View style={s.readable}>
          {FAQ.map(([q, a]) => (
            <Faq key={q} q={q} a={a} />
          ))}
          <TextLink label="Read the privacy page" onPress={() => router.push('/privacy')} />
        </View>
      </Section>

      <View nativeID={ID.start} role="region" aria-labelledby="get-started-title" style={s.start}>
        <Card>
          <Stack>
            <View>
              <T v="h1" level={2} id="get-started-title">
                Get started
              </T>
              <T v="muted">Enter your email. We send a one-time link. No password, no card.</T>
            </View>
            <SignInForm fieldId={ID.email} />
          </Stack>
        </Card>
      </View>
    </PublicPage>
  );
}

/** A titled part of the page (h2), a landmark region named by its title. */
function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const titleId = `${title.toLowerCase().replace(/\W+/g, '-')}-title`;
  return (
    <View role="region" aria-labelledby={titleId} style={s.section}>
      <View style={s.readable}>
        <T v="h1" level={2} id={titleId} style={s.sectionTitle}>
          {title}
        </T>
        {intro ? <T v="muted">{intro}</T> : null}
      </View>
      {children}
    </View>
  );
}

/** One question: the whole row opens and closes the answer. */
function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.faq}>
      <Pressable role="button" aria-expanded={open} onPress={() => setOpen(!open)} style={s.question}>
        <Text style={[text.body, s.questionText]}>{q}</Text>
        <Text style={s.sign} aria-hidden>
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? (
        <T v="soft" style={s.answer}>
          {a}
        </T>
      ) : null}
    </View>
  );
}

function Point({ title, children }: { title: string; children: string }) {
  return (
    <View style={s.point}>
      <T v="h3">{title}</T>
      <T v="soft">{children}</T>
    </View>
  );
}

/** A picture of the alert, built from the console's own parts. Not a control: hidden from assistive tech. */
function AlertPicture() {
  return (
    <View style={s.picture} aria-hidden pointerEvents="none">
      <View style={s.pictureHead}>
        <View style={s.fill}>
          <Text style={s.pictureTitle}>A person is on the line</Text>
          <Text style={text.fine}>Northstar Internet, billing</Text>
        </View>
        <Pill label="Waiting for you" tone="alert" live />
      </View>
      <View style={s.countdown}>
        <View style={s.countdownFill} />
      </View>
      <Text style={text.fine}>Your phone rings in 12 s</Text>
      <View style={s.pictureButtons}>
        <Button label="Join now" kind="go" />
        <Button label="Listen first" kind="secondary" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  hero: { gap: space.x4, paddingTop: space.x4 },
  heroWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space.x5, paddingTop: space.x5 + space.xl },
  pitch: { gap: space.xxl },
  pitchWide: { paddingTop: space.x3 },
  heroNarrow: { fontSize: font.size.heroNarrow, lineHeight: font.size.heroNarrow * font.heroLineHeight, letterSpacing: font.tracking.head },
  lead: { color: color.soft, fontSize: font.size.big, lineHeight: font.size.big * lineHeight },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.ml },
  more: { marginTop: space.ml, alignItems: 'flex-end' },
  section: { gap: space.x3, marginTop: space.x5 + space.x4 },
  sectionTitle: { marginBottom: space.xs },
  readable: { maxWidth: readWidth, gap: space.ml, alignItems: 'flex-start' },
  steps: { gap: space.x3 },
  step: { gap: space.ml, borderTopWidth: border.outline, borderTopColor: color.fg, paddingTop: space.xl },
  fact: { gap: space.sm, borderTopWidth: border.thin, borderTopColor: color.edge, paddingTop: space.xl },
  split: { gap: space.x4 },
  points: { gap: space.xxl },
  point: { gap: space.xs },
  way: { gap: space.ml },
  quote: { backgroundColor: color.card2, borderRadius: radius.m, paddingVertical: space.ml, paddingHorizontal: space.l },
  faq: { alignSelf: 'stretch', borderTopWidth: border.thin, borderTopColor: color.line },
  question: { flexDirection: 'row', alignItems: 'center', gap: space.ml, paddingVertical: space.l },
  questionText: { flex: 1, fontWeight: font.weight.semi },
  sign: { color: color.muted, fontSize: font.size.big, width: space.xxl, textAlign: 'center' },
  answer: { paddingBottom: space.xl },
  start: { alignSelf: 'center', width: '100%', maxWidth: gateWidth + space.x5 * 2, marginTop: space.x5 + space.x4 },
  picture: { backgroundColor: color.card, borderWidth: border.outline, borderColor: color.brand, borderRadius: radius.xl, padding: space.xxl, gap: space.ml },
  pictureHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.ml },
  pictureTitle: { fontFamily: font.display, color: color.fg, fontSize: font.size.h2, fontWeight: font.weight.bold },
  pictureButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  countdown: { height: countdownHeight, backgroundColor: color.line, borderRadius: radius.pill, overflow: 'hidden' },
  countdownFill: { height: '100%', width: '60%', backgroundColor: color.brand },
});
