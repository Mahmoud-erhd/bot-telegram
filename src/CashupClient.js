"use strict";

const fetch = require("node-fetch");

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

class CashupClient {
  constructor(options = {}) {
    this.enabled = options.enabled ?? /^(1|true|yes|on)$/i.test(String(process.env.CASHUP_ENABLED || process.env.TOPUPS_ENABLED || ""));
    this.baseUrl = trimTrailingSlash(options.baseUrl || process.env.CASHUP_BASE_URL || "https://cashup.cash/base");
    this.credential = options.credential || process.env.CASHUP_API_KEY || "";
    this.appId = options.appId || process.env.CASHUP_APP_ID || "";
    this.fetchImpl = options.fetchImpl || fetch;
  }

  assertReady() {
    if (!this.enabled) throw new Error("Wallet top-up is disabled.");
    if (!this.credential || !this.appId || /replace-with/i.test(this.credential + this.appId)) {
      throw new Error("Cashup settings are missing.");
    }
  }

  async postJson(url, body) {
    this.assertReady();
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.credential}`,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const message = data?.message || data?.error || `Payment request failed with status ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  createPaymentIntent({ productName, amount, orderId }) {
    const url = `${this.baseUrl}/api/v1/transactions/${encodeURIComponent(this.appId)}/payment_intents`;
    return this.postJson(url, {
      product_name: productName,
      amount,
      order_id: orderId,
    });
  }

  validatePaymentIntent(paymentIntentId, senderIdentifier) {
    const url = `${this.baseUrl}/api/v1/transactions/payment_intents/${encodeURIComponent(paymentIntentId)}/validate`;
    return this.postJson(url, {
      sender_identifier: senderIdentifier,
    });
  }
}

module.exports = { CashupClient };
