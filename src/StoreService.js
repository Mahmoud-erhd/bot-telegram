"use strict";

const crypto = require("crypto");

const FULFILLMENT_TYPES = new Set(["ready_stock", "assisted"]);
const MIN_TOPUP_PIASTERS = 10 * 100;
const MAX_TOPUP_PIASTERS = 5000 * 100;

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, maxLength = 2000) {
  return String(value || "").trim().replace(/\s+\n/g, "\n").slice(0, maxLength);
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value || {});
}

function safeTelegramId(value, label = "Telegram ID") {
  const id = String(value || "").trim();
  if (!/^\d+$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function orderRef(prefix = "ORD") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function assertPositivePiasters(value, label = "Amount") {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`${label} must be a positive whole number.`);
  return amount;
}

function assertTopupAmount(amountPiasters) {
  const amount = assertPositivePiasters(amountPiasters, "Top-up amount");
  if (amount < MIN_TOPUP_PIASTERS || amount > MAX_TOPUP_PIASTERS) {
    throw new Error("Top-up amount is outside the allowed range.");
  }
  if (amount % 100 !== 0) throw new Error("Top-up amount must be a whole currency amount.");
  return amount;
}

class StoreService {
  constructor(options = {}) {
    this.db = options.db;
    this.secretBox = options.secretBox;
    this.cashupClient = options.cashupClient || null;
    if (!this.db) throw new Error("StoreService requires a database.");
    if (!this.secretBox) throw new Error("StoreService requires SecretBox.");
  }

  ensureUser(from = {}) {
    const id = safeTelegramId(from.id || from.telegram_id || from.telegramId, "User ID");
    const at = nowIso();
    this.db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = excluded.updated_at
    `).run(
      id,
      cleanText(from.username, 80),
      cleanText(from.first_name || from.firstName, 120),
      cleanText(from.last_name || from.lastName, 120),
      at,
      at
    );
    return id;
  }

  getUser(userId) {
    return this.db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(String(userId)) || null;
  }

  getUserLanguage(userId) {
    return this.getUser(userId)?.language || "ar";
  }

  setUserLanguage(userId, lang) {
    const id = safeTelegramId(userId, "User ID");
    const value = ["ar", "en"].includes(String(lang)) ? String(lang) : "ar";
    this.db.prepare("UPDATE users SET language = ?, updated_at = ? WHERE telegram_id = ?").run(value, nowIso(), id);
    return value;
  }

  firstUser() {
    return this.db.prepare("SELECT * FROM users ORDER BY created_at ASC LIMIT 1").get() || null;
  }

  ensureFirstUserOwner() {
    const first = this.firstUser();
    if (!first) return null;
    const displayName = [first.first_name, first.last_name].filter(Boolean).join(" ") || first.username || "Owner";
    return this.ensureSuperAdmin(first.telegram_id, {
      displayName,
      addedBy: first.telegram_id,
      status: "active",
    });
  }

  ensureMerchant(telegramId, options = {}) {
    const id = safeTelegramId(telegramId, "Merchant ID");
    const at = nowIso();
    this.db.prepare(`
      INSERT INTO merchants (telegram_id, display_name, status, added_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        display_name = COALESCE(NULLIF(excluded.display_name, ''), merchants.display_name),
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      id,
      cleanText(options.displayName || "", 160),
      options.status || "active",
      options.addedBy ? safeTelegramId(options.addedBy, "Admin ID") : "",
      at,
      at
    );
    return this.getMerchant(id);
  }

  getMerchant(telegramId) {
    return this.db.prepare("SELECT * FROM merchants WHERE telegram_id = ?").get(String(telegramId)) || null;
  }

  isActiveMerchant(telegramId) {
    return this.getMerchant(telegramId)?.status === "active";
  }

  listMerchants() {
    return this.db.prepare(`
      SELECT m.*,
        COUNT(p.id) AS product_count,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total_piasters), 0) AS gross_piasters
      FROM merchants m
      LEFT JOIN products p ON p.merchant_id = m.telegram_id
      LEFT JOIN orders o ON o.merchant_id = m.telegram_id
      GROUP BY m.telegram_id
      ORDER BY m.status ASC, gross_piasters DESC, m.created_at ASC
    `).all();
  }

  ensureSuperAdmin(telegramId, options = {}) {
    const id = safeTelegramId(telegramId, "Admin ID");
    const at = nowIso();
    this.db.prepare(`
      INSERT INTO super_admins (telegram_id, display_name, status, added_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        display_name = COALESCE(NULLIF(excluded.display_name, ''), super_admins.display_name),
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      id,
      cleanText(options.displayName || "", 160),
      options.status || "active",
      options.addedBy ? safeTelegramId(options.addedBy, "Admin ID") : "",
      at,
      at
    );
    this.ensureMerchant(id, {
      displayName: options.displayName || `Admin ${id}`,
      addedBy: options.addedBy || id,
      status: "active",
    });
    return this.getSuperAdmin(id);
  }

  getSuperAdmin(telegramId) {
    return this.db.prepare("SELECT * FROM super_admins WHERE telegram_id = ?").get(String(telegramId)) || null;
  }

  isSuperAdmin(telegramId) {
    return this.getSuperAdmin(telegramId)?.status === "active";
  }

  listSuperAdmins() {
    return this.db.prepare("SELECT * FROM super_admins ORDER BY status ASC, created_at ASC").all();
  }

  resolveUserId(input) {
    const raw = String(input || "").trim().replace(/^@/, "");
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const row = this.db.prepare("SELECT telegram_id FROM users WHERE telegram_id = ?").get(raw);
      return row ? row.telegram_id : raw;
    }
    const row = this.db.prepare("SELECT telegram_id FROM users WHERE username = ? COLLATE NOCASE").get(raw);
    return row ? row.telegram_id : null;
  }

  countUsers() {
    return Number(this.db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count || 0);
  }

  listUsers(limit = 20, offset = 0) {
    return this.db.prepare(`
      SELECT telegram_id, username, first_name, last_name, language, created_at
      FROM users
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `).all(Math.max(1, Math.min(50, Number(limit || 20))), Math.max(0, Number(offset || 0)));
  }

  balance(userId) {
    const id = safeTelegramId(userId, "User ID");
    const row = this.db.prepare("SELECT COALESCE(SUM(amount_piasters), 0) AS balance FROM ledger WHERE user_id = ?").get(id);
    return Number(row?.balance || 0);
  }

  ledger(userId, limit = 10) {
    return this.db.prepare(`
      SELECT * FROM ledger
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(safeTelegramId(userId, "User ID"), Math.max(1, Math.min(50, Number(limit || 10))));
  }

  adminCreditUser(adminId, userId, amountPiasters, note = "") {
    const admin = safeTelegramId(adminId, "Admin ID");
    const user = safeTelegramId(userId, "User ID");
    const amount = assertPositivePiasters(amountPiasters, "Credit");
    if (!this.getUser(user)) this.ensureUser({ id: user });
    const at = nowIso();
    this.db.prepare(`
      INSERT INTO ledger (user_id, type, amount_piasters, reference_type, reference_id, idempotency_key, note, created_at)
      VALUES (?, 'admin_credit', ?, 'admin', ?, ?, ?, ?)
    `).run(user, amount, admin, `admin-credit:${admin}:${user}:${at}`, cleanText(note || "Admin credit", 200), at);
    return this.balance(user);
  }

  adminZeroBalance(adminId, userId) {
    const admin = safeTelegramId(adminId, "Admin ID");
    const user = safeTelegramId(userId, "User ID");
    const current = this.balance(user);
    if (current === 0) return 0;
    const at = nowIso();
    this.db.prepare(`
      INSERT INTO ledger (user_id, type, amount_piasters, reference_type, reference_id, idempotency_key, note, created_at)
      VALUES (?, 'admin_zero', ?, 'admin', ?, ?, 'Admin zero balance', ?)
    `).run(user, -current, admin, `admin-zero:${admin}:${user}:${at}`, at);
    return this.balance(user);
  }

  getState(userId) {
    const row = this.db.prepare("SELECT * FROM conversation_state WHERE user_id = ?").get(String(userId));
    if (!row) return null;
    return { state: row.state, data: parseJson(row.data_json, {}) };
  }

  setState(userId, state, data = {}) {
    const id = safeTelegramId(userId, "User ID");
    this.db.prepare(`
      INSERT INTO conversation_state (user_id, state, data_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        state = excluded.state,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `).run(id, state, json(data), nowIso());
  }

  clearState(userId) {
    this.db.prepare("DELETE FROM conversation_state WHERE user_id = ?").run(String(userId));
  }

  async createTopup(userId, amountPiasters) {
    const id = safeTelegramId(userId, "User ID");
    const amount = assertTopupAmount(amountPiasters);
    if (!this.cashupClient) throw new Error("Payment provider is not configured.");
    const ref = orderRef("TOPUP");
    const data = await this.cashupClient.createPaymentIntent({
      productName: `${process.env.STORE_BRAND_NAME || "AI Studio bot"} wallet top-up`,
      amount: amount / 100,
      orderId: ref,
    });
    const paymentIntentId = data.payment_intent_id || data.paymentIntentId || data.id;
    if (!paymentIntentId) throw new Error("Payment provider did not return an ID.");
    const at = nowIso();
    const result = this.db.prepare(`
      INSERT INTO topups (
        user_id, amount_piasters, provider_order_id, payment_intent_id, status,
        receiver_number, instructions, raw_response_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      id,
      amount,
      ref,
      String(paymentIntentId),
      cleanText(data.receiverNumber || data.receiver_number || "", 120),
      cleanText(data.instructions || "", 1000),
      json(data),
      at,
      at
    );
    return this.getTopup(result.lastInsertRowid);
  }

  getTopup(topupId) {
    return this.db.prepare("SELECT * FROM topups WHERE id = ?").get(Number(topupId)) || null;
  }

  async validateTopup(userId, topupId, senderIdentifier) {
    const id = safeTelegramId(userId, "User ID");
    const topup = this.getTopup(topupId);
    if (!topup || topup.user_id !== id) throw new Error("Top-up request was not found.");
    if (topup.status === "succeeded") {
      return { ok: true, alreadyCredited: true, topup, balance: this.balance(id) };
    }
    if (topup.status !== "pending") throw new Error("This top-up is no longer pending.");
    if (!this.cashupClient) throw new Error("Payment provider is not configured.");
    const sender = cleanText(senderIdentifier, 180);
    if (!sender) throw new Error("Send the sender number or name.");

    let data;
    try {
      data = await this.cashupClient.validatePaymentIntent(topup.payment_intent_id, sender);
    } catch (error) {
      this.db.prepare(`
        UPDATE topups
        SET sender_identifier = ?, validate_attempts = validate_attempts + 1, last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(sender, cleanText(error.message, 500), nowIso(), topup.id);
      return { ok: false, topup: this.getTopup(topup.id), error: error.message || "Payment not found yet." };
    }

    const succeeded = data?.success === true || data?.status === "succeeded";
    if (!succeeded) {
      this.db.prepare(`
        UPDATE topups
        SET sender_identifier = ?, validate_attempts = validate_attempts + 1, last_error = ?, raw_response_json = ?, updated_at = ?
        WHERE id = ?
      `).run(sender, cleanText(data?.message || "Payment not found yet.", 500), json(data), nowIso(), topup.id);
      return { ok: false, topup: this.getTopup(topup.id), error: data?.message || "Payment not found yet." };
    }

    this.db.transaction(() => {
      const fresh = this.getTopup(topup.id);
      if (fresh.status === "succeeded") return;
      const at = nowIso();
      this.db.prepare(`
        UPDATE topups
        SET status = 'succeeded', sender_identifier = ?, validate_attempts = validate_attempts + 1,
          last_error = '', raw_response_json = ?, updated_at = ?
        WHERE id = ?
      `).run(sender, json(data), at, topup.id);
      this.db.prepare(`
        INSERT OR IGNORE INTO ledger (user_id, type, amount_piasters, reference_type, reference_id, idempotency_key, note, created_at)
        VALUES (?, 'topup', ?, 'topup', ?, ?, 'Wallet top-up', ?)
      `).run(id, topup.amount_piasters, String(topup.id), `topup:${topup.payment_intent_id}`, at);
    })();

    return { ok: true, alreadyCredited: false, topup: this.getTopup(topup.id), balance: this.balance(id), payload: data };
  }

  createProduct(merchantId, input = {}) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    if (!this.isActiveMerchant(mid) && !this.isSuperAdmin(mid)) throw new Error("Merchant is not active.");
    const fulfillmentType = cleanText(input.fulfillmentType || input.fulfillment_type, 40);
    if (!FULFILLMENT_TYPES.has(fulfillmentType)) throw new Error("Unsupported fulfillment type.");
    const title = cleanText(input.title, 180);
    if (!title) throw new Error("Product title is required.");
    const price = assertPositivePiasters(input.pricePiasters || input.price_piasters, "Product price");
    const at = nowIso();
    const result = this.db.prepare(`
      INSERT INTO products (
        merchant_id, title, category, description, price_piasters, fulfillment_type,
        status, delivery_template_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mid,
      title,
      cleanText(input.category || "Digital", 120),
      cleanText(input.description || "", 1200),
      price,
      fulfillmentType,
      input.status || (fulfillmentType === "ready_stock" ? "draft" : "active"),
      json(input.deliveryTemplate || {}),
      at,
      at
    );
    return this.getProduct(result.lastInsertRowid);
  }

  getProduct(productId) {
    return this.db.prepare(`
      SELECT p.*,
        m.display_name AS merchant_display_name,
        (SELECT COUNT(*) FROM stock_items s WHERE s.product_id = p.id AND s.status = 'available') AS available_stock
      FROM products p
      LEFT JOIN merchants m ON m.telegram_id = p.merchant_id
      WHERE p.id = ?
    `).get(Number(productId)) || null;
  }

  listProducts(options = {}) {
    const status = options.status ? cleanText(options.status, 20) : "";
    const where = status ? "WHERE p.status = ?" : "";
    const params = status ? [status] : [];
    return this.db.prepare(`
      SELECT p.*,
        m.display_name AS merchant_display_name,
        (SELECT COUNT(*) FROM stock_items s WHERE s.product_id = p.id AND s.status = 'available') AS available_stock
      FROM products p
      LEFT JOIN merchants m ON m.telegram_id = p.merchant_id
      ${where}
      ORDER BY p.status ASC, p.created_at DESC
    `).all(...params);
  }

  listMerchantProducts(merchantId) {
    return this.db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM stock_items s WHERE s.product_id = p.id AND s.status = 'available') AS available_stock
      FROM products p
      WHERE p.merchant_id = ?
      ORDER BY p.status ASC, p.created_at DESC
    `).all(safeTelegramId(merchantId, "Merchant ID"));
  }

  searchProducts(query) {
    const q = `%${String(query || "").trim()}%`;
    return this.db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM stock_items s WHERE s.product_id = p.id AND s.status = 'available') AS available_stock
      FROM products p
      WHERE p.status = 'active' AND (p.title LIKE ? OR p.category LIKE ? OR p.description LIKE ?)
      ORDER BY p.created_at DESC
      LIMIT 20
    `).all(q, q, q);
  }

  setProductStatus(merchantId, productId, status) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    if (!["active", "paused", "draft"].includes(status)) throw new Error("Invalid product status.");
    const product = this.getProduct(productId);
    if (!product || (product.merchant_id !== mid && !this.isSuperAdmin(mid))) throw new Error("Product not found.");
    this.db.prepare("UPDATE products SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), product.id);
    return this.getProduct(product.id);
  }

  updateProductPrice(merchantId, productId, pricePiasters) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    const product = this.getProduct(productId);
    if (!product || (product.merchant_id !== mid && !this.isSuperAdmin(mid))) throw new Error("Product not found.");
    const price = assertPositivePiasters(pricePiasters, "Product price");
    this.db.prepare("UPDATE products SET price_piasters = ?, updated_at = ? WHERE id = ?").run(price, nowIso(), product.id);
    return this.getProduct(product.id);
  }

  addStock(merchantId, productId, items = []) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    const product = this.getProduct(productId);
    if (!product || (product.merchant_id !== mid && !this.isSuperAdmin(mid))) throw new Error("Product not found.");
    if (product.fulfillment_type !== "ready_stock") throw new Error("Only ready-stock products can receive stock.");
    const cleanItems = items.map((item) => cleanText(item, 4000)).filter(Boolean);
    if (!cleanItems.length) throw new Error("Send at least one stock item.");
    const at = nowIso();
    const insert = this.db.prepare(`
      INSERT INTO stock_items (product_id, encrypted_payload, status, created_at, updated_at)
      VALUES (?, ?, 'available', ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const item of cleanItems) insert.run(product.id, this.secretBox.encrypt(item), at, at);
      this.db.prepare("UPDATE products SET status = 'active', updated_at = ? WHERE id = ?").run(at, product.id);
    });
    tx();
    return { added: cleanItems.length, product: this.getProduct(product.id) };
  }

  clearAvailableStock(merchantId, productId) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    const product = this.getProduct(productId);
    if (!product || (product.merchant_id !== mid && !this.isSuperAdmin(mid))) throw new Error("Product not found.");
    if (product.fulfillment_type !== "ready_stock") throw new Error("Only ready-stock products have stock.");
    return this.db.prepare("DELETE FROM stock_items WHERE product_id = ? AND status = 'available'").run(product.id).changes;
  }

  deleteProduct(merchantId, productId) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    const product = this.getProduct(productId);
    if (!product || (product.merchant_id !== mid && !this.isSuperAdmin(mid))) throw new Error("Product not found.");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM stock_items WHERE product_id = ? AND status = 'available'").run(product.id);
      this.db.prepare("DELETE FROM user_price_overrides WHERE product_id = ?").run(product.id);
      this.db.prepare("DELETE FROM products WHERE id = ?").run(product.id);
    })();
  }

  getUserPriceOverride(userId, productId) {
    return this.db.prepare("SELECT * FROM user_price_overrides WHERE user_id = ? AND product_id = ?")
      .get(String(userId), Number(productId)) || null;
  }

  setUserPriceOverride(adminId, userId, productId, pricePiasters, note = "") {
    const admin = safeTelegramId(adminId, "Admin ID");
    const user = safeTelegramId(userId, "User ID");
    const product = this.getProduct(productId);
    if (!product) throw new Error("Product not found.");
    const price = Number(pricePiasters);
    if (!Number.isInteger(price) || price < 0) throw new Error("Price must be a non-negative whole number.");
    const at = nowIso();
    this.db.prepare(`
      INSERT INTO user_price_overrides (user_id, product_id, price_piasters, note, set_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, product_id) DO UPDATE SET
        price_piasters = excluded.price_piasters,
        note = excluded.note,
        set_by = excluded.set_by,
        updated_at = excluded.updated_at
    `).run(user, product.id, price, cleanText(note, 200), admin, at, at);
    return this.getUserPriceOverride(user, product.id);
  }

  effectivePrice(userId, product) {
    const override = userId ? this.getUserPriceOverride(userId, product.id) : null;
    return override ? Number(override.price_piasters) : Number(product.price_piasters);
  }

  purchase(userId, productId, options = {}) {
    const user = safeTelegramId(userId, "User ID");
    const product = this.getProduct(productId);
    if (!product || product.status !== "active") return { ok: false, reason: "unavailable" };
    const total = this.effectivePrice(user, product);

    const userInput = cleanText(options.userInput || "", 4000);
    if (product.fulfillment_type === "assisted" && !userInput) {
      return { ok: false, reason: "needs_input", product };
    }

    return this.db.transaction(() => {
      const currentBalance = this.balance(user);
      if (currentBalance < total) {
        return { ok: false, reason: "insufficient_balance", balance: currentBalance, price: total };
      }

      let stock = null;
      let deliveryText = "";
      if (product.fulfillment_type === "ready_stock") {
        stock = this.db.prepare(`
          SELECT * FROM stock_items
          WHERE product_id = ? AND status = 'available'
          ORDER BY id ASC
          LIMIT 1
        `).get(product.id);
        if (!stock) return { ok: false, reason: "sold_out" };
        deliveryText = this.secretBox.decrypt(stock.encrypted_payload);
      }

      const ref = orderRef("ORD");
      const at = nowIso();
      const status = product.fulfillment_type === "ready_stock" ? "completed" : "awaiting_delivery";
      const result = this.db.prepare(`
        INSERT INTO orders (
          order_ref, user_id, merchant_id, product_id, quantity, unit_price_piasters,
          total_piasters, fulfillment_type, status, stock_item_id, user_input_encrypted,
          delivery_encrypted, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ref,
        user,
        product.merchant_id,
        product.id,
        total,
        total,
        product.fulfillment_type,
        status,
        stock?.id || null,
        userInput ? this.secretBox.encrypt(userInput) : "",
        deliveryText ? this.secretBox.encrypt(deliveryText) : "",
        at,
        at
      );
      const orderId = result.lastInsertRowid;
      this.db.prepare(`
        INSERT INTO ledger (user_id, type, amount_piasters, reference_type, reference_id, idempotency_key, note, created_at)
        VALUES (?, 'purchase', ?, 'order', ?, ?, ?, ?)
      `).run(user, -total, String(orderId), `order:${ref}:purchase`, product.title, at);

      if (stock) {
        const changed = this.db.prepare(`
          UPDATE stock_items
          SET status = 'sold', order_id = ?, sold_at = ?, updated_at = ?
          WHERE id = ? AND status = 'available'
        `).run(orderId, at, at, stock.id).changes;
        if (!changed) throw new Error("Stock changed during purchase. Try again.");
      }

      const order = this.getOrder(orderId);
      return {
        ok: true,
        order,
        product,
        deliveryText,
        balance: this.balance(user),
      };
    })();
  }

  getOrder(orderId) {
    const row = this.db.prepare(`
      SELECT o.*, p.title AS product_title, p.description AS product_description
      FROM orders o
      LEFT JOIN products p ON p.id = o.product_id
      WHERE o.id = ?
    `).get(Number(orderId));
    if (!row) return null;
    return {
      ...row,
      user_input_text: row.user_input_encrypted ? this.secretBox.decrypt(row.user_input_encrypted) : "",
      delivery_text: row.delivery_encrypted ? this.secretBox.decrypt(row.delivery_encrypted) : "",
    };
  }

  listUserPurchaseHistory(userId, limit = 20) {
    return this.db.prepare(`
      SELECT o.id, o.order_ref, o.product_id, o.total_piasters, o.fulfillment_type,
        o.status, o.created_at, p.title AS product_title
      FROM orders o
      LEFT JOIN products p ON p.id = o.product_id
      WHERE o.user_id = ?
      ORDER BY o.id DESC
      LIMIT ?
    `).all(safeTelegramId(userId, "User ID"), Math.max(1, Math.min(50, Number(limit || 20))));
  }

  listMerchantOrders(merchantId, options = {}) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    const status = options.status ? cleanText(options.status, 40) : "";
    const whereStatus = status ? "AND o.status = ?" : "";
    const params = status ? [mid, status] : [mid];
    return this.db.prepare(`
      SELECT o.*, p.title AS product_title
      FROM orders o
      LEFT JOIN products p ON p.id = o.product_id
      WHERE o.merchant_id = ? ${whereStatus}
      ORDER BY o.id DESC
      LIMIT ?
    `).all(...params, Math.max(1, Math.min(50, Number(options.limit || 20))));
  }

  deliverOrder(merchantId, orderId, deliveryText) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    const order = this.getOrder(orderId);
    if (!order || (order.merchant_id !== mid && !this.isSuperAdmin(mid))) throw new Error("Order not found.");
    if (order.status !== "awaiting_delivery") throw new Error("Order is not awaiting delivery.");
    const delivery = cleanText(deliveryText, 4000);
    if (!delivery) throw new Error("Delivery text is required.");
    const at = nowIso();
    this.db.prepare(`
      UPDATE orders
      SET status = 'completed', delivery_encrypted = ?, updated_at = ?
      WHERE id = ?
    `).run(this.secretBox.encrypt(delivery), at, order.id);
    return this.getOrder(order.id);
  }

  merchantStats(merchantId) {
    const mid = safeTelegramId(merchantId, "Merchant ID");
    return this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE merchant_id = ?) AS product_count,
        (SELECT COUNT(*) FROM orders WHERE merchant_id = ?) AS order_count,
        (SELECT COUNT(*) FROM orders WHERE merchant_id = ? AND status = 'awaiting_delivery') AS pending_delivery,
        (SELECT COALESCE(SUM(total_piasters), 0) FROM orders WHERE merchant_id = ? AND status IN ('completed','awaiting_delivery')) AS gross_piasters
    `).get(mid, mid, mid, mid);
  }

  platformStats() {
    return {
      users: this.countUsers(),
      merchants: this.db.prepare("SELECT COUNT(*) AS c FROM merchants WHERE status = 'active'").get().c,
      products: this.db.prepare("SELECT COUNT(*) AS c FROM products").get().c,
      orders: this.db.prepare("SELECT COUNT(*) AS c FROM orders").get().c,
      pending: this.db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'awaiting_delivery'").get().c,
      gross: this.db.prepare("SELECT COALESCE(SUM(total_piasters), 0) AS c FROM orders WHERE status IN ('completed','awaiting_delivery')").get().c,
    };
  }
}

module.exports = {
  MAX_TOPUP_PIASTERS,
  MIN_TOPUP_PIASTERS,
  StoreService,
  assertTopupAmount,
  cleanText,
  orderRef,
  safeTelegramId,
};
