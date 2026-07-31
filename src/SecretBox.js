"use strict";

const crypto = require("crypto");

function keyFromValue(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Encryption key is required.");
  const hex = raw.startsWith("hex:") ? raw.slice(4) : raw;
  if (/^[a-f0-9]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

class SecretBox {
  constructor(secret) {
    this.key = keyFromValue(secret);
  }

  encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(value || ""), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
  }

  decrypt(payload) {
    const text = String(payload || "");
    const parts = text.split(":");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Stored data cannot be decrypted.");
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}

module.exports = { SecretBox };
