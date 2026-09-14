const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const verifier = require("../tools/verify_v12_1_controls");

const ROOT = path.resolve(__dirname, "..");
const CONTROL_REL = path.join(
  "clinical_control", "v12_1_candidate", "source_text", "remaining_controls"
);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + ": " + (error.stack || error));
    process.exitCode = 1;
  }
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-controls-"));
  for (const name of verifier.TARGET_FILES) {
    fs.copyFileSync(path.join(verifier.IMPORTED_DIR, name), path.join(dir, name));
  }
  return dir;
}

function manifestClone() {
  return JSON.parse(JSON.stringify(verifier.loadProvenanceManifest()));
}

function runGit(cwd, args, options = {}) {
  const child = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    input: options.input,
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return child.stdout.trim();
}

function repoFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-git-"));
  const repo = path.join(parent, "repo");
  runGit(parent, ["clone", "--no-hardlinks", ROOT, repo]);
  return {
    repo,
    importedDir: path.join(repo, CONTROL_REL),
  };
}

test("generated provenance manifest is explicitly non-clinical and candidate remains inactive", () => {
  const p = verifier.loadProvenanceManifest();
  assert.equal(p.generated_validation_material, true);
  assert.equal(p.candidate_active, false);
  assert.equal(p.clinical_source_wording_modified, false);
  assert.equal(p.source_set.exact_file_count, 9);
});

test("repository import is exact nine-file SHA-256 inventory", () => {
  const p = verifier.loadProvenanceManifest();
  const hashes = verifier.verifyDirectory(verifier.IMPORTED_DIR, p, "TEST_REPO");
  assert.equal(Object.keys(hashes).length, 9);
});

test("pinned import manifest preserves original archive identity and quarantine policy", () => {
  const p = verifier.loadProvenanceManifest();
  const m = verifier.verifyImportManifest(p);
  assert.equal(m.activation_allowed, false);
  assert.equal(m.source_pack.sha256, verifier.ORIGINAL_SHA256);
});

test("clean source fixture validates", () => {
  const p = verifier.loadProvenanceManifest();
  assert.equal(Object.keys(verifier.verifyDirectory(fixture(), p, "TEST_SOURCE")).length, 9);
});
test("missing file fails closed", () => {
  const dir = fixture();
  fs.unlinkSync(path.join(dir, verifier.TARGET_FILES[0]));
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /INVENTORY_MISMATCH/
  );
});

test("substituted file fails closed", () => {
  const dir = fixture();
  fs.copyFileSync(path.join(dir, verifier.TARGET_FILES[0]), path.join(dir, verifier.TARGET_FILES[1]));
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /BYTE_COUNT_MISMATCH|SHA256_MISMATCH/
  );
});

test("duplicated extra file fails exact inventory", () => {
  const dir = fixture();
  fs.copyFileSync(path.join(dir, verifier.TARGET_FILES[0]), path.join(dir, "13_ANESTHESIA_PERIOP_OVERLAY.copy.md"));
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /INVENTORY_MISMATCH/
  );
});

test("single-byte mutation fails SHA-256", () => {
  const dir = fixture();
  const file = path.join(dir, verifier.TARGET_FILES[0]);
  const bytes = fs.readFileSync(file);
  bytes[Math.floor(bytes.length / 2)] ^= 0x01;
  fs.writeFileSync(file, bytes);
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /SHA256_MISMATCH/
  );
});

test("newline mutation fails closed", () => {
  const dir = fixture();
  const file = path.join(dir, verifier.TARGET_FILES[2]);
  fs.appendFileSync(file, Buffer.from("\n"));
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /BYTE_COUNT_MISMATCH|SHA256_MISMATCH/
  );
});

