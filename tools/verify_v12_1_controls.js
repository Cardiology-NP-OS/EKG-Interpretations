const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PROVENANCE_PATH = path.join(ROOT, "manifests", "V12_1_REMAINING_CONTROLS.json");
const IMPORTED_DIR = path.join(
  ROOT, "clinical_control", "v12_1_candidate", "source_text", "remaining_controls"
);
const ORIGINAL_NAME = "EKG_CHATGPT_PROJECT_V12_1_HARDENED.zip";
const ORIGINAL_SHA256 = "c8d911ec42dc09ece708f8bafe4956a9f90853129ead04a8851383ebdb845ef5";
const DERIVATIVE_SHA256 = "61aa14599f66df4067b0e3e8671a6860e6d324c97b891e4b18a391a61c89e396";
const IMPORT_MANIFEST_SHA256 = "385fff74105a87ddcde2f1932b23f72b41d5a4907942ab2253173b7e9dea230f";
const TARGET_FILES = [
  "13_ANESTHESIA_PERIOP_OVERLAY.md",
  "18_SELF_AUDIT_RUBRIC.md",
  "19_RESPONSE_TEMPLATES.md",
  "24_PHENOTYPE_DIAGNOSIS_BOUNDARIES.md",
  "29_IMAGE_QUALITY_PROTOCOL.md",
  "31_MODE_ROUTER.md",
  "32_REPORTING_LANGUAGE.md",
  "35_INPUT_SECURITY.md",
  "68_STRUCTURED_OUTPUT_GUIDE.md",
];

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function sameArray(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPathContained(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(base, resolved);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function resolveContainedPath(root, relativePath, label) {
  requireCondition(typeof relativePath === "string" && relativePath.length > 0, label + "_PATH_INVALID");
  const portableAbsolute = (
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath)
  );
  requireCondition(!portableAbsolute, label + "_PATH_ABSOLUTE");
  requireCondition(
    !/^[A-Za-z]:/.test(relativePath),
    label + "_PATH_DRIVE_QUALIFIED"
  );
  requireCondition(
    !String(relativePath).split(/[\\/]+/).some(part => part === ".."),
    label + "_PATH_TRAVERSAL"
  );
  const resolved = path.resolve(root, relativePath);
  requireCondition(isPathContained(root, resolved), label + "_PATH_ESCAPE");
  return resolved;
}

function requireNoLinkAncestry(targetPath, boundary, label) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBoundary = path.resolve(boundary);
  requireCondition(isPathContained(resolvedBoundary, resolvedTarget), label + "_OUTSIDE_BOUNDARY");
  const relative = path.relative(resolvedBoundary, resolvedTarget);
  const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = resolvedBoundary;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    requireCondition(!stat.isSymbolicLink(), label + "_SYMLINK_ANCESTRY:" + current);
  }
  return resolvedTarget;
}

function filenameIdentityKey(name) {
  return String(name).normalize("NFKC").replace(/[ .]+$/g, "").toLowerCase();
}

function requireDistinctFilenameIdentities(names, label) {
  const seen = new Map();
  for (const name of names) {
    const key = filenameIdentityKey(name);
    requireCondition(Boolean(key), label + "_EMPTY_FILENAME_IDENTITY:" + name);
    if (seen.has(key) && seen.get(key) !== name) {
      throw new Error(label + "_FILENAME_IDENTITY_COLLISION:" + seen.get(key) + "|" + name);
    }
    seen.set(key, name);
  }
  return seen;
}

