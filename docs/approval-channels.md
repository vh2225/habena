# Approval channels: phone-tap Allow/Deny (Telegram)

## What it is

When an agent's tool call hits a `require_approval` rule, Habena holds the call
and asks a human before it goes through. The **Telegram channel** delivers that
prompt straight to your phone: you get a message with **✅ Allow once** and
**⛔ Deny** buttons, and tapping one resolves the call. No extra process to run,
no inbox to babysit — just a few lines of config.

This is the same approval that `habena watch` (CLI) and `habena approvals
forward` (webhook) handle; Telegram is one more way to answer, and it works
alongside the others (see [Coexistence](#coexistence)).

## 60-second setup

1. **Create a bot.** In Telegram, DM [@BotFather](https://t.me/BotFather), send
   `/newbot`, follow the prompts, and copy the **bot token** it gives you
   (looks like `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`).

2. **Find your numeric chat id.** This is *your* user id, not the bot's. Either:
   - DM [@userinfobot](https://t.me/userinfobot) (or @RawDataBot) — it replies
     with your numeric id; or
   - message your new bot once, then open
     `https://api.telegram.org/bot<token>/getUpdates` in a browser and read
     `message.from.id` from the JSON.

3. **Export the token** so it stays out of your YAML:

   ```bash
   export HABENA_TELEGRAM_TOKEN=123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

4. **Enable the channel** in `~/.habena/config.yaml`:

   ```yaml
   approval:
     timeout: 5m
     timeout_action: deny
     channels:
       telegram:
         token_env: HABENA_TELEGRAM_TOKEN   # reads the token from the env var
         owner_id: 123456789                # your numeric chat id from step 2
   ```

   Use `token_env` rather than an inline `token:` so the secret never lands in
   the config file. (An inline `token:` is supported but not recommended.)

5. **Start and test.** Run `habena start`. **Send your bot any message once** so
   Telegram lets it DM you back, then trigger an approval (have your agent hit a
   `require_approval` rule, e.g. a write under `~/workspace` with the `cautious`
   preset). Your phone buzzes; tap **⛔ Deny** and the call is blocked and
   audited.

## Security model

- **Only `owner_id` can approve.** Every inbound tap is checked against
  `owner_id` *before* anything else; a tap from any other Telegram user is
  rejected ("Not authorized") and can never reach a decision.
- **Allow-once / Deny only.** The only choices offered over chat are
  `allow_once` and `deny`. You cannot grant a standing session allowance from
  Telegram — that stays a deliberate, local action.
- **Each prompt is one-shot.** A prompt's button maps to a single, unguessable
  token that is consumed the instant the call is resolved (your tap, resolved
  elsewhere, or timeout). A second tap on the same prompt is a harmless no-op;
  no approval can be resolved twice.
- **Args are truncated.** Tool arguments shown in the prompt are truncated, so a
  large or sensitive payload isn't dumped into your chat history.
- **The bot token is never logged.** It is treated as a secret and kept out of
  logs and error output.
- **Long-polling, no inbound port.** The channel uses Telegram long-polling, so
  you need **no public URL and no open inbound port** — it works behind NAT,
  including on a Mac mini at home.

## Coexistence

The Telegram channel runs *alongside* the other approval paths — the CLI
`habena watch` and the webhook forwarder `habena approvals forward` keep
working. A held call is offered on every active channel at once; **whichever
responds first wins**, and the others simply show that it was resolved
elsewhere. If the approval times out before anyone responds, Habena applies
`approval.timeout_action` (default `deny`).

## Troubleshooting

- **"The bot can't DM me / nothing arrives."** Telegram bots cannot start a
  conversation — you must **message the bot first**. Send it any message once,
  then trigger an approval again.
- **`! telegram approval channel configured but no token/owner_id; skipping`**
  (yellow warning on `habena start`). The `telegram` block is present but the
  token didn't resolve (env var unset/empty) or `owner_id` is missing/blank.
  Re-export `HABENA_TELEGRAM_TOKEN` in the same shell that runs `habena start`,
  and confirm `owner_id` is set to your numeric id.
- **Wrong `owner_id`.** If your taps are rejected as "Not authorized", the
  `owner_id` in config doesn't match your real Telegram user id — re-check it
  via step 2.
