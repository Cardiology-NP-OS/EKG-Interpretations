#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { writeDevelopmentExecutionHandoff } = require("../lib/development_execution_handoff");
const { normalizeFailureCode, runDevelopmentCandidateExecution } = require("../lib/development_evaluation_runner");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

try {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--config") throw new Error("DEVELOPMENT_EVALUATION_SPLIT_REQUIRED");
  const offset = args[0] === "--phase" && args[1] === "candidate" ? 2 : 0;
  if (args.length !== offset + 4 || args[offset] !== "--config" || args[offset + 2] !== "--handoff") throw new Error("DEVELOPMENT_CANDIDATE_USAGE");
  const config = JSON.parse(fs.readFileSync(path.resolve(args[offset + 1]), "utf8"));
  const repositoryRoot = path.join(__dirname, "..");
  const handoff = runDevelopmentCandidateExecution({ ...config, repositoryRoot, candidateRoot: repositoryRoot });
  const receipt = writeDevelopmentExecutionHandoff(path.resolve(args[offset + 3]), handoff);
  process.stdout.write(`${JSON.stringify({ schema: handoff.schema, attemptId: handoff.attemptId, handoffStatus: handoff.handoffStatus, bytes: receipt.bytes })}\n`);
  if (handoff.handoffStatus !== "EXECUTED") process.exitCode = 1;
} catch (error) {
  fail(normalizeFailureCode(error, "DEVELOPMENT_EVALUATION_CLI_FAILURE"));
}
