# Production Runbook

## Pre-deployment checklist

1. Create a Telegram bot through BotFather and obtain its token.
2. Obtain the numeric Telegram ID for at least one trusted owner.
3. Generate a new 32-byte hex encryption key:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Set the required Railway variables:

   ```dotenv
   M_AUTOMATION_BOT_TOKEN=123456:token
   M_AUTOMATION_SUPER_ADMIN_IDS=123456789
   M_AUTOMATION_DATA_KEY=64-character-hex-key
   ```

5. Attach one Railway Volume at `/data`. The bot discovers the mounted path automatically through `RAILWAY_VOLUME_MOUNT_PATH`. Do not set `M_AUTOMATION_DB_PATH` in Railway unless it points inside that volume.
6. Set exactly one running replica. Telegram long polling must not run from multiple replicas with the same bot token.

## Manual payment configuration

Automatic payment providers are disabled by default. For manual top-ups, configure at least one receiver and then enable the feature:

```dotenv
MANUAL_TOPUPS_ENABLED=true
MANUAL_WALLET_RECEIVER=wallet-number-or-id
MANUAL_WALLET_INSTRUCTIONS=Transfer the exact amount, then send the receipt image to this bot.
MANUAL_BINANCE_RECEIVER=binance-pay-id-or-username
MANUAL_BINANCE_INSTRUCTIONS=Transfer the exact amount, then send the receipt image to this bot.
```

Leave a receiver empty to hide that payment option. The bot accepts screenshot images and document receipts only while a receipt is expected.

## Staff administration

Open `⚙️ لوحة الإدارة` as a super admin.

- `إضافة تاجر`: send `telegram_id display name`. A merchant can only manage products and orders belonging to that merchant ID.
- `إضافة أدمن`: send `telegram_id display name`. An admin has all platform permissions.
- `إزالة تاجر`: safely deactivates the merchant, pauses active products, and keeps records.
- `إزالة أدمن`: safely deactivates the admin and their merchant access. The last active admin is protected.
- `إضافة رصيد`: directly credits a user manually.

For a payment receipt, the admin receives an inline `اعتماد وإضافة الرصيد` action. The action is idempotent; if two admins tap it, the wallet is credited once only.

## Backup and recovery

- Use Railway Volume backups before changes that affect data.
- For a manual backup, stop the bot first and copy `store.db`, `store.db-wal`, and `store.db-shm` together from the mounted volume.
- Restore the same encryption key with the database. A database without its original `M_AUTOMATION_DATA_KEY` cannot decrypt stored stock, buyer requirements, or delivery text.

## Release checks

```bash
npm ci
npm run check
npm test
npm audit --omit=dev
```

## Operational troubleshooting

| Symptom | Check |
| --- | --- |
| Bot does not respond | Verify the token, confirm one replica, and inspect Railway logs. |
| Admin panel is missing | Confirm the numeric ID is in the database/initial configuration and the account was not deactivated. |
| Data disappeared after deploy | Attach a `/data` volume and remove any database-path override that writes outside it. |
| Receipt does not reach admins | Confirm at least one active admin has started the bot and that the buyer sent an image or document after selecting a payment method. |
| Encrypted stock cannot be delivered | Restore the original `M_AUTOMATION_DATA_KEY`; never rotate it without a controlled data migration. |
