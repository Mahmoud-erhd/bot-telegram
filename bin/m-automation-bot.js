#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

const { TelegramApi } = require("../src/TelegramApi");
const { CashupClient } = require("../src/CashupClient");
const { SecretBox } = require("../src/SecretBox");
const { openStoreDatabase } = require("../src/StoreDatabase");
const { StoreService } = require("../src/StoreService");
const { poll } = require("../src/bot");

function idSet(value) {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function main() {
  const token = process.env.M_AUTOMATION_BOT_TOKEN || process.env.MINOF_AI_STUDIO_BOT_TOKEN;
  if (!token) throw new Error("M_AUTOMATION_BOT_TOKEN is required.");
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token.trim())) {
    console.warn("[warn] BOT_TOKEN format looks unusual — expected format: 123456:ABC-DEF...");
  }

  const dataKey = process.env.M_AUTOMATION_DATA_KEY || process.env.MINOF_AI_STUDIO_DATA_KEY;
  if (!dataKey) {
    throw new Error("M_AUTOMATION_DATA_KEY is required. Generate a random 32-byte hex value.");
  }

  const superAdminsRaw = process.env.M_AUTOMATION_SUPER_ADMIN_IDS || process.env.MINOF_AI_STUDIO_SUPER_ADMIN_IDS;
  const superAdmins = idSet(superAdminsRaw);

  const dbPath = process.env.M_AUTOMATION_DB_PATH || process.env.MINOF_AI_STUDIO_DB_PATH;
  const db = openStoreDatabase(dbPath);
  const secretBox = new SecretBox(dataKey);
  const cashupClient = new CashupClient();
  const store = new StoreService({ db, secretBox, cashupClient });

  for (const id of superAdmins) {
    store.ensureSuperAdmin(id, { displayName: `Owner ${id}`, addedBy: id, status: "active" });
  }
  store.ensureFirstUserOwner();

  const api = new TelegramApi(token);
  poll(api, store, superAdmins);
}

if (require.main === module) main();

module.exports = { main };
