# Run your own CallEnvoy

This guide takes a new server to a working CallEnvoy with HTTPS. Plan for about 30 minutes.

## What you need

| | Needed | Notes |
|---|---|---|
| A Linux server with a public IP | yes | 2 vCPUs and 4 GB RAM run about four calls at once. Ports 80 and 443 open. |
| A host name that points at it | yes | For example `calls.example.com` (an A record). Twilio needs a public https address for its webhooks. |
| Docker with Compose | yes | `docker compose version` must work. |
| A Twilio account with one phone number | yes | A trial account plays a trial message and calls only numbers you verified. |
| An OpenAI API key | yes | The AI that talks. It also hears and speaks unless you add the two below. |
| A Deepgram key, a Fish Audio key | optional | Hearing, and ten more voices (three Indian English). |
| A mail account for sign-in links (SMTP) | optional | Without it you print sign-in links on the server (step 5). |

The server's keys serve the admin (you). Other people who sign up on your server bring their own Twilio and
OpenAI keys, unless you keep sign-ups closed.

## 1. Get the code and write `.env`

```bash
git clone https://github.com/sreenivasanac/callenvoy.git
cd callenvoy
cp .env.example .env
chmod 600 .env
```

Fill in `.env`:

- `DOMAIN`: your host name, without `https://`.
- `OWNER_EMAIL`: your email address. Whoever signs in with it is the admin.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (the number in `+1...` form), `OPENAI_API_KEY`.
- `CALLENVOY_SECRET_KEY`: make one with the command below and paste the whole line. It encrypts the provider
  keys and protected details that users save. Keep a copy somewhere safe: without the same value those can
  never be read again.

  ```bash
  echo "CALLENVOY_SECRET_KEY=$(openssl rand -base64 32 | tr '+/' '-_')"
  ```

- `SIGNUPS_OPEN=0` if only you should be able to sign in. You can open sign-ups later on the People page.
- Optional: `DEEPGRAM_API_KEY`, `FISH_API_KEY`, the `SMTP_*` lines and `MAIL_FROM`, the `VAPID_*` lines for web
  push (step 6), and the `LLM_*` lines for another AI service.

## 2. Start it

```bash
docker compose up -d --build
docker compose logs -f callenvoy     # wait for "Application startup complete", then Ctrl+C
curl https://$DOMAIN/healthz          # {"ok":true}
```

The first start builds the image (a few minutes) and gets the certificate. If the service refuses to start,
the log names the missing setting.

## 3. Point Twilio at it

In the Twilio console open **Phone Numbers > Manage > Active numbers**, pick your number, and under
**Voice Configuration** set "A call comes in" to **Webhook**, `https://<your host>/twilio/inbound`, **HTTP POST**.
A business that calls back is then forwarded to your callback number (Settings > Profile in the console).

Calls that CallEnvoy places need no set-up in Twilio: it gives Twilio the addresses with each call.

## 4. Optional: a demo line

The demo line is a practice number: a phone menu, a short hold, then an AI "billing agent". New users can call
it for free on the server's keys. To have one, buy a second number in the same Twilio account, set its voice
webhook to `https://<your host>/api/demo-line` (HTTP POST), put it into `.env` as `DEMO_LINE_NUMBER=+1...`, and
run `docker compose up -d`. Without it there is no demo step, and every call needs keys.

## 5. Sign in

With mail set up: open `https://<your host>`, enter `OWNER_EMAIL`, and use the link from the mail.

Without mail, print a link on the server:

```bash
docker compose exec callenvoy uv run --frozen --no-dev python -m callenvoy.signin
```

Then follow the welcome steps: your name, how calls are handled, a first call. Connect an agent on the
**Agents** page.

## 6. Optional: web push

Alerts while the console is closed need a key pair:

```bash
docker compose exec callenvoy uv run --frozen --no-dev python -m callenvoy.push --make-keys
```

Paste the three `VAPID_*` lines into `.env`, set `VAPID_SUBJECT` to `mailto:` plus your address, and run
`docker compose up -d`.

## Keeping it running

- **Update:** `git pull && docker compose up -d --build`. The database is migrated at start (new columns and
  tables only). Calls that are running end when the service restarts, so update while none is live.
- **Back up:** the folder `data/` (the database and cached recordings) and your `.env` (above all
  `CALLENVOY_SECRET_KEY`). A simple way: `sqlite3 data/callenvoy.db ".backup backup.db"` on a schedule.
- **Logs:** `docker compose logs --since 1h callenvoy`. The log holds no call text and no keys. Set
  `PIPECAT_LOG_LEVEL=DEBUG` only while debugging: it then holds what is said on calls.
- **One process:** live call state is in memory, so run one instance, not several behind a balancer.

## Settings worth knowing

| Setting | What it does |
|---|---|
| `SIGNUPS_OPEN=0` | New addresses cannot make an account until the admin opens sign-ups. |
| `DEMO_LINE_NUMBER` | The practice line (step 4). Empty: none. |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Another OpenAI-compatible AI service for the admin's calls, for example a local model. Pick "custom" as the AI model in Settings. |
| `LLM_ANY_HOST=1` | Lets users of your server save any address for their own AI service. Off, only well-known services are allowed, because the server sends each call's text to that address. |
| Limits, voices, prices | Constants in `callenvoy/config.py`: calls at one time, minutes a day, the demo allowance, the model list, the list prices behind the cost estimate. |

## Without Docker

The same service runs under systemd behind nginx: see `deploy/callenvoy.service`, `deploy/nginx.conf` and
`deploy/deploy.sh` (it builds the console on your machine and ships it), and set `PUBLIC_BASE_URL` in `.env`
instead of `DOMAIN`. You need `uv` on the server, and Node 22.13+ with `pnpm` where the console is built.

## What your server sends where

- **Twilio:** the call audio, the numbers, recordings (when recording is on), and digits that are keyed in.
- **OpenAI:** the words of the call as text, and the audio when OpenAI hears or speaks.
- **Deepgram, Fish Audio:** the other side's audio (Deepgram) and the AI's words (Fish), when those keys are set.
- **Another AI service:** the words of the call, when one is chosen as the AI model.
- **Nothing else.** There is no telemetry. The public site at callenvoy.pragnyalabs.com counts page visits with
  a self-hosted tool; your copy does not, because that is tied to its host name.

## If something does not work

| What you see | Likely cause |
|---|---|
| The call rings, then drops when answered | Twilio cannot reach `https://<your host>/twilio/...`: check DNS, the certificate, and that port 443 is open. |
| "could not dial" | The Twilio number, SID or token is wrong, or a trial account is calling a number that is not verified. |
| The service does not start | `docker compose logs callenvoy` names the missing setting. |
| No sign-in mail | Check the `SMTP_*` lines; meanwhile print a link (step 5). |
| The AI never presses a key or talks | The AI model cannot use tools. Use one of the listed models, or test your own on the demo line. |
