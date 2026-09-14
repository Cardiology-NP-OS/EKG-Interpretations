const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { inspectAt } = require("../tools/lane4_source_gate");

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

function fixture(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-l04-source-"));
  for (const [relative, body] of entries) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf8");
  }
  return root;
}

test("complete primary source set passes", () => {
  const root = fixture([
    ["sources/31_MODE_ROUTER.md", "router-contract\n"],
    ["sources/18_SELF_AUDIT_RUBRIC.md", "audit-contract\n"],
  ]);
  const result = inspectAt(root, expectedHashes("router-contract\n", "audit-contract\n"));
  assert.equal(result.pass, true);
  assert.deepEqual(result.missing_sources, []);
  assert.deepEqual(result.ambiguous_sources, []);
  assert.match(result.sources[0].matches[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(result.sources[1].matches[0].sha256, /^[a-f0-9]{64}$/);
});

test("missing primary authority fails closed", () => {
  const root = fixture([["18_SELF_AUDIT_RUBRIC.md", "audit-only\n"]]);
  const result = inspectAt(root, expectedHashes("router-expected\n", "audit-only\n"));
  assert.equal(result.pass, false);
  assert.deepEqual(result.missing_sources, ["31_MODE_ROUTER.md"]);
});

test("duplicate primary authority fails closed as ambiguous", () => {
  const root = fixture([
    ["a/31_MODE_ROUTER.md", "router-a\n"],
    ["b/31_MODE_ROUTER.md", "router-b\n"],
    ["18_SELF_AUDIT_RUBRIC.md", "audit\n"],
  ]);
  const result = inspectAt(root, expectedHashes("router-a\n", "audit\n"));
  assert.equal(result.pass, false);
  assert.deepEqual(result.ambiguous_sources, ["31_MODE_ROUTER.md"]);
});

test("tampered primary source fails closed on hash mismatch", () => {
  const root = fixture([
    ["31_MODE_ROUTER.md", "router-tampered\n"],
    ["18_SELF_AUDIT_RUBRIC.md", "audit-contract\n"],
  ]);
  const result = inspectAt(root, expectedHashes("router-authoritative\n", "audit-contract\n"));
  assert.equal(result.pass, false);
  assert.deepEqual(result.hash_mismatches, ["31_MODE_ROUTER.md"]);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-l04-source-gate-tests-v1",
  pass: true,
  passed,
  total: passed,
  clinical_accuracy_claimed: false,
  candidate_active: false,
}));

function hashText(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function expectedHashes(routerBody, auditBody) {
  return {
    "31_MODE_ROUTER.md": hashText(routerBody),
    "18_SELF_AUDIT_RUBRIC.md": hashText(auditBody),
  };
}
