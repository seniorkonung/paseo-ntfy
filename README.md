# paseo-ntfy

Paseo plugin that sends [ntfy](https://ntfy.sh/) notifications when an opted-in agent
finishes, fails, or requests permission/input.

## Setup

1. Install the plugin into a Paseo 0.10 host:

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

### Claude Code background work

Claude Code ends its turn while background work runs and starts a new turn when that work
reports back. For Claude agents, a completed turn is not announced while work started since
your latest message is still running:

- background Bash commands, including commands moved to the background by their timeout,
  and Monitor watches, until their task notification arrives or the agent stops them;
- background subagents and workflows, until Paseo reports them finished.

When a finished subagent wakes the agent a second time and that turn adds only agent text, it
is not announced again. Your next message resets both checks, so the agent's reply to it is
always announced.

Subagent status is read from the Paseo daemon over a second local session, authenticated with
`$PASEO_HOME/local-credential` like the Paseo CLI (or `PASEO_PASSWORD` when set). If the daemon
cannot be reached, the turn is announced as before.

Agent notifications include an **Open session** ntfy View action targeting
`paseo://h/<server-id>/agent/<agent-id>`. Using the action opens Paseo and clears the
notification, marking it as read. The agent response and tool details are never included.
Delivery uses the globally configured priority, one attempt, and a 10-second timeout.

## Development

```sh
npm test
npm run typecheck
```
