# Developer Runbook

This guide explains how to install, configure, run, and maintain the AI Studio Store Bot.

## 1. Requirements

- Linux server or local Linux machine.
- Node.js 20 or newer.
- npm.
- A Telegram bot token from BotFather.
- The Telegram numeric ID of the owner.

## 2. Install

Upload and extract the package:

```bash
unzip minof-ai-studio-store-clean.zip
cd minof-ai-studio-store-clean
npm ci
```

Create the environment file:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
MINOF_AI_STUDIO_BOT_TOKEN=put-the-new-owner-telegram-bot-token-here
MINOF_AI_STUDIO_SUPER_ADMIN_IDS=put-owner-telegram-id-here
MINOF_AI_STUDIO_DB_PATH=runtime/store.db
MINOF_AI_STUDIO_DATA_KEY=put-random-64-hex-value-here
STORE_BRAND_NAME=AI Studio bot
STORE_CURRENCY_CODE=EGP
STORE_CURRENCY_NAME=Egyptian pound
TOPUPS_ENABLED=0
```

Generate a safe data key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. First Run

Check the source:

```bash
npm run check
```

Create sample products and sample stock:

```bash
npm run seed:sample
```

Start the bot:

```bash
npm run start
```

Open Telegram, start the bot, then use the Admin panel.

## 4. Environment Variables

`MINOF_AI_STUDIO_BOT_TOKEN`

Telegram bot token for this copy only.

`MINOF_AI_STUDIO_SUPER_ADMIN_IDS`

Comma-separated Telegram owner IDs. Example: `123456789,987654321`.

`MINOF_AI_STUDIO_DB_PATH`

SQLite database path. Default: `runtime/store.db`.

`MINOF_AI_STUDIO_DATA_KEY`

Encryption key for delivered stock and assisted order notes. Use a 64-character hex value.

`STORE_BRAND_NAME`

Displayed store name.

`STORE_CURRENCY_CODE`

Currency code displayed inside the bot.

`TOPUPS_ENABLED`

Set to `1` only after Cashup is configured. Keep `0` for manual admin balance.

`CASHUP_BASE_URL`, `CASHUP_API_KEY`, `CASHUP_APP_ID`

Optional Cashup settings. Leave placeholders until the new owner provides their own values.

## 5. Working With Products

From Telegram:

1. Press `Admin`.
2. Press `New Product`.
3. Send title, category, description, and price.
4. Choose product type:
   - `Ready Stock`: buyer receives one stock line immediately.
   - `Assisted Delivery`: buyer sends requirements and seller delivers later.
5. For ready stock, send one item per line.

To add more stock later:

1. `Admin`.
2. `My Products`.
3. Open a ready-stock product.
4. Press `Add Stock`.
5. Send one item per line.

## 6. Balance Management

If top-up is disabled, the owner adds balance manually:

1. `Admin`.
2. `Add Balance`.
3. Send:

```text
user_id amount note
```

Example:

```text
123456789 100 Manual credit
```

To clear a balance:

1. `Admin`.
2. `Zero Balance`.
3. Send the user ID.

## 7. Enable Cashup Later

In `.env`:

```bash
TOPUPS_ENABLED=1
CASHUP_ENABLED=true
CASHUP_BASE_URL=https://cashup.cash/base
CASHUP_API_KEY=
CASHUP_APP_ID=
```

Restart the bot after editing `.env`.

## 8. systemd Service

Example path:

```text
/opt/ai-studio-store
```

Copy the example service:

```bash
sudo cp deploy/systemd/minof-ai-studio-store-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now minof-ai-studio-store-bot
```

View status:

```bash
systemctl status minof-ai-studio-store-bot --no-pager
```

View logs:

```bash
journalctl -u minof-ai-studio-store-bot -f
```

Restart:

```bash
sudo systemctl restart minof-ai-studio-store-bot
```

## 9. Backup

Stop the bot first:

```bash
sudo systemctl stop minof-ai-studio-store-bot
```

Copy database files:

```bash
mkdir -p backups
cp runtime/store.db backups/store-$(date +%Y%m%d-%H%M%S).db
```

Start again:

```bash
sudo systemctl start minof-ai-studio-store-bot
```

## 10. Troubleshooting

Bot does not answer:

- Check `MINOF_AI_STUDIO_BOT_TOKEN`.
- Run `journalctl -u minof-ai-studio-store-bot -n 100 --no-pager`.
- Make sure only one copy of the same Telegram bot is running.

Admin panel does not appear:

- Check `MINOF_AI_STUDIO_SUPER_ADMIN_IDS`.
- The value must be numeric Telegram IDs, not usernames.
- Restart the bot after changing `.env`.

Database does not appear:

- Check write permissions in the project directory.
- Check `MINOF_AI_STUDIO_DB_PATH`.
- Run `npm run seed:sample` once for test data.

Cashup top-up fails:

- Keep `TOPUPS_ENABLED=0` until the owner adds real Cashup values.
- Check `CASHUP_ENABLED=true`.
- Check `CASHUP_BASE_URL`, `CASHUP_API_KEY`, and `CASHUP_APP_ID`.

Stock delivery fails:

- Confirm `MINOF_AI_STUDIO_DATA_KEY` did not change after stock was added.
- If the key changed, old encrypted stock cannot be read.