test("CRLF LF conversion fails closed", () => {
  const dir = fixture();
  const file = path.join(dir, verifier.TARGET_FILES[3]);
  const before = fs.readFileSync(file, "utf8");
  const after = before.includes("\r\n") ? before.replace(/\r\n/g, "\n") : before.replace(/\n/g, "\r\n");
  assert.notEqual(after, before);
  fs.writeFileSync(file, after, "utf8");
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /BYTE_COUNT_MISMATCH|SHA256_MISMATCH/
  );
});
test("generated validation material cannot be substituted as clinical source", () => {
  const dir = fixture();
  fs.copyFileSync(
    path.join(__dirname, "..", "manifests", "V12_1_REMAINING_CONTROLS.json"),
    path.join(dir, verifier.TARGET_FILES[4])
  );
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /BYTE_COUNT_MISMATCH|SHA256_MISMATCH/
  );
});

test("wrong source project version is rejected", () => {
  const p = manifestClone();
  p.authoritative_source_pack.runtime_project_version = "11.9";
  assert.throws(() => verifier.validateProvenanceManifest(p), /SOURCE_PACK_VERSION/);
});

test("wrong source archive identity is rejected", () => {
  const p = manifestClone();
  p.authoritative_source_pack.sha256 = "0".repeat(64);
  assert.throws(() => verifier.validateProvenanceManifest(p), /SOURCE_PACK_SHA256/);
});

test("original user archive hash classifies only as original", () => {
  assert.equal(verifier.classifyArchiveHash(verifier.ORIGINAL_SHA256).identity, "original_user_archive");
});

test("generated derivative hash is explicitly rejected", () => {
  assert.throws(
    () => verifier.classifyArchiveHash(verifier.DERIVATIVE_SHA256),
    /SOURCE_ARCHIVE_IS_GENERATED_DERIVATIVE/
  );
});

test("known transport artifact hashes are explicitly non-authoritative", () => {
  const p = verifier.loadProvenanceManifest();
  for (const item of p.non_authoritative_transport_observations) {
    const classification = verifier.classifyArtifactHash(item.sha256, p);
    assert.equal(classification.classification, "non_authoritative_transport_artifact");
    assert.equal(classification.source_pack_identity, false);
    assert.throws(
      () => verifier.classifyArchiveHash(item.sha256, p),
      /SOURCE_ARCHIVE_IS_NONAUTHORITATIVE_TRANSPORT/
    );
  }
});

test("unknown hash remains unknown and cannot become original source identity", () => {
  const p = verifier.loadProvenanceManifest();
  const unknown = "0".repeat(64);
  const classification = verifier.classifyArtifactHash(unknown, p);
  assert.equal(classification.classification, "unknown_artifact");
  assert.equal(classification.authoritative_source_pack, false);
  assert.throws(() => verifier.classifyArchiveHash(unknown, p), /SOURCE_ARCHIVE_SHA256_MISMATCH/);
});

test("artifact classifier distinguishes original and generated derivative by hash only", () => {
  const p = verifier.loadProvenanceManifest();
  const original = verifier.classifyArtifactHash(verifier.ORIGINAL_SHA256, p);
  const derivative = verifier.classifyArtifactHash(verifier.DERIVATIVE_SHA256, p);
  assert.equal(original.classification, "original_user_archive");
  assert.equal(original.authoritative_source_pack, true);
  assert.equal(derivative.classification, "generated_quarantine_derivative");
  assert.equal(derivative.authoritative_source_pack, false);
});

test("missing path is classified absent without trusting an original-looking filename", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-discovery-"));
  const file = path.join(dir, "EKG_CHATGPT_PROJECT_V12_1_HARDENED.zip");
  const result = verifier.inspectSourceArtifact(file);
  assert.equal(result.classification, "absent");
  assert.equal(result.exists, false);
  assert.equal(result.authoritative_source_pack, false);
});

test("directory named like original archive is non-regular and rejected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-discovery-"));
  const file = path.join(dir, "EKG_CHATGPT_PROJECT_V12_1_HARDENED.zip");
  fs.mkdirSync(file);
  const result = verifier.inspectSourceArtifact(file);
  assert.equal(result.classification, "non_regular_artifact");
  assert.throws(() => verifier.verifyArchive(file), /SOURCE_ARCHIVE_NOT_REGULAR_FILE/);
});

