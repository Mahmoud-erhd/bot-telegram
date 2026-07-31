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
  const token = process.env.MINOF_AI_STUDIO_BOT_TOKEN;
  if (!token) throw new Error("MINOF_AI_STUDIO_BOT_TOKEN is required.");
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token.trim())) {
    console.warn("[warn] BOT_TOKEN format looks unusual — expected format: 123456:ABC-DEF...");
  }
  if (!process.env.MINOF_AI_STUDIO_DATA_KEY) {
    throw new Error("MINOF_AI_STUDIO_DATA_KEY is required. Generate a random 32-byte hex value.");
  }

  const superAdmins = idSet(process.env.MINOF_AI_STUDIO_SUPER_ADMIN_IDS);
  const db = openStoreDatabase(process.env.MINOF_AI_STUDIO_DB_PATH);
  const secretBox = new SecretBox(process.env.MINOF_AI_STUDIO_DATA_KEY);
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