function validateProvenanceManifest(p) {
  requireCondition(p.schema === "ekg-v12-1-remaining-controls-provenance-v1", "PROVENANCE_SCHEMA");
  requireCondition(p.generated_validation_material === true, "PROVENANCE_GENERATED_MARKER");
  requireCondition(p.candidate_active === false, "PROVENANCE_CANDIDATE_MUST_BE_INACTIVE");
  requireCondition(p.clinical_source_wording_modified === false, "PROVENANCE_SOURCE_WORDING_FLAG");
  requireCondition(p.authoritative_source_pack.name === ORIGINAL_NAME, "SOURCE_PACK_NAME");
  requireCondition(p.authoritative_source_pack.sha256 === ORIGINAL_SHA256, "SOURCE_PACK_SHA256");
  requireCondition(p.authoritative_source_pack.runtime_project_version === "12.0", "SOURCE_PACK_VERSION");
  requireCondition(p.authoritative_source_pack.structured_output_schema_version === "3.1", "SOURCE_SCHEMA_VERSION");
  requireCondition(p.pinned_import_manifest.sha256 === IMPORT_MANIFEST_SHA256, "PINNED_IMPORT_MANIFEST_SHA256");
  requireCondition(p.source_set.exact_file_count === 9, "SOURCE_SET_COUNT");
  requireCondition(p.source_set.files.length === 9, "SOURCE_SET_FILE_COUNT");
  const rawNames = p.source_set.files.map(x => x.name);
  requireDistinctFilenameIdentities(rawNames, "SOURCE_SET");
  const names = [...rawNames].sort();
  requireCondition(sameArray(names, [...TARGET_FILES].sort()), "SOURCE_SET_INVENTORY");
  requireCondition(new Set(names).size === 9, "SOURCE_SET_DUPLICATE_NAME");
  for (const entry of p.source_set.files) {
    requireCondition(Number.isInteger(entry.bytes) && entry.bytes > 0, "SOURCE_SET_BYTES:" + entry.name);
    requireCondition(/^[0-9a-f]{64}$/.test(entry.sha256), "SOURCE_SET_HASH:" + entry.name);
  }
  const blocked = p.forbidden_source_artifacts || [];
  requireCondition(
    blocked.some(x => x.sha256 === DERIVATIVE_SHA256 && x.name === "v12_1_clinical_control_candidate.zip"),
    "DERIVATIVE_IDENTITY_NOT_BLOCKED"
  );
  for (const item of p.non_authoritative_transport_observations || []) {
    requireCondition(item.source_pack_identity === false, "TRANSPORT_ARTIFACT_MISLABELED:" + item.name);
  }
  return p;
}

function loadProvenanceManifest() {
  return validateProvenanceManifest(JSON.parse(fs.readFileSync(PROVENANCE_PATH, "utf8")));
}

function expectedMap(p) {
  return new Map(p.source_set.files.map(x => [x.name, x]));
}