test("unknown bytes cannot be promoted by the original archive filename", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-discovery-"));
  const file = path.join(dir, "EKG_CHATGPT_PROJECT_V12_1_HARDENED.zip");
  fs.writeFileSync(file, Buffer.from("not the original archive bytes"));
  const result = verifier.inspectSourceArtifact(file);
  assert.equal(result.classification, "unknown_artifact");
  assert.equal(result.source_pack_identity, false);
  assert.throws(() => verifier.verifyArchive(file), /SOURCE_ARCHIVE_SHA256_MISMATCH/);
});

test("Git attributes, working tree, index, and committed HEAD preserve exact source bytes", () => {
  const hashes = verifier.verifyGitBytePolicy(verifier.loadProvenanceManifest());
  assert.equal(Object.keys(hashes.working_tree).length, 9);
  assert.equal(Object.keys(hashes.index).length, 9);
  assert.equal(Object.keys(hashes.committed).length, 9);
  assert.deepEqual(hashes.working_tree, hashes.index);
  assert.deepEqual(hashes.index, hashes.committed);
});

test("require-source mode fails closed when no source path is supplied", () => {
  const tool = path.join(__dirname, "..", "tools", "verify_v12_1_controls.js");
  const env = { ...process.env };
  delete env.EKG_V12_1_CONTROL_SOURCE_DIR;
  const child = spawnSync(process.execPath, [tool, "--require-source"], { env, encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /SOURCE_CONTROL_DIR_REQUIRED/);
});

test("directory substituted for expected file fails closed", () => {
  const dir = fixture();
  const target = path.join(dir, verifier.TARGET_FILES[0]);
  fs.unlinkSync(target);
  fs.mkdirSync(target);
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /NOT_REGULAR_FILE/
  );
});

test("filesystem junction reparse substitution for expected source file fails closed", () => {
  const dir = fixture();
  const target = path.join(dir, verifier.TARGET_FILES[0]);
  const backing = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-junction-target-"));
  fs.unlinkSync(target);
  fs.symlinkSync(backing, target, "junction");
  assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /NOT_REGULAR_FILE/
  );
});

test("source-directory parent junction is rejected even when redirected bytes are exact", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-parent-link-"));
  const realParent = path.join(root, "real-parent");
  const realDir = path.join(realParent, "controls");
  fs.mkdirSync(realDir, { recursive: true });
  for (const name of verifier.TARGET_FILES) {
    fs.copyFileSync(path.join(verifier.IMPORTED_DIR, name), path.join(realDir, name));
  }
  const aliasParent = path.join(root, "alias-parent");
  fs.symlinkSync(realParent, aliasParent, process.platform === "win32" ? "junction" : "dir");
  const redirectedDir = path.join(aliasParent, "controls");
  assert.throws(
    () => verifier.verifyDirectory(redirectedDir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /TEST_SOURCE_SYMLINK_ANCESTRY/
  );
});

test("link ancestry helper rejects redirected parent paths directly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-ancestry-"));
  const realParent = path.join(root, "real-parent");
  fs.mkdirSync(realParent);
  const target = path.join(realParent, "source.txt");
  fs.writeFileSync(target, "source");
  const aliasParent = path.join(root, "alias-parent");
  fs.symlinkSync(realParent, aliasParent, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => verifier.requireNoLinkAncestry(path.join(aliasParent, "source.txt"), root, "TEST"),
    /TEST_SYMLINK_ANCESTRY/
  );
});

test("zero-length source file fails byte-count validation", () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, verifier.TARGET_FILES[1]), Buffer.alloc(0));
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /BYTE_COUNT_MISMATCH/
  );
});

test("truncated source file fails byte-count validation", () => {
  const dir = fixture();
  const target = path.join(dir, verifier.TARGET_FILES[2]);
  fs.writeFileSync(target, fs.readFileSync(target).subarray(0, 17));
  assert.throws(
    () => verifier.verifyDirectory(dir, verifier.loadProvenanceManifest(), "TEST_SOURCE"),
    /BYTE_COUNT_MISMATCH/
  );
});

