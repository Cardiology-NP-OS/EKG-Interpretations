const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const verifier = require("../tools/verify_v12_1_controls");

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

test("unknown or reconstructed archive hashes are not promoted to original identity", () => {
  const p = verifier.loadProvenanceManifest();
  for (const item of p.non_authoritative_transport_observations) {
    assert.throws(() => verifier.classifyArchiveHash(item.sha256), /SOURCE_ARCHIVE_SHA256_MISMATCH/);
  }
});

test("Git attributes and staged index preserve exact source bytes", () => {
  const hashes = verifier.verifyGitBytePolicy(verifier.loadProvenanceManifest());
  assert.equal(Object.keys(hashes).length, 9);
});

test("require-source mode fails closed when no source path is supplied", () => {
  const tool = path.join(__dirname, "..", "tools", "verify_v12_1_controls.js");
  const env = { ...process.env };
  delete env.EKG_V12_1_CONTROL_SOURCE_DIR;
  const child = spawnSync(process.execPath, [tool, "--require-source"], { env, encoding: "utf8" });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /SOURCE_CONTROL_DIR_REQUIRED/);
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
