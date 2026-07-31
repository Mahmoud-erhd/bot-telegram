# AI Studio Store Bot

Clean Telegram store bot for digital stock sales and assisted seller delivery.

This package is intentionally clean. It does not include production data, private environment files, old runtime files, server credentials, or payment provider credentials.

## Quick Start

```bash
npm ci
cp .env.example .env
npm run check
npm run seed:sample
npm run start
```

Required values in `.env`:

```bash
MINOF_AI_STUDIO_BOT_TOKEN=your-telegram-bot-token
MINOF_AI_STUDIO_SUPER_ADMIN_IDS=123456789
MINOF_AI_STUDIO_DATA_KEY=64-hex-random-value
```

Generate the data key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Features

- Ready-stock products with instant encrypted delivery.
- Assisted products where a seller manually delivers after reviewing buyer notes.
- Admin and merchant panels.
- Wallet balance and purchase ledger.
- Optional Cashup top-up, disabled by default.
- Sample data seeding for first-run testing.

For full deployment instructions, read `DEVELOPER_RUNBOOK.md`.