function verifyDirectory(dir, p, label, boundary = null) {
  const resolvedDir = path.resolve(dir);
  requireCondition(fs.existsSync(resolvedDir), label + "_DIR_MISSING");
  const trustBoundary = boundary ? path.resolve(boundary) : path.parse(resolvedDir).root;
  requireNoLinkAncestry(resolvedDir, trustBoundary, label);
  const expected = expectedMap(p);
  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  const rawNames = entries.map(x => x.name);
  requireDistinctFilenameIdentities(rawNames, label);
  const names = [...rawNames].sort();
  requireCondition(sameArray(names, [...TARGET_FILES].sort()), label + "_INVENTORY_MISMATCH");
  const hashes = {};
  for (const entry of entries) {
    requireCondition(entry.isFile() && !entry.isSymbolicLink(), label + "_NOT_REGULAR_FILE:" + entry.name);
    const exp = expected.get(entry.name);
    requireCondition(Boolean(exp), label + "_UNEXPECTED_FILE:" + entry.name);
    const file = path.join(resolvedDir, entry.name);
    requireCondition(fs.statSync(file).size === exp.bytes, label + "_BYTE_COUNT_MISMATCH:" + entry.name);
    const actual = sha256File(file);
    requireCondition(actual === exp.sha256, label + "_SHA256_MISMATCH:" + entry.name);
    hashes[entry.name] = actual;
  }
  return hashes;
}
function verifyImportManifest(p) {
  const file = resolveContainedPath(ROOT, p.pinned_import_manifest.path, "IMPORT_MANIFEST");
  requireCondition(fs.existsSync(file), "IMPORT_MANIFEST_MISSING");
  requireNoLinkAncestry(file, path.parse(file).root, "IMPORT_MANIFEST");
  const stat = fs.lstatSync(file);
  requireCondition(stat.isFile() && !stat.isSymbolicLink(), "IMPORT_MANIFEST_NOT_REGULAR_FILE");
  requireCondition(sha256File(file) === IMPORT_MANIFEST_SHA256, "IMPORT_MANIFEST_SHA256_MISMATCH");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  requireCondition(m.schema === "ekg-v12-1-clinical-control-import-v1", "IMPORT_MANIFEST_SCHEMA");
  requireCondition(m.status === "QUARANTINED_CANDIDATE", "IMPORT_STATUS");
  requireCondition(m.activation_allowed === false, "IMPORT_ACTIVATION_POLICY");
  requireCondition(m.source_pack.name === ORIGINAL_NAME, "IMPORT_SOURCE_PACK_NAME");
  requireCondition(m.source_pack.sha256 === ORIGINAL_SHA256, "IMPORT_SOURCE_PACK_SHA256");
  requireCondition(m.source_pack.runtime_project_version === "12.0", "IMPORT_SOURCE_PACK_VERSION");
  requireCondition(m.source_pack.structured_output_schema_version === "3.1", "IMPORT_SOURCE_SCHEMA_VERSION");
  requireCondition(m.source_pack.active_runtime_sources === 16, "IMPORT_ACTIVE_RUNTIME_SOURCE_COUNT");
  requireCondition(m.archive_validation.manifest_entries_expected === 27, "ARCHIVE_MANIFEST_EXPECTED");
  requireCondition(m.archive_validation.manifest_entries_matched === 27, "ARCHIVE_MANIFEST_MATCHED");
  requireCondition(m.archive_validation.manifest_hash_mismatches === 0, "ARCHIVE_MANIFEST_HASH_MISMATCHES");
  requireCondition(m.archive_validation.manifest_entries_missing === 0, "ARCHIVE_MANIFEST_MISSING");
  requireCondition(m.archive_validation.archive_complete_against_manifest === true, "ARCHIVE_COMPLETENESS");
  const d = m.archive_validation.generated_derivative;
  requireCondition(d.sha256 === DERIVATIVE_SHA256, "DERIVATIVE_SHA256");
  requireCondition(d.must_not_be_used_as_source_pack_identity === true, "DERIVATIVE_POLICY");
  const inventory = new Map(m.inventory.map(x => [x.name, x]));
  requireCondition(inventory.size === m.inventory.length, "IMPORT_DUPLICATE_INVENTORY_NAME");
  for (const exp of p.source_set.files) {
    const got = inventory.get(exp.name);
    requireCondition(Boolean(got), "IMPORT_TARGET_MISSING:" + exp.name);
    requireCondition(got.bytes === exp.bytes, "IMPORT_TARGET_BYTES:" + exp.name);
    requireCondition(got.sha256 === exp.sha256, "IMPORT_TARGET_SHA256:" + exp.name);
  }
  return m;
}

function classifyArtifactHash(hash, p = loadProvenanceManifest()) {
  const value = String(hash || "").toLowerCase();
  if (value === ORIGINAL_SHA256) {
    return {
      classification: "original_user_archive",
      name: ORIGINAL_NAME,
      sha256: value,
      authoritative_source_pack: true,
      source_pack_identity: true,
    };
  }
  if (value === DERIVATIVE_SHA256) {
    return {
      classification: "generated_quarantine_derivative",
      name: "v12_1_clinical_control_candidate.zip",
      sha256: value,
      authoritative_source_pack: false,
      source_pack_identity: false,
    };
  }
  const transport = (p.non_authoritative_transport_observations || [])
    .find(item => item.sha256 === value);
  if (transport) {
    return {
      classification: "non_authoritative_transport_artifact",
      name: transport.name,
      sha256: value,
      authoritative_source_pack: false,
      source_pack_identity: false,
    };
  }
  return {
    classification: "unknown_artifact",
    name: null,
    sha256: value || null,
    authoritative_source_pack: false,
    source_pack_identity: false,
  };
}

