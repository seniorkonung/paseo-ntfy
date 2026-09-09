# paseo-ntfy

Paseo plugin that sends [ntfy](https://ntfy.sh/) notifications when an opted-in agent
finishes, fails, or requests permission/input.

## Setup

1. Install the plugin into a Paseo 0.8 host:

   ```sh
   paseo plugin install seniorkonung/paseo-ntfy
   ```

2. Open **Settings → Ntfy notifications** and configure:

   - **Server URL** — ntfy server root, default `https://ntfy.sh`;
   - **Topic** — 1–64 letters, numbers, `_`, or `-`;
   - **Access token** — optional Bearer token;
   - **Priority** — global ntfy priority from Minimal (1) to Maximum (5), default 3.

3. Save, then use **Send test notification**.

The token is stored on the Paseo host in
`$PASEO_HOME/plugin-settings/paseo-ntfy/ntfy.json` (or
`~/.paseo/plugin-settings/paseo-ntfy/ntfy.json`) with file mode `0600`.

## Per-agent opt-in

Every active agent has an **Ntfy** pill above its composer. Click it to toggle the agent's
label between `ntfy=true` and `ntfy=false`. Only the exact value `ntfy=true` enables
notifications; missing labels and all other values are disabled.

The same setting can be managed externally:

```sh
paseo agent update <agent-id> --label ntfy=true
paseo agent update <agent-id> --label ntfy=false
```

Paseo merges the named label, so unrelated labels remain unchanged. Each agent is tracked
independently.

## Notification behavior

- Completed turn: `Agent finished and is waiting for you.`
- Failed turn: `Agent stopped with an error.`
- Permission or question: `Agent is waiting for your input.`
- Canceled turn: no notification.

Agent notifications include an ntfy Click action targeting
`paseo://h/<server-id>/agent/<agent-id>`. The agent response and tool details are never
included. Delivery uses the globally configured priority, one attempt, and a 10-second
timeout.

## Development

```sh
npm test
npm run typecheck
```
