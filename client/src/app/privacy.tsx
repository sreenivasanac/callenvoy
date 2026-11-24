import { TextPage } from '../components/Public';

/** /privacy (public). Plain words about what the service really stores. Change the date when the text changes. */
export default function PrivacyScreen() {
  return (
    <TextPage
      title="Privacy"
      updated="November 16, 2026"
      intro="CallEnvoy places phone calls for you. This page says what it stores, who else handles your data, and how you delete it. It is written by the person who runs this service."
      sections={[
        [
          'What is stored',
          [
            'Your email address, so you can sign in.',
            'Your calling profile: your name, your callback number, and any details you choose to add, such as an address or an insurance number. The AI shares a detail on a call only when the call needs it.',
            'For each call: the number and business, the goal and details you gave, the transcript, the outcome, and the recording if recording was on.',
            'Your agent keys, as a hash only. Your provider keys (Twilio, OpenAI, Deepgram, Fish Audio), encrypted. They are never shown again after you save them.',
            'The browsers you allowed to get alerts.',
          ],
        ],
        [
          'Who else handles it',
          [
            'Twilio carries the call and keeps the recording. OpenAI runs the AI that talks on the call; it also turns speech into text and makes the voice unless you add other keys. Deepgram hears the call and Fish Audio makes the voice when those are used. An email service sends the sign-in link.',
            'Each of them has its own privacy terms. When you use your own keys, these are your accounts with them. Nothing is sold, and nothing is used for advertising.',
          ],
        ],
        [
          'Who can see it',
          [
            'Your calls, transcripts, recordings, and profile show only in your account.',
            'The person who runs the server has an admin page that lists accounts with usage numbers: email, name, number of calls, minutes. It does not show what was said.',
            'As with any hosted service, the person who runs the server has access to the machine the data is stored on. If that is not acceptable for a call, run your own copy. The code is open.',
            'A recording link works for anyone who has it. Share one only on purpose.',
          ],
        ],
        [
          'Recordings and consent',
          ['Calls are recorded unless you turn recording off, in Settings or for one call. Some US states require everyone on a call to agree to a recording. As the person who places the call, that is your responsibility.'],
        ],
        [
          'Cookies and visit counts',
          [
            'One cookie keeps you signed in. There are no advertising or third-party trackers.',
            'This site counts visits with an analytics tool that runs on the same server (Umami). It sets no cookie and builds no profile of you. It records the page type you opened (for example "a call page", never which call), the site you came from, your country, and your browser and device type. It does not record phone numbers, what was said on a call, or anything from your account.',
          ],
        ],
        [
          'Deleting your data',
          [
            'Settings, Account, Delete account removes your account and everything stored for it on this server: calls, transcripts, cached recordings, profile, keys, provider keys, alert devices.',
            'Recordings that Twilio holds are not deleted from Twilio by this step. Delete them in your own Twilio account. For a demo call, which runs on the service’s account, ask and it will be deleted.',
          ],
        ],
        ['Contact', ['Questions and requests go to the issues page of the project: https://github.com/sreenivasanac/callenvoy/issues']],
      ]}
    />
  );
}
