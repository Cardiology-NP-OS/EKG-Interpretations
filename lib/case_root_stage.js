"use strict";

const fs = require("fs");
const path = require("path");
const { requireStoreDirectory } = require("./image_case_store");

const LABEL_RE = /^[a-z][a-z0-9-]{0,31}$/;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function stagePrefix(label) {
  requireCondition(typeof label === "string" && LABEL_RE.test(label), "CASE_ROOT_STAGE_LABEL");
  return `.${label}-staging-`;
}

function createCaseRootStage(caseDir, label) {
  requireCondition(typeof caseDir === "string" && caseDir.length > 0, "CASE_ROOT_STAGE_CASE_REQUIRED");
  const root = path.resolve(caseDir);
  requireStoreDirectory(root);
  const prefix = stagePrefix(label);
  const stage = fs.mkdtempSync(path.join(root, prefix));
  const info = fs.lstatSync(stage);
  requireCondition(
    path.dirname(stage) === root &&
    path.basename(stage).startsWith(prefix) &&
    info.isDirectory() &&
    !info.isSymbolicLink(),
    "CASE_ROOT_STAGE_SCOPE",
  );
  return stage;
}

function removeCaseRootStage(stage, caseDir, label) {
  if (!stage || !fs.existsSync(stage)) return;
  const root = path.resolve(caseDir);
  const resolved = path.resolve(stage);
  const prefix = stagePrefix(label);
  requireCondition(
    path.dirname(resolved) === root &&
    path.basename(resolved).startsWith(prefix),
    "CASE_ROOT_STAGE_SCOPE",
  );
  const info = fs.lstatSync(resolved);
  requireCondition(info.isDirectory() && !info.isSymbolicLink(), "CASE_ROOT_STAGE_SCOPE");
  fs.rmSync(resolved, { recursive: true, force: true });
}

module.exports = { createCaseRootStage, removeCaseRootStage };