test("filename identity rejects case aliases independent of filesystem behavior", () => {
  assert.equal(verifier.filenameIdentityKey("Example.md"), verifier.filenameIdentityKey("example.MD"));
  assert.throws(
    () => verifier.requireDistinctFilenameIdentities(["Example.md", "example.MD"], "TEST"),
    /TEST_FILENAME_IDENTITY_COLLISION/
  );
});

test("filename identity rejects Unicode compatibility aliases deterministically", () => {
  assert.equal(verifier.filenameIdentityKey("Ａ.md"), verifier.filenameIdentityKey("A.md"));
  assert.throws(
    () => verifier.requireDistinctFilenameIdentities(["Ａ.md", "A.md"], "TEST"),
    /TEST_FILENAME_IDENTITY_COLLISION/
  );
});

test("filename identity rejects trailing dot and space aliases deterministically", () => {
  assert.equal(verifier.filenameIdentityKey("Control.md. "), verifier.filenameIdentityKey("control.md"));
  assert.throws(
    () => verifier.requireDistinctFilenameIdentities(["Control.md. ", "control.md"], "TEST"),
    /TEST_FILENAME_IDENTITY_COLLISION/
  );
});

test("manifest filename identity collision is rejected before inventory matching", () => {
  const p = manifestClone();
  p.source_set.files[1].name = p.source_set.files[0].name.toLowerCase();
  assert.throws(
    () => verifier.validateProvenanceManifest(p),
    /SOURCE_SET_FILENAME_IDENTITY_COLLISION/
  );
});

test("pinned import manifest traversal segments are rejected before file access", () => {
  const p = manifestClone();
  for (const value of ["../outside.json", "..\\outside.json", "nested/../../outside.json"]) {
    p.pinned_import_manifest.path = value;
    assert.throws(
      () => verifier.verifyImportManifest(p),
      /IMPORT_MANIFEST_PATH_TRAVERSAL/
    );
  }
});

test("portable absolute pinned paths are rejected before file access", () => {
  for (const value of ["/outside.json", "C:\\outside.json", "\\\\server\\share\\outside.json"]) {
    assert.throws(
      () => verifier.resolveContainedPath(ROOT, value, "TEST_IMPORT"),
      /TEST_IMPORT_PATH_ABSOLUTE/
    );
  }
});

test("registered pinned import manifest path resolves within repository root", () => {
  const p = verifier.loadProvenanceManifest();
  const resolved = verifier.resolveContainedPath(ROOT, p.pinned_import_manifest.path, "TEST_IMPORT");
  assert.equal(verifier.isPathContained(ROOT, resolved), true);
});

test("case-mutated manifest inventory is rejected", () => {
  const p = manifestClone();
  p.source_set.files[0].name = p.source_set.files[0].name.toLowerCase();
  assert.throws(() => verifier.validateProvenanceManifest(p), /SOURCE_SET_INVENTORY/);
});

test("duplicate manifest entry cannot replace a distinct target", () => {
  const p = manifestClone();
  p.source_set.files[1] = { ...p.source_set.files[0] };
  assert.throws(
    () => verifier.validateProvenanceManifest(p),
    /SOURCE_SET_INVENTORY|SOURCE_SET_DUPLICATE_NAME/
  );
});

test("self-consistent manifest rebinding cannot bless mutated source bytes", () => {
  const dir = fixture();
  const p = manifestClone();
  const name = verifier.TARGET_FILES[3];
  const target = path.join(dir, name);
  fs.appendFileSync(target, Buffer.from([0x0a]));
  const entry = p.source_set.files.find(x => x.name === name);
  entry.bytes = fs.statSync(target).size;
  entry.sha256 = verifier.sha256File(target);
  assert.equal(Object.keys(verifier.verifyDirectory(dir, p, "TEST_SOURCE")).length, 9);
  assert.throws(() => verifier.verifyImportManifest(p), /IMPORT_TARGET_BYTES|IMPORT_TARGET_SHA256/);
});

test("unknown archive bytes fail end-to-end archive verification", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-v12-archive-"));
  const file = path.join(dir, "not-the-original.zip");
  fs.writeFileSync(file, Buffer.from("generated or reconstructed bytes"));
  assert.throws(() => verifier.verifyArchive(file), /SOURCE_ARCHIVE_SHA256_MISMATCH/);
});

