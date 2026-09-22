#!/usr/bin/env node
"use strict";

const path = require("path");
const { DEVELOPMENT_CONTROL_RESOURCE_LIMITS, createDevelopmentControlBudget, readDevelopmentControlJson, readDevelopmentControlSnapshot } = require("../lib/development_control_snapshot");
const { finalizeDevelopmentEvaluationAttempt, startDevelopmentEvaluationAttempt } = require("../lib/development_evaluation_signer");
const { normalizeFailureCode } = require("../lib/development_run_accounting");

try {
  const args = process.argv.slice(2);
  const phase = args[0] === "--phase" ? args[1] : null;
  const configIndex = args.indexOf("--config");
  const handoffIndex = args.indexOf("--handoff");
  if (!["start", "finalize"].includes(phase) || configIndex < 0 || !args[configIndex + 1] || phase === "start" && args.length !== 4 || phase === "finalize" && (handoffIndex < 0 || !args[handoffIndex + 1] || args.length !== 6)) throw new Error("DEVELOPMENT_SIGNER_USAGE");
  const controlBudget = createDevelopmentControlBudget();
  const config = readDevelopmentControlJson(path.resolve(args[configIndex + 1]), DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxConfigBytes, controlBudget, "DEVELOPMENT_SIGNER_CONFIG_JSON").value;
  config.repositoryRoot = path.join(__dirname, "..");
  const privateKeyFile = process.env.EKG_EVALUATION_SIGNING_KEY_FILE;
  if (!privateKeyFile) throw new Error("EKG_EVALUATION_SIGNING_KEY_REQUIRED");
  const signingPrivateKeyPem = readDevelopmentControlSnapshot(path.resolve(privateKeyFile), DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxPrivateKeyBytes, controlBudget, "DEVELOPMENT_SIGNER_PRIVATE_KEY_FILE").bytes.toString("utf8");
  if (phase === "start") {
    const result = startDevelopmentEvaluationAttempt(config, signingPrivateKeyPem, { controlBudget });
    process.stdout.write(`${JSON.stringify({ attemptId: result.attemptId, startPayloadSha256: result.startPayloadSha256 })}\n`);
  } else {
    const result = finalizeDevelopmentEvaluationAttempt(config, path.resolve(args[handoffIndex + 1]), signingPrivateKeyPem, { controlBudget });
    process.stdout.write(`${JSON.stringify({ attemptId: result.attemptId, executionStatus: result.executionStatus, gateStatus: result.gateStatus, runId: result.runId })}\n`);
    if (result.gateStatus === "FAILED") process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${normalizeFailureCode(error, "DEVELOPMENT_SIGNER_FAILURE")}\n`);
  process.exitCode = 1;
}
