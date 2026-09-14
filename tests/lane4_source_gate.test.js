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
const SUPPORT_FIXTURES = [
  ["29_IMAGE_QUALITY_PROTOCOL.md", "image-quality-contract\n"],
  ["32_REPORTING_LANGUAGE.md", "reporting-contract\n"],
  ["68_STRUCTURED_OUTPUT_GUIDE.md", "structured-output-contract\n"],
];

function withSupport(entries, omittedName = null) {
  return [...entries, ...SUPPORT_FIXTURES.filter(([name]) => name !== omittedName)];
}

function hashText(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function expectedHashes(routerBody, auditBody) {
  return {
    "31_MODE_ROUTER.md": hashText(routerBody),
    "18_SELF_AUDIT_RUBRIC.md": hashText(auditBody),
    "29_IMAGE_QUALITY_PROTOCOL.md": hashText("image-quality-contract\n"),
    "32_REPORTING_LANGUAGE.md": hashText("reporting-contract\n"),
    "68_STRUCTURED_OUTPUT_GUIDE.md": hashText("structured-output-contract\n"),
  };
}

test("complete primary and support authority set passes", () => {
  const root = fixture(withSupport([
    ["sources/31_MODE_ROUTER.md", "router-contract\n"],
    ["sources/18_SELF_AUDIT_RUBRIC.md", "audit-contract\n"],
  ]));
  const result = inspectAt(root, expectedHashes("router-contract\n", "audit-contract\n"));
  assert.equal(result.pass, true);
  assert.deepEqual(result.missing_sources, []);
  assert.deepEqual(result.ambiguous_sources, []);
  assert.equal(result.primary_sources.length, 2);
  assert.equal(result.support_sources.length, 3);
});

test("missing primary authority fails closed", () => {
  const root = fixture(withSupport([
    ["18_SELF_AUDIT_RUBRIC.md", "audit-only\n"],
  ]));
  const result = inspectAt(root, expectedHashes("router-expected\n", "audit-only\n"));
  assert.equal(result.pass, false);
  assert.deepEqual(result.missing_sources, ["31_MODE_ROUTER.md"]);
});

test("missing support authority fails closed", () => {
  const root = fixture(withSupport([
    ["31_MODE_ROUTER.md", "router-contract\n"],
    ["18_SELF_AUDIT_RUBRIC.md", "audit-contract\n"],
  ], "29_IMAGE_QUALITY_PROTOCOL.md"));
  const result = inspectAt(root, expectedHashes("router-contract\n", "audit-contract\n"));
  assert.equal(result.pass, false);
  assert.deepEqual(result.missing_sources, ["29_IMAGE_QUALITY_PROTOCOL.md"]);
});
test("duplicate primary authority fails closed as ambiguous", () => {
  const root = fixture(withSupport([
    ["a/31_MODE_ROUTER.md", "router-a\n"],
    ["b/31_MODE_ROUTER.md", "router-b\n"],
    ["18_SELF_AUDIT_RUBRIC.md", "audit\n"],
  ]));
  const result = inspectAt(root, expectedHashes("router-a\n", "audit\n"));
  assert.equal(result.pass, false);
  assert.deepEqual(result.ambiguous_sources, ["31_MODE_ROUTER.md"]);
});

test("tampered primary authority fails closed on hash mismatch", () => {
  const root = fixture(withSupport([
    ["31_MODE_ROUTER.md", "router-tampered\n"],
    ["18_SELF_AUDIT_RUBRIC.md", "audit-contract\n"],
  ]));
  const result = inspectAt(root, expectedHashes("router-authoritative\n", "audit-contract\n"));
  assert.equal(result.pass, false);
  assert.deepEqual(result.hash_mismatches, ["31_MODE_ROUTER.md"]);
});

test("tampered support authority fails closed on hash mismatch", () => {
  const root = fixture([
    ...withSupport([
      ["31_MODE_ROUTER.md", "router-contract\n"],
      ["18_SELF_AUDIT_RUBRIC.md", "audit-contract\n"],
    ], "32_REPORTING_LANGUAGE.md"),
    ["32_REPORTING_LANGUAGE.md", "tampered-reporting\n"],
  ]);
  const result = inspectAt(root, expectedHashes("router-contract\n", "audit-contract\n"));
  assert.equal(result.pass, false);
  assert.deepEqual(result.hash_mismatches, ["32_REPORTING_LANGUAGE.md"]);
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
