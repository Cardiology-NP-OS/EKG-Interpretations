#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createDevelopmentWorkflowAttemptReceipt, developmentWorkflowAttemptReceiptSha256, serializeDevelopmentWorkflowAttemptReceipt } = require("../lib/development_workflow_attempt_receipt");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function readBoundedJson(filePath, code) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 1024 * 1024, code);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function parseArgs(args) {
  requireCondition(args.length === 18, "DEVELOPMENT_WORKFLOW_RECEIPT_USAGE");
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    requireCondition(["--event", "--jobs", "--repository", "--workflow-path", "--observer-run-id", "--observer-run-attempt", "--observer-sha", "--observer-workflow-path", "--output"].includes(name) && values[name] === undefined, "DEVELOPMENT_WORKFLOW_RECEIPT_USAGE");
    values[name] = args[index + 1];
  }
  requireCondition(Object.keys(values).length === 9 && Object.values(values).every(value => typeof value === "string" && value.length > 0), "DEVELOPMENT_WORKFLOW_RECEIPT_USAGE");
  return values;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const event = readBoundedJson(args["--event"], "DEVELOPMENT_WORKFLOW_RECEIPT_EVENT_FILE");
  const jobs = readBoundedJson(args["--jobs"], "DEVELOPMENT_WORKFLOW_RECEIPT_JOBS_FILE");
  requireCondition(event && event.workflow_run, "DEVELOPMENT_WORKFLOW_RECEIPT_EVENT_PAYLOAD");
  const receipt = createDevelopmentWorkflowAttemptReceipt(event.workflow_run, jobs, {
    expectedRepository: args["--repository"],
    expectedWorkflowPath: args["--workflow-path"],
    expectedWorkflowName: "Development ECG evaluation",
    observerRunId: args["--observer-run-id"],
    observerRunAttempt: Number(args["--observer-run-attempt"]),
    observerSha: args["--observer-sha"],
    observerWorkflowPath: args["--observer-workflow-path"],
  });
  const output = path.resolve(args["--output"]);
  const parent = fs.lstatSync(path.dirname(output));
  requireCondition(parent.isDirectory() && !parent.isSymbolicLink(), "DEVELOPMENT_WORKFLOW_RECEIPT_OUTPUT_PARENT");
  fs.writeFileSync(output, serializeDevelopmentWorkflowAttemptReceipt(receipt), { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ receiptId: receipt.receiptId, receiptSha256: developmentWorkflowAttemptReceiptSha256(receipt), phase: receipt.classification.phase, preLaunchFailure: receipt.classification.preLaunchFailure, observationIncomplete: receipt.classification.phase === "OBSERVATION_INCOMPLETE" })}\n`);
} catch (error) {
  process.stderr.write(`${error && error.message || "DEVELOPMENT_WORKFLOW_RECEIPT_FAILURE"}\n`);
  process.exitCode = 1;
}
