#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const { SecretBox } = require("../src/SecretBox");
const { openStoreDatabase } = require("../src/StoreDatabase");
const { StoreService } = require("../src/StoreService");

function firstAdminId() {
  return String(process.env.MINOF_AI_STUDIO_SUPER_ADMIN_IDS || "100000000")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0] || "100000000";
}

function main() {
  if (!process.env.MINOF_AI_STUDIO_DATA_KEY) {
    process.env.MINOF_AI_STUDIO_DATA_KEY = crypto.randomBytes(32).toString("hex");
    console.log("Using temporary seed key because MINOF_AI_STUDIO_DATA_KEY is not set.");
  }

  const db = openStoreDatabase(process.env.MINOF_AI_STUDIO_DB_PATH);
  const store = new StoreService({
    db,
    secretBox: new SecretBox(process.env.MINOF_AI_STUDIO_DATA_KEY),
  });

  const adminId = firstAdminId();
  store.ensureUser({ id: adminId, first_name: "Owner" });
  store.ensureSuperAdmin(adminId, { displayName: "Owner", addedBy: adminId, status: "active" });

  const ready = store.createProduct(adminId, {
    title: "Sample Design Pack",
    category: "Digital Goods",
    description: "Demo ready-stock item for testing instant delivery.",
    pricePiasters: 5000,
    fulfillmentType: "ready_stock",
    status: "active",
  });
  store.addStock(adminId, ready.id, [
    "sample-pack-code-001",
    "sample-pack-code-002",
    "sample-pack-code-003",
  ]);

  store.createProduct(adminId, {
    title: "Sample Custom Work",
    category: "Services",
    description: "Demo assisted order. The buyer sends requirements and the seller delivers later.",
    pricePiasters: 10000,
    fulfillmentType: "assisted",
    status: "active",
  });

  store.adminCreditUser(adminId, adminId, 25000, "Sample balance");
  console.log(`Seed completed. Admin: ${adminId}`);
}

if (require.main === module) main();