function inspectSourceArtifact(file, p = loadProvenanceManifest()) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    return {
      classification: "absent",
      path: resolved,
      exists: false,
      authoritative_source_pack: false,
      source_pack_identity: false,
    };
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return {
      classification: "non_regular_artifact",
      path: resolved,
      exists: true,
      authoritative_source_pack: false,
      source_pack_identity: false,
    };
  }
  return {
    path: resolved,
    exists: true,
    ...classifyArtifactHash(sha256File(resolved), p),
  };
}

function classifyArchiveHash(hash, p = loadProvenanceManifest()) {
  const result = classifyArtifactHash(hash, p);
  if (result.classification === "original_user_archive") {
    return { identity: result.classification, name: result.name };
  }
  if (result.classification === "generated_quarantine_derivative") {
    throw new Error("SOURCE_ARCHIVE_IS_GENERATED_DERIVATIVE");
  }
  if (result.classification === "non_authoritative_transport_artifact") {
    throw new Error("SOURCE_ARCHIVE_IS_NONAUTHORITATIVE_TRANSPORT");
  }
  throw new Error("SOURCE_ARCHIVE_SHA256_MISMATCH");
}

function verifyArchive(file, p = loadProvenanceManifest()) {
  const inspection = inspectSourceArtifact(file, p);
  requireCondition(inspection.classification !== "absent", "SOURCE_ARCHIVE_MISSING");
  requireCondition(inspection.classification !== "non_regular_artifact", "SOURCE_ARCHIVE_NOT_REGULAR_FILE");
  return classifyArchiveHash(inspection.sha256, p);
}

