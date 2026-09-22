#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { verifyCompletedDevelopmentAttempt } = require("../lib/development_attempt_store");
const { normalizeFailureCode } = require("../lib/development_run_accounting");

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--config") throw new Error("DEVELOPMENT_ATTEMPT_VERIFY_USAGE");
  const config = JSON.parse(fs.readFileSync(path.resolve(args[1]), "utf8"));
  const privateKeyFile = process.env.EKG_EVALUATION_SIGNING_KEY_FILE;
  if (!privateKeyFile) throw new Error("EKG_EVALUATION_SIGNING_KEY_REQUIRED");
  const privateKey = crypto.createPrivateKey(fs.readFileSync(path.resolve(privateKeyFile), "utf8"));
  const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const attemptPath = path.join(config.artifactRoot, "attempts", ...config.startedAtUtc.slice(0, 10).split("-"), config.attemptId);
  const verification = verifyCompletedDevelopmentAttempt(attemptPath, config.artifactRoot, publicKey, { expectedSignerKeyId: config.signerKeyId });
  process.stdout.write(`${JSON.stringify({ schema: verification.schema, attemptId: verification.attemptId, executionStatus: verification.executionStatus })}\n`);
  if (verification.executionStatus === "INCOMPLETE") process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${normalizeFailureCode(error, "DEVELOPMENT_ATTEMPT_VERIFICATION_FAILURE")}\n`);
  process.exitCode = 1;
}
