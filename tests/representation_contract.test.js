"use strict";

const assert = require("assert");
const {
  REPRESENTATION_GOVERNANCE,
  validateRepresentationSpec,
} = require("../lib/representation_contract");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error}`);
    process.exitCode = 1;
  }
}

function rvqSpec(overrides = {}) {
  return {
    representationId: "synthetic-rvq-v1",
    representationType: "RESIDUAL_VQ",
    axis: {
      semantic: "TIME",
      source: "EXPLICIT_CONFIG",
      positionCount: 82,
      featureDimension: 128,
    },
    residualQuantization: {
      enabled: true,
      codebookCount: 8,
      reconstructionSemantics: "ADDITIVE_CODEBOOK_SUM",
      fusionStrategy: "CONCAT_LINEAR_IDENTITY_SUM_INIT",
    },
    bridge: {
      consumedAxisSemantic: "TIME",
      positionCount: 82,
      structuralConfigBoundToCheckpoint: true,
    },
    runtimeAuthority: false,
    clinicalValidityInferred: false,
    ...overrides,
  };
}

test("representation governance remains nonruntime and nonclinical", () => {
  assert.strictEqual(REPRESENTATION_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(REPRESENTATION_GOVERNANCE.metrics, "NOT_REPORTABLE");
  assert.strictEqual(REPRESENTATION_GOVERNANCE.activation, "NOT_ELIGIBLE");
});

test("explicit time-axis additive RVQ representation validates", () => {
  const out = validateRepresentationSpec(rvqSpec());
  assert.strictEqual(out.pass, true);
  assert.strictEqual(out.axis.semantic, "TIME");
  assert.strictEqual(out.residualQuantization.codebookCount, 8);
  assert.strictEqual(out.bridge.consumedAxisSemantic, "TIME");
});

test("residual VQ must declare additive reconstruction", () => {
  const spec = rvqSpec();
  spec.residualQuantization.reconstructionSemantics = "CONVEX_AVERAGE";
  assert.throws(
    () => validateRepresentationSpec(spec),
    /REPRESENTATION_RVQ_MUST_RECONSTRUCT_ADDITIVELY/,
  );
});

test("convex softmax fusion across residual codebooks fails closed", () => {
  const spec = rvqSpec();
  spec.residualQuantization.fusionStrategy = "SOFTMAX_CONVEX";
  assert.throws(
    () => validateRepresentationSpec(spec),
    /REPRESENTATION_RVQ_NONADDITIVE_FUSION_REJECTED/,
  );
});

test("token axis must come from explicit configuration", () => {
  const spec = rvqSpec();
  spec.axis.source = "INFERRED_FROM_SHAPE";
  assert.throws(
    () => validateRepresentationSpec(spec),
    /REPRESENTATION_AXIS_MUST_BE_EXPLICIT/,
  );
});

test("bridge cannot silently consume channels when representation axis is time", () => {
  const spec = rvqSpec();
  spec.bridge.consumedAxisSemantic = "CHANNEL";
  assert.throws(
    () => validateRepresentationSpec(spec),
    /REPRESENTATION_BRIDGE_AXIS_MISMATCH/,
  );
});

test("bridge position count must match the declared token axis", () => {
  const spec = rvqSpec();
  spec.bridge.positionCount = 128;
  assert.throws(
    () => validateRepresentationSpec(spec),
    /REPRESENTATION_BRIDGE_POSITION_COUNT_MISMATCH/,
  );
});

test("bridge structure must be checkpoint-bound", () => {
  const spec = rvqSpec();
  spec.bridge.structuralConfigBoundToCheckpoint = false;
  assert.throws(
    () => validateRepresentationSpec(spec),
    /REPRESENTATION_BRIDGE_CHECKPOINT_BINDING_REQUIRED/,
  );
});

test("runtime or clinical authority cannot be smuggled through the contract", () => {
  assert.throws(
    () => validateRepresentationSpec(rvqSpec({ runtimeAuthority: true })),
    /REPRESENTATION_RUNTIME_AUTHORITY_FORBIDDEN/,
  );
  assert.throws(
    () => validateRepresentationSpec(rvqSpec({ clinicalValidityInferred: true })),
    /REPRESENTATION_CLINICAL_VALIDITY_FORBIDDEN/,
  );
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-representation-semantics-tests-v1",
  pass: true,
  passed,
  total: passed,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  clinicalAuthorityAdded: false,
}));
