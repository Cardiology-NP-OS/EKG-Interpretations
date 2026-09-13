const fs = require("fs");
const path = require("path");
const { DATA, SOURCE_MANIFEST, verify } = require("./verify_source");

function preflight() {
  const required = Object.keys(SOURCE_MANIFEST.expected);
  const missing = required.filter(name => !fs.existsSync(path.join(DATA, name)));
  if (missing.length) {
    return {
      schema: "ekg-source-preflight-v1",
      available: false,
      verified: false,
      data_root: DATA,
      missing,
      clinical_accuracy_claimed: false,
    };
  }
  const result = verify();
  return {
    schema: "ekg-source-preflight-v1",
    available: true,
    verified: result.pass === true,
    data_root: DATA,
    source_files_verified: Object.keys(result.hashes).length,
    clinical_accuracy_claimed: false,
  };
}

if (require.main === module) {
  try {
    const result = preflight();
    console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes("--require") && !result.verified) process.exit(1);
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-source-preflight-v1",
      available: true,
      verified: false,
      error: String(error.message || error),
      clinical_accuracy_claimed: false,
    }, null, 2));
    process.exit(1);
  }
}

module.exports = { preflight };
