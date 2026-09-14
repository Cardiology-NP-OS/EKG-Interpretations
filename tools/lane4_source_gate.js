const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PRIMARY_NAMES = Object.freeze([
  "31_MODE_ROUTER.md",
  "18_SELF_AUDIT_RUBRIC.md",
]);
const SUPPORT_NAMES = Object.freeze([
  "29_IMAGE_QUALITY_PROTOCOL.md",
  "32_REPORTING_LANGUAGE.md",
  "68_STRUCTURED_OUTPUT_GUIDE.md",
]);
const AUTHORITY_NAMES = Object.freeze([...PRIMARY_NAMES, ...SUPPORT_NAMES]);
const IMPORT_MANIFEST = JSON.parse(fs.readFileSync(path.join(
  ROOT, "clinical_control", "v12_1_candidate", "IMPORT_MANIFEST.json"
), "utf8"));
const EXPECTED_HASHES = Object.freeze(Object.fromEntries(
  IMPORT_MANIFEST.inventory
    .filter((item) => AUTHORITY_NAMES.includes(item.name))
    .map((item) => [item.name, item.sha256])
));
const IGNORED_DIRS = new Set([".git", "node_modules"]);

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function collectExactBasename(root, targetName, results = []) {
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) collectExactBasename(absolute, targetName, results);
    if (entry.isFile() && entry.name === targetName) results.push(absolute);
  }
  return results;
}

function portableRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function inspectAt(root = ROOT, expectedHashes = EXPECTED_HASHES) {
  const sources = AUTHORITY_NAMES.map((name) => {
    const expectedSha256 = expectedHashes[name] || null;
    const matches = collectExactBasename(root, name).map((absolute) => {
      const actualSha256 = sha256(absolute);
      return {
        path: portableRelative(root, absolute),
        sha256: actualSha256,
        expected_sha256: expectedSha256,
        hash_match: expectedSha256 === null ? false : actualSha256 === expectedSha256,
      };
    });
    return { name, expected_sha256: expectedSha256, matches };
  });

  const missingSources = sources
    .filter((source) => source.matches.length === 0)
    .map((source) => source.name);
  const ambiguousSources = sources
    .filter((source) => source.matches.length > 1)
    .map((source) => source.name);
  const unboundSources = sources
    .filter((source) => source.expected_sha256 === null)
    .map((source) => source.name);
  const hashMismatches = sources
    .filter((source) => source.matches.length === 1 && !source.matches[0].hash_match)
    .map((source) => source.name);

  return {
    schema: "ekg-l04-source-authority-gate-v1",
    pass: missingSources.length === 0 && ambiguousSources.length === 0 &&
      unboundSources.length === 0 && hashMismatches.length === 0,
    primary_sources: [...PRIMARY_NAMES],
    support_sources: [...SUPPORT_NAMES],
    required_sources: [...AUTHORITY_NAMES],
    sources,
    missing_sources: missingSources,
    ambiguous_sources: ambiguousSources,
    unbound_sources: unboundSources,
    hash_mismatches: hashMismatches,
    candidate_active: false,
  };
}

if (require.main === module) {
  try {
    const result = inspectAt();
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exit(1);
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-l04-source-authority-gate-v1",
      pass: false,
      error: String(error.message || error),
      candidate_active: false,
    }, null, 2));
    process.exit(1);
  }
}

module.exports = { PRIMARY_NAMES, SUPPORT_NAMES, AUTHORITY_NAMES, EXPECTED_HASHES, inspectAt };
