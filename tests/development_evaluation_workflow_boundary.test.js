"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { CANDIDATE_CPU_LIMIT, CANDIDATE_LAUNCH_POLICY, CANDIDATE_LAUNCH_POLICY_SHA256, CANDIDATE_MEMORY_LIMIT_BYTES, CANDIDATE_MEMORY_SWAP_LIMIT_BYTES, CANDIDATE_TOTAL_WORKER_BUDGET_MS, CANDIDATE_WORKER_TIMEOUT_MS } = require("../lib/development_candidate_isolation");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "development_evaluation.yml"), "utf8");
const watchdog = fs.readFileSync(path.join(root, ".github", "workflows", "development_evaluation_watchdog.yml"), "utf8");
const runner = fs.readFileSync(path.join(root, "lib", "development_evaluation_runner.js"), "utf8");
const signer = fs.readFileSync(path.join(root, "lib", "development_evaluation_signer.js"), "utf8");
const signerDockerfile = fs.readFileSync(path.join(root, "evaluation", "signer", "Dockerfile"), "utf8");
const candidateDockerfile = fs.readFileSync(path.join(root, "evaluation", "candidate", "Dockerfile"), "utf8");
const candidateWorker = fs.readFileSync(path.join(root, "lib", "development_candidate_worker.js"), "utf8");
const candidateIsolationSchema = JSON.parse(fs.readFileSync(path.join(root, "evaluation", "schemas", "DEVELOPMENT_CANDIDATE_ISOLATION_EVIDENCE_SCHEMA.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const combinedExecutableSurface = `${workflow}\n${runner}\n${signer}`;
const externalActionReferences = source => Array.from(source.matchAll(/uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([^\s]+)/g), match => ({ action: match[1], reference: match[2] }));
const pushPaths = source => {
  const lines = source.split(/\r?\n/);
  const pushIndex = lines.indexOf("  push:");
  const pushEnd = lines.findIndex((line, index) => index > pushIndex && /^  \S/.test(line));
  const pathsIndex = lines.findIndex((line, index) => index > pushIndex && (pushEnd === -1 || index < pushEnd) && line === "    paths:");
  assert.ok(pushIndex >= 0);
  assert.ok(pathsIndex > pushIndex);
  const values = [];
  for (let index = pathsIndex + 1; index < lines.length && lines[index].startsWith("      - "); index += 1) values.push(JSON.parse(lines[index].slice(8)));
  return values;
};
const pathMatches = (pattern, candidate) => {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (pattern[index] === "*") expression += "[^/]*";
    else if (pattern[index] === "?") expression += "[^/]";
    else expression += pattern[index].replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${expression}$`).test(candidate);
};
const workflowActions = externalActionReferences(workflow);
const watchdogActions = externalActionReferences(watchdog);
assert.deepEqual(workflowActions.map(row => row.action), ["actions/checkout", "actions/setup-node", "actions/checkout"]);
assert.deepEqual(watchdogActions.map(row => row.action), ["actions/checkout", "actions/upload-artifact"]);
for (const row of [...workflowActions, ...watchdogActions]) assert.match(row.reference, /^[0-9a-f]{40}$/, `mutable action reference: ${row.action}@${row.reference}`);
const prohibited = ["run_mitbih_rpeak_pilot.py", "run_mitbih_rpeak_full.py", "run_ludb_qrs_v2_dev.py", "run_ludb_qrs_v2_coverage_v2_dev.py", "run_ludb_qrs_v2_coverage_v2_holdout.py", "clinical_accuracy_pilot.yml", "validate:qrs-v2-ludb-train", "validate:qrs-v2-ludb-coverage-v2-train", "validate:qrs-v2-ludb-coverage-v2-holdout"];
for (const value of prohibited) assert.equal(combinedExecutableSurface.includes(value), false, `prohibited executable reference: ${value}`);
assert.match(workflow, /schedule:/);
assert.match(workflow, /push:/);
const configuredPushPaths = pushPaths(workflow);
for (const requiredPath of [
  ".github/workflows/development_evaluation.yml",
  ".github/workflows/development_evaluation_watchdog.yml",
  "tools/run_development_evaluation.js",
  "tools/sign_development_evaluation.js",
  "tools/verify_development_attempt.js",
  "tools/record_development_workflow_attempt.js",
]) assert.ok(configuredPushPaths.some(pattern => pathMatches(pattern, requiredPath)), `push trigger excludes ${requiredPath}`);
const evaluationHarnessTests = Array.from(packageJson.scripts["test:evaluation-harness"].matchAll(/\bnode\s+(tests\/[^\s&]+)/g), match => match[1]);
assert.ok(evaluationHarnessTests.length > 0);
for (const testPath of evaluationHarnessTests) assert.ok(configuredPushPaths.some(pattern => pathMatches(pattern, testPath)), `push trigger excludes ${testPath}`);
const workflowPreamble = workflow.split(/^jobs:\s*$/m)[0];
const fullDevelopmentJob = workflow.split("  full-development:")[1];
assert.equal(/^concurrency:/m.test(workflowPreamble), false);
assert.match(fullDevelopmentJob, /^    concurrency:\r?\n      group: development-ecg-evaluation-full\r?\n      cancel-in-progress: false/m);
assert.match(workflow, /runs-on: \[self-hosted, linux, x64, ecg-development\]/);
assert.match(workflow, /APPLICATION_WRITE_ONCE_SIGNED/);
assert.match(workflow, /manifest-trust-store\.json/);
assert.match(workflow, /partition-index\.json/);
assert.match(workflow, /candidate-manifest\.json/);
assert.match(workflow, /candidate-manifest\.sig\.json/);
assert.match(workflow, /candidate-trust-store\.json/);
assert.match(workflow, /executionInputRoot:'\/execution-input'/);
assert.match(workflow, /Run isolated signal-only candidate evaluation/);
assert.match(workflow, /previousBundleSignerKeyId/);
assert.match(workflow, /environmentImageDigest:process\.env\.EKG_EVALUATION_CANDIDATE_IMAGE\.split/);
assert.match(workflow, /attemptId:'github-'/);
assert.match(workflow, /workflowRunId:process\.env\.GITHUB_RUN_ID/);
assert.match(workflow, /workflowRunAttempt:Number\(process\.env\.GITHUB_RUN_ATTEMPT\)/);
assert.match(workflow, /workflowSha:process\.env\.GITHUB_SHA/);
assert.match(workflow, /engineCommitDigest,engineTreeDigest,worktreeClean:worktreeStatus\.length===0,worktreeStatusSha256/);
assert.equal((workflow.match(/actions\/checkout@[0-9a-f]{40}/g) || []).length, 2);
assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
assert.ok(workflow.indexOf("Build ephemeral run configuration") < workflow.indexOf("Prepare ephemeral signing key"));
assert.match(workflow, /Sign immutable attempt start/);
assert.match(workflow, /Reconcile signed attempt terminal state\n        if: always\(\)/);
assert.match(workflow, /sign_development_evaluation\.js --phase start/);
assert.match(workflow, /sign_development_evaluation\.js --phase finalize/);
assert.equal((workflow.match(/--network none/g) || []).length, 3);
assert.equal((workflow.match(/--read-only/g) || []).length, 3);
assert.equal((workflow.match(/--cap-drop ALL/g) || []).length, 3);
assert.equal((workflow.match(/--security-opt no-new-privileges/g) || []).length, 3);
assert.equal((workflow.match(/--pids-limit 256/g) || []).length, 3);
assert.equal((workflow.match(/--user "\$\(id -u\):\$\(id -g\)"/g) || []).length, 3);
assert.match(workflow, /weekly\?10000:2000/);
assert.match(workflow, /EKG_EVALUATION_CANDIDATE_IMAGE/);
assert.match(workflow, /EKG_EVALUATION_CANDIDATE_IMAGE" \| grep -Eq '@sha256:\[0-9a-f\]\{64\}\$'/);
const candidateStep = workflow.split("      - name: Run isolated signal-only candidate evaluation")[1].split("      - name: Reconcile signed attempt terminal state")[0];
assert.match(candidateStep, /--phase candidate --config \/candidate-config\/ekg-development-candidate\.json --handoff \/handoff\/execution\.json/);
assert.match(candidateStep, /target=\/execution-input,readonly/);
assert.match(candidateStep, /target=\/candidate-config\/ekg-development-candidate\.json,readonly/);
assert.match(candidateStep, /target=\/controls\/candidate-manifest\.json,readonly/);
assert.match(candidateStep, /target=\/controls\/candidate-manifest\.sig\.json,readonly/);
assert.match(candidateStep, /target=\/controls\/candidate-trust-store\.json,readonly/);
assert.match(candidateStep, /--workdir \/opt\/ekg-evaluation-candidate/);
assert.match(candidateStep, /"\$EKG_EVALUATION_CANDIDATE_IMAGE"/);
assert.match(candidateStep, /--cpus 2/);
assert.match(candidateStep, /--memory 2g/);
assert.match(candidateStep, /--memory-swap 2g/);
assert.equal(CANDIDATE_LAUNCH_POLICY.cpuLimit, CANDIDATE_CPU_LIMIT);
assert.equal(CANDIDATE_LAUNCH_POLICY.memoryLimitBytes, CANDIDATE_MEMORY_LIMIT_BYTES);
assert.equal(CANDIDATE_LAUNCH_POLICY.memorySwapLimitBytes, CANDIDATE_MEMORY_SWAP_LIMIT_BYTES);
assert.equal(CANDIDATE_MEMORY_LIMIT_BYTES, 2 * 1024 * 1024 * 1024);
assert.equal(CANDIDATE_MEMORY_SWAP_LIMIT_BYTES, CANDIDATE_MEMORY_LIMIT_BYTES);
for (const forbiddenMount of ["target=/workspace,readonly", "target=/candidate,readonly", "target=/governance,readonly", "target=/corpus,readonly", "target=/artifacts", "target=/runsecrets", "target=/runconfig/"]) assert.equal(candidateStep.includes(forbiddenMount), false, forbiddenMount);
assert.equal(candidateStep.includes("EKG_EVALUATION_SIGNING_KEY"), false);
assert.equal(candidateStep.includes("EKG_PREVIOUS"), false);
assert.equal(CANDIDATE_LAUNCH_POLICY_SHA256.length, 64);
assert.equal(candidateIsolationSchema.$id, "ekg-development-candidate-isolation-evidence-v2");
assert.equal(candidateIsolationSchema.additionalProperties, false);
assert.equal(candidateIsolationSchema.properties.candidateReferenceIsolation.const, false);
assert.equal(candidateStep.includes("EKG_CANDIDATE_RUNTIME_IMAGE_DIGEST"), false);
assert.match(workflow, /candidateExpectedUid:Number\(cp\.execFileSync\('id',\['-u'\]/);
assert.match(workflow, /candidateExpectedGid:Number\(cp\.execFileSync\('id',\['-g'\]/);
assert.match(workflow, /candidateLaunchPolicySha256/);
assert.deepEqual(CANDIDATE_LAUNCH_POLICY.mounts.map(row => row.target), ["/candidate-config/ekg-development-candidate.json", "/execution-input", "/handoff", "/controls/candidate-manifest.json", "/controls/candidate-manifest.sig.json", "/controls/candidate-trust-store.json"]);
for (const mount of CANDIDATE_LAUNCH_POLICY.mounts) assert.ok(candidateStep.includes(`target=${mount.target}`));
const signerStart = workflow.split("      - name: Sign immutable attempt start")[1].split("      - name: Run isolated signal-only candidate evaluation")[0];
const signerFinalize = workflow.split("      - name: Reconcile signed attempt terminal state")[1].split("      - name: Remove ephemeral evaluation inputs")[0];
for (const signerStep of [signerStart, signerFinalize]) {
  assert.match(signerStep, /EKG_EVALUATION_SIGNING_KEY_FILE/);
  assert.match(signerStep, /target=\/artifacts/);
  assert.match(signerStep, /target=\/governance,readonly/);
  assert.match(signerStep, /target=\/corpus,readonly/);
  assert.match(signerStep, /"\$EKG_EVALUATION_SIGNER_IMAGE"/);
  assert.match(signerStep, /target=\/candidate,readonly/);
  assert.match(signerStep, /--workdir \/opt\/ekg-evaluation-signer/);
}
assert.match(signerStart, /target=\/execution-input"/);
assert.match(signerFinalize, /target=\/execution-input,readonly/);
assert.equal(signerStart.includes("target=/workspace"), false);
assert.equal(signerFinalize.includes("target=/workspace"), false);
assert.equal(signerStart.includes("GIT_CONFIG_COUNT"), false);
assert.equal(signerFinalize.includes("GIT_CONFIG_COUNT"), false);
assert.match(workflow, /rm -rf[\s\S]*ekg-candidate-config[\s\S]*ekg-execution-input/);
assert.match(signerDockerfile, /ARG NODE_IMAGE[\s\S]*FROM \$\{NODE_IMAGE\}/);
assert.match(signerDockerfile, /WORKDIR \/opt\/ekg-evaluation-signer/);
assert.match(candidateDockerfile, /ARG NODE_IMAGE[\s\S]*FROM \$\{NODE_IMAGE\}/);
assert.match(candidateDockerfile, /WORKDIR \/opt\/ekg-evaluation-candidate/);
const candidateImageSources = candidateDockerfile.split("\n").filter(line => line.startsWith("COPY ")).map(line => line.split(/\s+/)[1]);
assert.deepEqual(candidateImageSources, [
  "lib/development_candidate_isolation.js",
  "lib/development_candidate_runtime_attestation.js",
  "lib/development_candidate_worker.js",
  "lib/development_evaluation_runner.js",
  "lib/development_execution_handoff.js",
  "lib/development_execution_identity.js",
  "lib/development_execution_input.js",
  "lib/development_run_accounting.js",
  "lib/evaluation_contract.js",
  "lib/evaluation_runtime.js",
  "lib/evaluation_signatures.js",
  "lib/local_dataset_loader.js",
  "lib/pan_tompkins_detector.js",
  "lib/signal_dsp_filtering.js",
  "lib/signal_measurement_contract.js",
  "lib/wfdb_signal.js",
  "tools/run_development_evaluation.js",
  "evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json",
  "evaluation/protocols/DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json",
]);
assert.equal(candidateDockerfile.includes("COPY lib ./lib"), false);
assert.equal(candidateDockerfile.includes("COPY . "), false);
for (const forbidden of [".git", "governance", "corpus", "keys", "manifests", "development_evaluation_signer.js", "rpeak_development_metrics.js", "development_run_comparison.js", "spent_dataset_registry.js"]) assert.equal(candidateDockerfile.includes(forbidden), false, forbidden);
assert.equal(runner.includes("signingPrivateKeyPem"), false);
assert.equal(runner.includes("publishEvaluationBundle"), false);
assert.equal(runner.includes("publishDevelopmentAttempt"), false);
const candidateRuntime = runner.split("function executeDevelopmentCandidate")[1].split("function runDevelopmentEvaluation")[0];
assert.equal(candidateRuntime.includes("loadDevelopmentGovernance"), false);
assert.equal(candidateRuntime.includes("preflightDevelopmentRun"), false);
assert.equal(candidateRuntime.includes("corpusRoot"), false);
assert.match(candidateRuntime, /runCandidateWorker/);
assert.equal(candidateRuntime.includes("execution.detectCandidateRPeaks"), false);
assert.equal(CANDIDATE_LAUNCH_POLICY.candidateWorkerTimeoutMs, CANDIDATE_WORKER_TIMEOUT_MS);
assert.equal(CANDIDATE_LAUNCH_POLICY.candidateTotalWorkerBudgetMs, CANDIDATE_TOTAL_WORKER_BUDGET_MS);
assert.match(runner, /timeout: timeoutMs/);
assert.match(runner, /createCandidateWorkerBudget/);
assert.match(runner, /DEVELOPMENT_CANDIDATE_TOTAL_TIMEOUT/);
assert.match(candidateWorker, /vm\.createContext|loadDevelopmentCandidateExecution/);
assert.equal(candidateWorker.includes("publishEvaluationBundle"), false);
assert.equal(candidateWorker.includes("writeDevelopmentExecutionHandoff"), false);
assert.match(signer, /verifyDevelopmentExecutionPackage/);
assert.match(signer, /createDevelopmentExecutionInput/);
assert.match(signer, /detectPanTompkinsRPeaks/);
assert.equal(signer.includes("loadDevelopmentExecution("), false);
assert.equal(signer.includes("gitIdentity"), false);
assert.match(watchdog, /workflow_run:/);
assert.match(watchdog, /workflows: \["Development ECG evaluation"\]/);
assert.match(watchdog, /types: \[completed\]/);
assert.match(watchdog, /record-source-attempt:[\s\S]*runs-on: ubuntu-latest/);
assert.match(watchdog, /actions\/checkout@[0-9a-f]{40}/);
assert.match(watchdog, /ref: \$\{\{ github\.sha \}\}/);
assert.match(watchdog, /persist-credentials: false/);
assert.match(watchdog, /actions\/runs\/\$SOURCE_RUN_ID\/attempts\/\$SOURCE_RUN_ATTEMPT\/jobs\?per_page=100/);
assert.match(watchdog, /record_development_workflow_attempt\.js/);
assert.match(watchdog, /--observer-run-id "\$OBSERVER_RUN_ID"/);
assert.match(watchdog, /--observer-sha "\$OBSERVER_SHA"/);
assert.match(watchdog, /actions\/upload-artifact@[0-9a-f]{40}/);
assert.match(watchdog, /development-workflow-attempt-\$\{\{ github\.event\.workflow_run\.id \}\}-\$\{\{ github\.event\.workflow_run\.run_attempt \}\}-observer-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
assert.match(watchdog, /printf '\{"total_count":0,"jobs":\[\]\}\\n'/);
assert.match(watchdog, /observationIncomplete/);
assert.match(watchdog, /Upload control-plane attempt receipt[\s\S]*alert-source-attempt/);
assert.match(watchdog, /Development ECG observation incomplete run/);
assert.match(watchdog, /record-source-attempt:[\s\S]*permissions:[\s\S]*actions: read[\s\S]*contents: read/);
assert.match(watchdog, /alert-source-attempt:[\s\S]*permissions:[\s\S]*issues: write/);
assert.equal(watchdog.includes("github.event.workflow_run.head_sha"), false);
assert.match(watchdog, /--event schedule/);
assert.match(watchdog, /--limit 20/);
assert.match(watchdog, /rows\.some/);
assert.match(watchdog, /30\*60\*60\*1000/);
assert.match(watchdog, /issue create/);
for (const secret of ["EKG_EVALUATION_SIGNING_KEY", "EKG_DEVELOPMENT_CORPUS_ROOT", "EKG_DEVELOPMENT_GOVERNANCE_ROOT", "EKG_EVALUATION_ARTIFACT_ROOT"]) assert.equal(watchdog.includes(secret), false, secret);
const observerUsage = childProcess.spawnSync(process.execPath, [path.join(root, "tools", "record_development_workflow_attempt.js")], { encoding: "utf8" });
assert.equal(observerUsage.status, 1);
assert.equal(observerUsage.stderr, "DEVELOPMENT_WORKFLOW_RECEIPT_USAGE\n");
const runnerUsage = childProcess.spawnSync(process.execPath, [path.join(root, "tools", "run_development_evaluation.js")], { encoding: "utf8" });
assert.equal(runnerUsage.status, 1);
assert.equal(runnerUsage.stderr, "DEVELOPMENT_CANDIDATE_USAGE\n");
const legacyRunnerUsage = childProcess.spawnSync(process.execPath, [path.join(root, "tools", "run_development_evaluation.js"), "--config", "legacy.json"], { encoding: "utf8" });
assert.equal(legacyRunnerUsage.status, 1);
assert.equal(legacyRunnerUsage.stderr, "DEVELOPMENT_EVALUATION_SPLIT_REQUIRED\n");
const signerUsage = childProcess.spawnSync(process.execPath, [path.join(root, "tools", "sign_development_evaluation.js")], { encoding: "utf8" });
assert.equal(signerUsage.status, 1);
assert.equal(signerUsage.stderr, "DEVELOPMENT_SIGNER_USAGE\n");
const verifierUsage = childProcess.spawnSync(process.execPath, [path.join(root, "tools", "verify_development_attempt.js")], { encoding: "utf8" });
assert.equal(verifierUsage.status, 1);
assert.equal(verifierUsage.stderr, "DEVELOPMENT_ATTEMPT_VERIFY_USAGE\n");
console.log("development evaluation workflow boundary tests passed");
