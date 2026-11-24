import { TextPage } from '../components/Public';

/** /terms (public). Change the date when the text changes. */
export default function TermsScreen() {
  return (
    <TextPage
      title="Terms"
      updated="November 16, 2026"
      intro="CallEnvoy is open-source software, run here by one person. By using it you agree to the rules on this page."
      sections={[
        [
          'What you get',
          [
            'A service that places phone calls for you with an AI, and lets you listen in and take over. It is provided as it is, with no warranty. It can change, have limits, or stop.',
            'A new account can call the demo line a few times for free. Calls to real numbers run on your own Twilio and OpenAI keys.',
          ],
        ],
        [
          'Your account and your keys',
          ['You are responsible for the calls placed with your account, by you or by an AI agent you connected, and for the charges at your providers. Keep your agent keys private, and remove a key you no longer use.'],
        ],
        [
          'What you may not do',
          [
            'No spam, robocalls, or sales calls to people who did not ask for them. No harassment, threats, or fraud. No pretending to be another person: the AI calls on your behalf and says so.',
            'Only numbers in the US and Canada can be called. It cannot call emergency services. Do not rely on it in an emergency.',
            'Follow the law where you and the other side are, including the rules on recording calls and on automated calls.',
          ],
        ],
        [
          'The AI makes mistakes',
          ['It can mishear, misunderstand, or agree to something you did not want. Read the outcome and the transcript, and listen in on calls that matter. Do not give it details you would not say to a support agent.'],
        ],
        ['Recordings', ['Calls are recorded unless you turn that off. Where the law requires everyone on a call to agree to a recording, getting that agreement is your responsibility.']],
        ['If the rules are broken', ['An account that breaks these rules can be disabled or removed.']],
        ['Liability', ['To the extent the law allows, the person who runs this service is not liable for damages that come from using it, including charges at your providers and the results of calls.']],
        ['Contact', ['The issues page of the project: https://github.com/sreenivasanac/callenvoy/issues']],
      ]}
    />
  );
}
