#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { finalizeDevelopmentEvaluationAttempt, startDevelopmentEvaluationAttempt } = require("../lib/development_evaluation_signer");
const { normalizeFailureCode } = require("../lib/development_run_accounting");

try {
  const args = process.argv.slice(2);
  const phase = args[0] === "--phase" ? args[1] : null;
  const configIndex = args.indexOf("--config");
  const handoffIndex = args.indexOf("--handoff");
  if (!["start", "finalize"].includes(phase) || configIndex < 0 || !args[configIndex + 1] || phase === "start" && args.length !== 4 || phase === "finalize" && (handoffIndex < 0 || !args[handoffIndex + 1] || args.length !== 6)) throw new Error("DEVELOPMENT_SIGNER_USAGE");
  const config = JSON.parse(fs.readFileSync(path.resolve(args[configIndex + 1]), "utf8"));
  config.repositoryRoot = path.join(__dirname, "..");
  const privateKeyFile = process.env.EKG_EVALUATION_SIGNING_KEY_FILE;
  if (!privateKeyFile) throw new Error("EKG_EVALUATION_SIGNING_KEY_REQUIRED");
  const signingPrivateKeyPem = fs.readFileSync(path.resolve(privateKeyFile), "utf8");
  if (phase === "start") {
    const result = startDevelopmentEvaluationAttempt(config, signingPrivateKeyPem);
    process.stdout.write(`${JSON.stringify({ attemptId: result.attemptId, startPayloadSha256: result.startPayloadSha256 })}\n`);
  } else {
    const result = finalizeDevelopmentEvaluationAttempt(config, path.resolve(args[handoffIndex + 1]), signingPrivateKeyPem);
    process.stdout.write(`${JSON.stringify({ attemptId: result.attemptId, executionStatus: result.executionStatus, gateStatus: result.gateStatus, runId: result.runId })}\n`);
    if (result.gateStatus === "FAILED") process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${normalizeFailureCode(error, "DEVELOPMENT_SIGNER_FAILURE")}\n`);
  process.exitCode = 1;
}
