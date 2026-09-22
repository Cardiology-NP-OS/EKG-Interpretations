"use strict";

const crypto = require("crypto");
const { stableJson } = require("./evaluation_runtime");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateSha256(value, code) {
  requireCondition(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), code);
  return value;
}

function payloadSha256(payload) {
  return crypto.createHash("sha256").update(Buffer.from(stableJson(payload), "utf8")).digest("hex");
}

function verifySignedPayload(payload, signature, trustStore, options = {}) {
  requireCondition(plain(payload), "EVAL_SIGNATURE_PAYLOAD_REQUIRED");
  requireCondition(plain(signature), "EVAL_SIGNATURE_ENVELOPE_REQUIRED");
  requireCondition(plain(trustStore) && Array.isArray(trustStore.keys), "EVAL_SIGNATURE_TRUST_STORE_REQUIRED");
  requireCondition(signature.algorithm === "Ed25519", "EVAL_SIGNATURE_ALGORITHM");
  requireCondition(typeof signature.keyId === "string" && signature.keyId.length > 0, "EVAL_SIGNATURE_KEY_ID");
  requireCondition(typeof signature.signatureBase64 === "string" && signature.signatureBase64.length > 0, "EVAL_SIGNATURE_VALUE");
  const key = trustStore.keys.find(row => row.keyId === signature.keyId);
  requireCondition(key, "EVAL_SIGNATURE_UNKNOWN_KEY");
  requireCondition(key.status === "TRUSTED", "EVAL_SIGNATURE_UNTRUSTED_KEY");
  requireCondition(key.algorithm === "Ed25519", "EVAL_SIGNATURE_KEY_ALGORITHM");
  const bytes = Buffer.from(stableJson(payload), "utf8");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (signature.payloadSha256 !== undefined) {
    validateSha256(signature.payloadSha256, "EVAL_SIGNATURE_PAYLOAD_DIGEST");
    requireCondition(signature.payloadSha256 === digest, "EVAL_SIGNATURE_PAYLOAD_DIGEST_MISMATCH");
  }
  const verified = crypto.verify(null, bytes, key.publicKeyPem, Buffer.from(signature.signatureBase64, "base64"));
  requireCondition(verified, "EVAL_SIGNATURE_INVALID");
  if (options.minimumSequence !== undefined) {
    requireCondition(Number.isInteger(payload.sequence) && payload.sequence >= options.minimumSequence, "EVAL_SIGNATURE_ROLLBACK");
  }
  if (options.expectedPayloadSha256 !== undefined) {
    validateSha256(options.expectedPayloadSha256, "EVAL_SIGNATURE_EXPECTED_DIGEST");
    requireCondition(payloadSha256(payload) === options.expectedPayloadSha256, "EVAL_SIGNATURE_PAYLOAD_DIGEST_MISMATCH");
  }
  return {
    schema: "ekg-signed-payload-verification-v1",
    verified: true,
    keyId: signature.keyId,
    payloadSha256: digest,
  };
}

module.exports = { payloadSha256, validateSha256, verifySignedPayload };
