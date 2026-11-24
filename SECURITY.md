# Security

CallEnvoy places phone calls and stores provider keys, call transcripts and, if a user saves them, protected
details such as an SSN. Please report a weakness privately.

## Reporting

Use GitHub's private report: on the repository page open **Security**, then **Report a vulnerability**.
Please do not open a public issue for a weakness. Say what you found, how to reproduce it, and what it lets
someone do. You get an answer within a few days.

## What matters most

- Reading or using another user's calls, recordings, keys or protected details.
- Getting a provider key or a protected detail out of the server in any form (API result, log, transcript,
  the AI model's context, an agent tool).
- Placing calls on someone else's account, or on the server's keys beyond the demo line.
- Getting past the checks on Twilio webhooks, sign-in links, agent keys or the agent sign-in.

## How secrets are kept

- Provider keys and protected details are encrypted at rest with `CALLENVOY_SECRET_KEY` (Fernet). Agent keys
  and session tokens are stored as SHA-256 hashes.
- A protected detail is never given to the AI model. The server says it (a direct text-to-speech request) or
  keys it in. A read-back is masked before the model or the transcript gets it.
- The person who runs a server has access to its machine, and so to the database and the secret key. If that
  is not acceptable for your calls, run your own copy.
