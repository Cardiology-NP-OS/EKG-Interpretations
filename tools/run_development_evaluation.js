#!/usr/bin/env node
"use strict";

const path = require("path");
const { DEVELOPMENT_CONTROL_RESOURCE_LIMITS, createDevelopmentControlBudget, readDevelopmentControlJson } = require("../lib/development_control_snapshot");
const { writeCandidateProcessFailure, writeDevelopmentExecutionHandoff } = require("../lib/development_execution_handoff");
const { normalizeFailureCode, runDevelopmentCandidateExecution } = require("../lib/development_evaluation_runner");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

let handoffPath = null;
try {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--config") throw new Error("DEVELOPMENT_EVALUATION_SPLIT_REQUIRED");
  const offset = args[0] === "--phase" && args[1] === "candidate" ? 2 : 0;
  if (args.length !== offset + 4 || args[offset] !== "--config" || args[offset + 2] !== "--handoff") throw new Error("DEVELOPMENT_CANDIDATE_USAGE");
  handoffPath = path.resolve(args[offset + 3]);
  const controlBudget = createDevelopmentControlBudget();
  const config = readDevelopmentControlJson(path.resolve(args[offset + 1]), DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxConfigBytes, controlBudget, "DEVELOPMENT_CANDIDATE_CONFIG_JSON").value;
  const handoff = runDevelopmentCandidateExecution(config, { controlBudget });
  const receipt = writeDevelopmentExecutionHandoff(handoffPath, handoff);
  process.stdout.write(`${JSON.stringify({ schema: handoff.schema, attemptId: handoff.attemptId, handoffStatus: handoff.handoffStatus, bytes: receipt.bytes })}\n`);
  if (handoff.handoffStatus !== "EXECUTED") process.exitCode = 1;
} catch (error) {
  const failureCode = normalizeFailureCode(error, "DEVELOPMENT_EVALUATION_CLI_FAILURE");
  if (handoffPath !== null) {
    try { writeCandidateProcessFailure(handoffPath, failureCode); } catch (_) {}
  }
  fail(failureCode);
}
