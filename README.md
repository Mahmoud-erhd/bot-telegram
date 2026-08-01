# M-Automation Telegram Store Bot

Clean Telegram store bot for digital stock sales and assisted seller delivery developed by **M-Automation**.

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
M_AUTOMATION_BOT_TOKEN=your-telegram-bot-token
M_AUTOMATION_SUPER_ADMIN_IDS=123456789
M_AUTOMATION_DATA_KEY=64-hex-random-value
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
- Optional Cashup top-up.
- Sample data seeding for first-run testing.

For full deployment instructions, read `DEVELOPER_RUNBOOK.md`.
