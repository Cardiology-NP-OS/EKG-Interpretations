"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEVELOPMENT_CONTROL_RESOURCE_LIMITS = Object.freeze({
  maxConfigBytes: 4 * 1024 * 1024,
  maxManifestBytes: 16 * 1024 * 1024,
  maxSignatureBytes: 64 * 1024,
  maxTrustStoreBytes: 4 * 1024 * 1024,
  maxPartitionIndexBytes: 16 * 1024 * 1024,
  maxRegistryBytes: 16 * 1024 * 1024,
  maxPrivateKeyBytes: 64 * 1024,
  maxSignerControlBytes: 4 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(":");
}

function createDevelopmentControlBudget(maxBytes = DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxTotalBytes) {
  requireCondition(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxTotalBytes, "DEVELOPMENT_CONTROL_RESOURCE_LIMITS");
  return { maxBytes, totalBytes: 0 };
}

function assertControlPath(file) {
  const resolved = path.resolve(file);
  const root = path.parse(resolved).root;
  for (let current = path.dirname(resolved); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current, { bigint: true });
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "DEVELOPMENT_CONTROL_PATH");
    if (current === root) break;
  }
  return resolved;
}

function readDevelopmentControlSnapshot(file, maxBytes, budget, code) {
  requireCondition(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxTotalBytes, "DEVELOPMENT_CONTROL_RESOURCE_LIMITS");
  requireCondition(budget && Number.isSafeInteger(budget.maxBytes) && budget.maxBytes > 0 && budget.maxBytes <= DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxTotalBytes && Number.isSafeInteger(budget.totalBytes) && budget.totalBytes >= 0 && budget.totalBytes <= budget.maxBytes, "DEVELOPMENT_CONTROL_RESOURCE_LIMITS");
  let descriptor = null;
  try {
    const resolved = assertControlPath(file);
    const before = fs.lstatSync(resolved, { bigint: true });
    requireCondition(before.isFile() && !before.isSymbolicLink() && before.size > 0n && before.size <= BigInt(maxBytes), "DEVELOPMENT_CONTROL_FILE_SIZE");
    requireCondition(budget.totalBytes <= budget.maxBytes - Number(before.size), "DEVELOPMENT_CONTROL_TOTAL_SIZE");
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    requireCondition(opened.isFile() && statIdentity(before) === statIdentity(opened), "DEVELOPMENT_CONTROL_READ_RACE");
    budget.totalBytes += Number(opened.size);
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(resolved, { bigint: true });
    assertControlPath(resolved);
    requireCondition(statIdentity(opened) === statIdentity(after) && statIdentity(opened) === statIdentity(current) && offset === Number(opened.size), "DEVELOPMENT_CONTROL_READ_RACE");
    const snapshot = bytes.subarray(0, offset);
    return Object.freeze({ bytes: snapshot, sha256: crypto.createHash("sha256").update(snapshot).digest("hex"), identity: statIdentity(opened) });
  } catch (error) {
    if (error && /^DEVELOPMENT_CONTROL_/.test(error.message)) throw error;
    throw new Error(code);
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
  }
}

function readDevelopmentControlJson(file, maxBytes, budget, code, expectedSha256) {
  const snapshot = readDevelopmentControlSnapshot(file, maxBytes, budget, code);
  if (expectedSha256 !== undefined) requireCondition(snapshot.sha256 === expectedSha256, `${code}_HASH`);
  let value;
  try { value = JSON.parse(snapshot.bytes.toString("utf8")); } catch (_) { throw new Error(code); }
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value), code);
  return Object.freeze({ ...snapshot, value });
}

module.exports = { DEVELOPMENT_CONTROL_RESOURCE_LIMITS, createDevelopmentControlBudget, readDevelopmentControlJson, readDevelopmentControlSnapshot };
