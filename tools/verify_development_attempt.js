#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const path = require("path");
const { DEVELOPMENT_CONTROL_RESOURCE_LIMITS, createDevelopmentControlBudget, readDevelopmentControlJson, readDevelopmentControlSnapshot } = require("../lib/development_control_snapshot");
const { verifyCompletedDevelopmentAttempt } = require("../lib/development_attempt_store");
const { normalizeFailureCode } = require("../lib/development_run_accounting");

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--config") throw new Error("DEVELOPMENT_ATTEMPT_VERIFY_USAGE");
  const controlBudget = createDevelopmentControlBudget();
  const config = readDevelopmentControlJson(path.resolve(args[1]), DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxConfigBytes, controlBudget, "DEVELOPMENT_ATTEMPT_VERIFY_CONFIG_JSON").value;
  const privateKeyFile = process.env.EKG_EVALUATION_SIGNING_KEY_FILE;
  if (!privateKeyFile) throw new Error("EKG_EVALUATION_SIGNING_KEY_REQUIRED");
  const privateKey = crypto.createPrivateKey(readDevelopmentControlSnapshot(path.resolve(privateKeyFile), DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxPrivateKeyBytes, controlBudget, "DEVELOPMENT_SIGNER_PRIVATE_KEY_FILE").bytes);
  const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const attemptPath = path.join(config.artifactRoot, "attempts", ...config.startedAtUtc.slice(0, 10).split("-"), config.attemptId);
  const verification = verifyCompletedDevelopmentAttempt(attemptPath, config.artifactRoot, publicKey, { expectedSignerKeyId: config.signerKeyId });
  process.stdout.write(`${JSON.stringify({ schema: verification.schema, attemptId: verification.attemptId, executionStatus: verification.executionStatus })}\n`);
  if (verification.executionStatus === "INCOMPLETE") process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${normalizeFailureCode(error, "DEVELOPMENT_ATTEMPT_VERIFICATION_FAILURE")}\n`);
  process.exitCode = 1;
}
