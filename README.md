# M-Automation Store Bot

Production-oriented Telegram store bot for digital products and assisted delivery. It uses SQLite with WAL, encrypted stock and order details, a ledger-based wallet, role-based staff controls, and manual Wallet/Binance top-ups with receipt review.

## What it supports

- Ready-stock products with encrypted instant delivery.
- Assisted products with merchant delivery.
- Merchants can manage only their own products, stock, and pending orders.
- Super admins have platform-wide permissions, including role management and manual wallet credits.
- Manual Wallet/Binance top-ups: the buyer selects a method, enters an amount, sends a receipt, and an admin approves or rejects it from an inline button.
- Role removal is a safe deactivation: products are paused and financial/order history is kept.

## Local setup

```bash
npm ci
copy .env.example .env
npm run check
npm test
npm run start
```

Set at minimum these values in `.env` before running:

```dotenv
M_AUTOMATION_BOT_TOKEN=123456:telegram-bot-token
M_AUTOMATION_SUPER_ADMIN_IDS=123456789
M_AUTOMATION_DATA_KEY=64-character-random-hex-key
```

Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`npm run seed:sample` is optional and only for an empty local test database. It uses the same configured database path and encryption key as the bot.

## Railway deployment

1. Push this repository and create a Railway service from it. Railway detects the root `Dockerfile`.
2. Add a **Volume** to the service with mount path `/data`. This is mandatory: without it the SQLite database is lost on redeploy.
3. Add the variables from `.env.example` manually in Railway. Replace the three required values above. Do **not** add `M_AUTOMATION_DB_PATH`; with a volume attached the app automatically stores the database at `RAILWAY_VOLUME_MOUNT_PATH/store.db`.
4. Set `MANUAL_TOPUPS_ENABLED=true` only after configuring at least one receiver:

```dotenv
MANUAL_WALLET_RECEIVER=wallet-number-or-id
MANUAL_WALLET_INSTRUCTIONS=Transfer the exact amount then send the receipt here.
MANUAL_BINANCE_RECEIVER=binance-pay-id-or-username
MANUAL_BINANCE_INSTRUCTIONS=Transfer the exact amount then send the receipt here.
```

5. Deploy one bot replica only. The bot uses Telegram long polling and a single SQLite file.

Railway volumes persist across service restarts and deployments; Railway also provides `RAILWAY_VOLUME_MOUNT_PATH` to the running service. See the [Railway volume documentation](https://docs.railway.com/volumes).

No public Railway domain is needed because Telegram updates are received through long polling.

## Roles

- **Merchant:** creates and edits only products where they are the owner; can add stock and deliver only their pending orders.
- **Super admin:** all merchant permissions plus user credits, custom prices, reports, merchant management, admin management, and receipt approval.
- Removing a merchant or admin deactivates the role, pauses active products, and preserves all orders, receipts, and ledger records. The final active admin cannot be removed.

## Manual top-up flow

1. Buyer selects `💳 شحن الرصيد` then Wallet or Binance.
2. Buyer enters the requested amount and receives the configured receiver ID/number.
3. Buyer sends a screenshot or document receipt to the bot.
4. Every active admin receives the receipt with `اعتماد وإضافة الرصيد` and `رفض مع سبب` buttons.
5. Approval writes one idempotent ledger entry, so repeated taps cannot credit the wallet twice.

Admins can also use `إضافة رصيد` from the admin panel for a completely manual credit.

## Security and operations

- Keep `.env`, database files, and backups out of Git. Rotate the bot token and encryption key if they were exposed.
- The initial admin is created only from `M_AUTOMATION_SUPER_ADMIN_IDS`; the first Telegram user is never promoted automatically.
- Back up the Railway volume before destructive maintenance. Do not change `M_AUTOMATION_DATA_KEY` after stock or orders have been created, because existing encrypted data would no longer be readable.
- Run `npm test`, `npm run check`, and `npm audit --omit=dev` before each release.