function parseNullGitRecords(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function verifyGitSubtreeInventoryAt(repoRoot, p) {
  const prefix = path.posix.join(
    "clinical_control", "v12_1_candidate", "source_text", "remaining_controls"
  );
  const expectedPaths = p.source_set.files.map(x => prefix + "/" + x.name).sort();

  const staged = spawnSync(
    "git",
    ["ls-files", "--stage", "-z", "--", prefix],
    { cwd: repoRoot, encoding: null, maxBuffer: 2 * 1024 * 1024 }
  );
  requireCondition(staged.status === 0, "GIT_INDEX_INVENTORY_COMMAND_FAILED");
  const indexRecords = parseNullGitRecords(staged.stdout).map(record => {
    const match = /^([0-9]{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(record);
    requireCondition(Boolean(match), "GIT_INDEX_INVENTORY_RECORD_INVALID");
    const [, mode, , stage, gitPath] = match;
    requireCondition(stage === "0", "GIT_INDEX_UNMERGED:" + gitPath);
    requireCondition(mode === "100644", "GIT_INDEX_MODE_MISMATCH:" + gitPath);
    requireCondition(gitPath.startsWith(prefix + "/"), "GIT_INDEX_PATH_OUTSIDE_SUBTREE:" + gitPath);
    const relative = gitPath.slice(prefix.length + 1);
    requireCondition(!relative.includes("/") && !relative.includes("\\"), "GIT_INDEX_NESTED_PATH:" + relative);
    return { path: gitPath, relative };
  });
  requireDistinctFilenameIdentities(indexRecords.map(x => x.relative), "GIT_INDEX_SUBTREE");
  requireCondition(
    sameArray(indexRecords.map(x => x.path).sort(), expectedPaths),
    "GIT_INDEX_INVENTORY_MISMATCH"
  );

  const head = spawnSync(
    "git",
    ["ls-tree", "-r", "-z", "HEAD", "--", prefix],
    { cwd: repoRoot, encoding: null, maxBuffer: 2 * 1024 * 1024 }
  );
  requireCondition(head.status === 0, "GIT_HEAD_INVENTORY_COMMAND_FAILED");
  const headRecords = parseNullGitRecords(head.stdout).map(record => {
    const match = /^([0-9]{6}) ([^ ]+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    requireCondition(Boolean(match), "GIT_HEAD_INVENTORY_RECORD_INVALID");
    const [, mode, type, , gitPath] = match;
    requireCondition(mode === "100644" && type === "blob", "GIT_HEAD_MODE_MISMATCH:" + gitPath);
    requireCondition(gitPath.startsWith(prefix + "/"), "GIT_HEAD_PATH_OUTSIDE_SUBTREE:" + gitPath);
    const relative = gitPath.slice(prefix.length + 1);
    requireCondition(!relative.includes("/") && !relative.includes("\\"), "GIT_HEAD_NESTED_PATH:" + relative);
    return { path: gitPath, relative };
  });
  requireDistinctFilenameIdentities(headRecords.map(x => x.relative), "GIT_HEAD_SUBTREE");
  requireCondition(
    sameArray(headRecords.map(x => x.path).sort(), expectedPaths),
    "GIT_HEAD_INVENTORY_MISMATCH"
  );

  return {
    index_paths: indexRecords.map(x => x.path).sort(),
    committed_paths: headRecords.map(x => x.path).sort(),
  };
}

function verifyGitBytePolicyAt(repoRoot, importedDir, p) {
  const subtreeInventory = verifyGitSubtreeInventoryAt(repoRoot, p);
  const workingTree = {};
  const index = {};
  const committed = {};
  const attributes = { working_tree: {}, index: {}, committed: {} };
  for (const exp of p.source_set.files) {
    const rel = path.posix.join(
      "clinical_control", "v12_1_candidate", "source_text", "remaining_controls", exp.name
    );
    const file = path.join(importedDir, exp.name);
    const attrChecks = [
      ["working_tree", ["check-attr", "text", "--", rel], "GIT_WORKTREE"],
      ["index", ["check-attr", "--cached", "text", "--", rel], "GIT_INDEX"],
      ["committed", ["check-attr", "--source=HEAD", "text", "--", rel], "GIT_HEAD"],
    ];
    for (const [layer, args, prefix] of attrChecks) {
      const attr = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
      requireCondition(attr.status === 0, prefix + "_ATTR_CHECK_FAILED:" + exp.name);
      requireCondition(/: text: unset\s*$/.test(attr.stdout), prefix + "_TEXT_POLICY_NOT_UNSET:" + exp.name);
      attributes[layer][exp.name] = "unset";
    }

    const stage = spawnSync("git", ["ls-files", "--stage", "--", rel], { cwd: repoRoot, encoding: "utf8" });
    requireCondition(stage.status === 0 && /^100644\s/.test(stage.stdout), "GIT_INDEX_MODE_MISMATCH:" + exp.name);
    const headMode = spawnSync("git", ["ls-tree", "HEAD", "--", rel], { cwd: repoRoot, encoding: "utf8" });
    requireCondition(
      headMode.status === 0 && /^100644 blob\s/.test(headMode.stdout),
      "GIT_HEAD_MODE_MISMATCH:" + exp.name
    );

    const indexed = spawnSync("git", ["show", ":" + rel], { cwd: repoRoot, encoding: null, maxBuffer: 2 * 1024 * 1024 });
    requireCondition(indexed.status === 0, "GIT_INDEX_SOURCE_MISSING:" + exp.name);
    const indexedHash = sha256Buffer(indexed.stdout);
    requireCondition(indexedHash === exp.sha256, "GIT_INDEX_SHA256_MISMATCH:" + exp.name);

    const head = spawnSync("git", ["show", "HEAD:" + rel], { cwd: repoRoot, encoding: null, maxBuffer: 2 * 1024 * 1024 });
    requireCondition(head.status === 0, "GIT_HEAD_SOURCE_MISSING:" + exp.name);
    const committedHash = sha256Buffer(head.stdout);
    requireCondition(committedHash === exp.sha256, "GIT_HEAD_SHA256_MISMATCH:" + exp.name);

    const workingHash = sha256File(file);
    requireCondition(workingHash === exp.sha256, "GIT_WORKTREE_SHA256_MISMATCH:" + exp.name);
    requireCondition(indexedHash === committedHash && committedHash === workingHash, "GIT_THREE_WAY_MISMATCH:" + exp.name);

    workingTree[exp.name] = workingHash;
    index[exp.name] = indexedHash;
    committed[exp.name] = committedHash;
  }
  return { working_tree: workingTree, index, committed, attributes, subtree_inventory: subtreeInventory };
}

function verifyGitBytePolicy(p) {
  return verifyGitBytePolicyAt(ROOT, IMPORTED_DIR, p);
}

function verify(options = {}) {
  const p = loadProvenanceManifest();
  verifyImportManifest(p);
  const imported = verifyDirectory(IMPORTED_DIR, p, "REPO_CONTROL");
  const gitBytes = verifyGitBytePolicy(p);
  let source = null;
  let archive = null;
  if (options.sourceDir) source = verifyDirectory(path.resolve(options.sourceDir), p, "SOURCE_CONTROL");
  if (options.archive) archive = verifyArchive(path.resolve(options.archive));
  return {
    schema: "ekg-v12-1-remaining-controls-verification-v1",
    pass: true,
    candidate_active: false,
    generated_validation_material: true,
    source_pack_sha256: ORIGINAL_SHA256,
    exact_file_count: TARGET_FILES.length,
    imported_hashes: imported,
    git_working_tree_hashes: gitBytes.working_tree,
    git_index_hashes: gitBytes.index,
    git_committed_hashes: gitBytes.committed,
    git_text_attribute_policy: gitBytes.attributes,
    git_subtree_inventory: gitBytes.subtree_inventory,
    external_source_verified: Boolean(source),
    original_archive_verified: Boolean(archive),
  };
}

function optionValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (require.main === module) {
  try {
    const sourceDir = optionValue("--source-dir") || process.env.EKG_V12_1_CONTROL_SOURCE_DIR;
    const archive = optionValue("--archive") || process.env.EKG_V12_1_ORIGINAL_ARCHIVE;
    if (process.argv.includes("--require-source")) {
      requireCondition(Boolean(sourceDir), "SOURCE_CONTROL_DIR_REQUIRED");
    }
    if (process.argv.includes("--require-archive")) {
      requireCondition(Boolean(archive), "SOURCE_ARCHIVE_REQUIRED");
    }
    console.log(JSON.stringify(verify({ sourceDir, archive }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-v12-1-remaining-controls-verification-v1",
      pass: false,
      candidate_active: false,
      error: String(error.message || error),
    }, null, 2));
    process.exit(1);
  }
}

module.exports = {
  validateProvenanceManifest,
  loadProvenanceManifest,
  verifyDirectory,
  verifyImportManifest,
  isPathContained,
  resolveContainedPath,
  requireNoLinkAncestry,
  filenameIdentityKey,
  requireDistinctFilenameIdentities,
  verifyGitSubtreeInventoryAt,
  verifyGitBytePolicyAt,
  verifyGitBytePolicy,
  classifyArtifactHash,
  inspectSourceArtifact,
  classifyArchiveHash,
  verifyArchive,
  verify,
  sha256File,
  TARGET_FILES,
  IMPORTED_DIR,
  ORIGINAL_SHA256,
  DERIVATIVE_SHA256,
};