test("require-archive mode fails closed when no archive path is supplied", () => {
  const tool = path.join(__dirname, "..", "tools", "verify_v12_1_controls.js");
  const env = { ...process.env };
  delete env.EKG_V12_1_ORIGINAL_ARCHIVE;
  const child = spawnSync(process.execPath, [tool, "--require-archive"], { env, encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /SOURCE_ARCHIVE_REQUIRED/);
});

test("staged index tamper is rejected even when working tree and HEAD remain exact", () => {
  const { repo, importedDir } = repoFixture();
  const p = verifier.loadProvenanceManifest();
  const name = verifier.TARGET_FILES[0];
  const rel = path.join(CONTROL_REL, name);
  const target = path.join(importedDir, name);
  const original = fs.readFileSync(target);
  fs.appendFileSync(target, Buffer.from([0x0a]));
  runGit(repo, ["add", "--", rel]);
  fs.writeFileSync(target, original);
  assert.throws(
    () => verifier.verifyGitBytePolicyAt(repo, importedDir, p),
    /GIT_INDEX_SHA256_MISMATCH/
  );
});

test("committed HEAD tamper is rejected even when index and working tree are restored", () => {
  const { repo, importedDir } = repoFixture();
  const p = verifier.loadProvenanceManifest();
  const name = verifier.TARGET_FILES[1];
  const rel = path.join(CONTROL_REL, name);
  const target = path.join(importedDir, name);
  const original = fs.readFileSync(target);
  fs.appendFileSync(target, Buffer.from([0x0a]));
  runGit(repo, ["add", "--", rel]);
  runGit(repo, ["-c", "user.name=EKG Provenance Test", "-c", "user.email=provenance@example.invalid", "commit", "-m", "tamper fixture"]);
  fs.writeFileSync(target, original);
  runGit(repo, ["add", "--", rel]);
  assert.throws(
    () => verifier.verifyGitBytePolicyAt(repo, importedDir, p),
    /GIT_HEAD_SHA256_MISMATCH/
  );
});

test("Git symlink-mode substitution is rejected without filesystem symlink privileges", () => {
  const { repo, importedDir } = repoFixture();
  const p = verifier.loadProvenanceManifest();
  const name = verifier.TARGET_FILES[2];
  const rel = path.join(CONTROL_REL, name).replace(/\\/g, "/");
  const blob = runGit(repo, ["hash-object", "-w", "--stdin"], { input: "../wrong-target" });
  runGit(repo, ["update-index", "--cacheinfo", "120000," + blob + "," + rel]);
  assert.throws(
    () => verifier.verifyGitBytePolicyAt(repo, importedDir, p),
    /GIT_INDEX_MODE_MISMATCH/
  );
});

test("committed Git symlink mode is rejected after index and worktree are restored", () => {
  const { repo, importedDir } = repoFixture();
  const p = verifier.loadProvenanceManifest();
  const name = verifier.TARGET_FILES[3];
  const rel = path.join(CONTROL_REL, name).replace(/\\/g, "/");
  const blob = runGit(repo, ["hash-object", "-w", "--stdin"], { input: "../wrong-target" });
  runGit(repo, ["update-index", "--cacheinfo", "120000," + blob + "," + rel]);
  runGit(repo, ["-c", "user.name=EKG Provenance Test", "-c", "user.email=provenance@example.invalid", "commit", "-m", "symlink-mode fixture"]);
  runGit(repo, ["restore", "--source=HEAD^", "--staged", "--worktree", "--", rel]);
  assert.throws(
    () => verifier.verifyGitBytePolicyAt(repo, importedDir, p),
    /GIT_HEAD_MODE_MISMATCH/
  );
});

if (process.exitCode) {
  console.error(JSON.stringify({
    schema: "ekg-v12-1-provenance-test-results-v1",
    pass: false,
    passed,
  }));
  process.exit(process.exitCode);
}
console.log(JSON.stringify({
  schema: "ekg-v12-1-provenance-test-results-v1",
  pass: true,
  passed,
  total: passed,
  candidate_active: false,
}));
