"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SecretBox } = require("../src/SecretBox");
const { openStoreDatabase } = require("../src/StoreDatabase");
const { StoreService } = require("../src/StoreService");
const { handleCallback, handleMessage } = require("../src/bot");
const { bootstrapSuperAdmins } = require("../bin/m-automation-bot");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "m-automation-store-test-"));
  const db = openStoreDatabase(path.join(directory, "store.db"));
  const store = new StoreService({
    db,
    secretBox: new SecretBox("a".repeat(64)),
  });
  return {
    store,
    cleanup() {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function makeApi() {
  const calls = [];
  const record = (method) => async (...args) => {
    calls.push({ method, args });
    return true;
  };
  return {
    calls,
    answerCallbackQuery: record("answerCallbackQuery"),
    editMessageText: record("editMessageText"),
    sendDocument: record("sendDocument"),
    sendMessage: record("sendMessage"),
    sendPhoto: record("sendPhoto"),
  };
}

function telegramUser(id, firstName = "User") {
  return { id: Number(id), first_name: firstName, username: `user${id}` };
}

test("bootstrap requires a configured admin only for an uninitialized database", () => {
  const { store, cleanup } = fixture();
  try {
    assert.throws(() => bootstrapSuperAdmins(store, new Set()), /SUPER_ADMIN_IDS/);
    bootstrapSuperAdmins(store, new Set(["100"]));
    assert.equal(store.isSuperAdmin("100"), true);

    store.addSuperAdmin("100", "101", { displayName: "Second owner" });
    store.deactivateSuperAdmin("100", "101");
    bootstrapSuperAdmins(store, new Set(["101"]));
    assert.equal(store.isSuperAdmin("101"), false, "a removed configured admin must not be reactivated on restart");
    assert.throws(() => store.deactivateSuperAdmin("100", "100"), /cannot remove their own role/);
  } finally {
    cleanup();
  }
});

test("merchant ownership, safe role removal, and accurate merchant reports", () => {
  const { store, cleanup } = fixture();
  try {
    store.ensureUser({ id: "1", first_name: "Owner" });
    store.ensureSuperAdmin("1", { displayName: "Owner", addedBy: "1" });
    store.addMerchant("1", "2", { displayName: "Merchant A" });
    store.addMerchant("1", "3", { displayName: "Merchant B" });
    store.ensureUser({ id: "4", first_name: "Buyer" });

    const first = store.createProduct("2", {
      title: "First product",
      pricePiasters: 10000,
      fulfillmentType: "ready_stock",
      status: "active",
    });
    store.addStock("2", first.id, ["first-code", "second-code"]);
    const second = store.createProduct("2", {
      title: "Second product",
      pricePiasters: 5000,
      fulfillmentType: "assisted",
      status: "active",
    });
    const foreign = store.createProduct("3", {
      title: "Foreign product",
      pricePiasters: 5000,
      fulfillmentType: "assisted",
      status: "active",
    });

    assert.throws(() => store.updateProductPrice("2", foreign.id, 6000), /Product not found/);
    store.updateProductPrice("1", foreign.id, 6000);

    store.adminCreditUser("1", "4", 30000, "test credit");
    assert.equal(store.purchase("4", first.id).ok, true);
    assert.equal(store.purchase("4", first.id).ok, true);

    const merchant = store.listMerchants().find((row) => row.telegram_id === "2");
    assert.equal(Number(merchant.product_count), 2);
    assert.equal(Number(merchant.order_count), 2);
    assert.equal(Number(merchant.gross_piasters), 20000);

    const archived = store.deleteProduct("2", first.id);
    assert.equal(archived.status, "archived");
    assert.equal(store.listUserPurchaseHistory("4").length, 2, "archiving must retain purchase history");

    store.deactivateMerchant("1", "2");
    assert.equal(store.isActiveMerchant("2"), false);
    assert.equal(store.getProduct(second.id).status, "paused");
    assert.throws(() => store.addStock("2", first.id, ["cannot-add"]), /Staff account is not active/);
    assert.throws(() => store.createProduct("2", {
      title: "Not allowed",
      pricePiasters: 100,
      fulfillmentType: "assisted",
    }), /Merchant is not active/);
  } finally {
    cleanup();
  }
});

test("manual top-up approval is receipt-gated and idempotent", () => {
  const { store, cleanup } = fixture();
  try {
    store.ensureUser({ id: "1", first_name: "Owner" });
    store.ensureSuperAdmin("1", { displayName: "Owner", addedBy: "1" });
    store.ensureUser({ id: "2", first_name: "Buyer" });

    const topup = store.createManualTopup("2", "wallet", 12500);
    assert.throws(() => store.approveManualTopup("1", topup.id), /awaiting approval/);
    const submitted = store.submitManualTopupProof("2", topup.id, { kind: "photo", fileId: "photo-file-id" });
    assert.equal(submitted.status, "proof_submitted");
    assert.throws(() => store.approveManualTopup("2", topup.id), /Admin permission/);

    const approved = store.approveManualTopup("1", topup.id);
    assert.equal(approved.alreadyApproved, false);
    assert.equal(approved.balance, 12500);
    const repeated = store.approveManualTopup("1", topup.id);
    assert.equal(repeated.alreadyApproved, true);
    assert.equal(store.balance("2"), 12500);

    const rejected = store.createManualTopup("2", "binance", 10000);
    store.submitManualTopupProof("2", rejected.id, { kind: "document", fileId: "document-file-id" });
    const result = store.rejectManualTopup("1", rejected.id, "Amount does not match receipt.");
    assert.equal(result.status, "rejected");
    assert.equal(store.balance("2"), 12500);
  } finally {
    cleanup();
  }
});

test("Telegram receipt flow reaches admins and credits the buyer once", async () => {
  const originalEnv = {
    MANUAL_TOPUPS_ENABLED: process.env.MANUAL_TOPUPS_ENABLED,
    MANUAL_WALLET_RECEIVER: process.env.MANUAL_WALLET_RECEIVER,
    MANUAL_WALLET_INSTRUCTIONS: process.env.MANUAL_WALLET_INSTRUCTIONS,
  };
  process.env.MANUAL_TOPUPS_ENABLED = "true";
  process.env.MANUAL_WALLET_RECEIVER = "01000000000";
  process.env.MANUAL_WALLET_INSTRUCTIONS = "Transfer the exact amount.";

  const { store, cleanup } = fixture();
  try {
    store.ensureUser({ id: "1", first_name: "Owner" });
    store.ensureSuperAdmin("1", { displayName: "Owner", addedBy: "1" });
    const api = makeApi();
    const buyer = telegramUser("2", "Buyer");

    await handleCallback(api, store, new Set(), {
      id: "callback-1",
      from: buyer,
      data: "manual_topup:wallet",
      message: { chat: { id: 2 }, message_id: 10 },
    });
    assert.deepEqual(store.getState("2"), { state: "manual_topup_amount", data: { paymentMethod: "wallet" } });

    await handleMessage(api, store, new Set(), { chat: { id: 2 }, from: buyer, text: "100" });
    const proofState = store.getState("2");
    assert.equal(proofState.state, "manual_topup_proof");

    await handleMessage(api, store, new Set(), {
      chat: { id: 2 },
      from: buyer,
      photo: [{ file_id: "small" }, { file_id: "large" }],
    });
    assert.equal(store.getState("2"), null);
    const pending = store.getManualTopup(proofState.data.topupId);
    assert.equal(pending.status, "proof_submitted");
    assert.ok(api.calls.some((call) => call.method === "sendPhoto" && call.args[0] === "1" && call.args[1] === "large"));

    await handleCallback(api, store, new Set(), {
      id: "callback-2",
      from: telegramUser("1", "Owner"),
      data: `admin:approve_manual_topup:${pending.id}`,
      message: { chat: { id: 1 }, message_id: 11 },
    });
    assert.equal(store.balance("2"), 10000);

    await handleCallback(api, store, new Set(), {
      id: "callback-3",
      from: telegramUser("1", "Owner"),
      data: `admin:approve_manual_topup:${pending.id}`,
      message: { chat: { id: 1 }, message_id: 12 },
    });
    assert.equal(store.balance("2"), 10000, "repeated callback must not credit twice");
  } finally {
    cleanup();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
