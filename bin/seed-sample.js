#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

const { SecretBox } = require("../src/SecretBox");
const { openStoreDatabase } = require("../src/StoreDatabase");
const { StoreService } = require("../src/StoreService");

function firstAdminId() {
  const value = process.env.M_AUTOMATION_SUPER_ADMIN_IDS || process.env.MINOF_AI_STUDIO_SUPER_ADMIN_IDS;
  if (!value) throw new Error("M_AUTOMATION_SUPER_ADMIN_IDS is required for sample seeding.");
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0] || "100000000";
}

function main() {
  const dataKey = process.env.M_AUTOMATION_DATA_KEY || process.env.MINOF_AI_STUDIO_DATA_KEY;
  if (!dataKey) throw new Error("M_AUTOMATION_DATA_KEY is required for sample seeding.");

  const db = openStoreDatabase(process.env.M_AUTOMATION_DB_PATH || process.env.MINOF_AI_STUDIO_DB_PATH);
  const store = new StoreService({
    db,
    secretBox: new SecretBox(dataKey),
  });

  const adminId = firstAdminId();
  store.ensureUser({ id: adminId, first_name: "Owner" });
  store.ensureSuperAdmin(adminId, { displayName: "Owner", addedBy: adminId, status: "active" });

  const products = store.listMerchantProducts(adminId);
  if (!products.some((product) => product.title === "Sample Design Pack")) {
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
  }

  if (!products.some((product) => product.title === "Sample Custom Work")) {
    store.createProduct(adminId, {
      title: "Sample Custom Work",
      category: "Services",
      description: "Demo assisted order. The buyer sends requirements and the seller delivers later.",
      pricePiasters: 10000,
      fulfillmentType: "assisted",
      status: "active",
    });
  }

  if (store.balance(adminId) === 0) store.adminCreditUser(adminId, adminId, 25000, "Sample balance");
  console.log(`Seed completed. Admin: ${adminId}`);
}

if (require.main === module) main();
