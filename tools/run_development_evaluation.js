#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeFailureCode, runDevelopmentEvaluation } = require("../lib/development_evaluation_runner");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--config") throw new Error("USAGE: node tools/run_development_evaluation.js --config <path>");
  const configPath = path.resolve(args[1]);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const privateKeyFile = process.env.EKG_EVALUATION_SIGNING_KEY_FILE;
  if (!privateKeyFile) throw new Error("EKG_EVALUATION_SIGNING_KEY_REQUIRED");
  const result = runDevelopmentEvaluation({
    ...config,
    repositoryRoot: path.join(__dirname, ".."),
    signingPrivateKeyPem: fs.readFileSync(path.resolve(privateKeyFile), "utf8"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.gateStatus === "FAILED") process.exitCode = 2;
} catch (error) {
  fail(normalizeFailureCode(error, "DEVELOPMENT_EVALUATION_CLI_FAILURE"));
}
