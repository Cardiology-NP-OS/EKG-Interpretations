"use strict";

const REPRESENTATION_GOVERNANCE = Object.freeze({
  authorityClass: "EVALUATION_NONRUNTIME",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

const AXIS_SEMANTICS = new Set(["TIME", "CHANNEL", "LEAD", "FEATURE", "NONE"]);
const RESIDUAL_FUSION_STRATEGIES = new Set([
  "ADDITIVE_SUM",
  "CONCAT_LINEAR_IDENTITY_SUM_INIT",
]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function text(value, code) {
  requireCondition(typeof value === "string" && value.trim().length > 0, code);
  return value.trim();
}

function positiveInteger(value, code) {
  requireCondition(Number.isInteger(value) && value > 0, code);
  return value;
}

function validateAxisDescriptor(axis) {
  requireCondition(plain(axis), "REPRESENTATION_AXIS_REQUIRED");
  const semantic = text(axis.semantic, "REPRESENTATION_AXIS_SEMANTIC");
  requireCondition(AXIS_SEMANTICS.has(semantic), "REPRESENTATION_AXIS_SEMANTIC_UNSUPPORTED");
  const source = text(axis.source, "REPRESENTATION_AXIS_SOURCE");
  requireCondition(source === "EXPLICIT_CONFIG", "REPRESENTATION_AXIS_MUST_BE_EXPLICIT");
  if (semantic === "NONE") {
    requireCondition(axis.positionCount === null, "REPRESENTATION_AXIS_POSITION_COUNT");
    requireCondition(axis.featureDimension === null, "REPRESENTATION_AXIS_FEATURE_DIMENSION");
    return { semantic, source, positionCount: null, featureDimension: null };
  }
  return {
    semantic,
    source,
    positionCount: positiveInteger(axis.positionCount, "REPRESENTATION_AXIS_POSITION_COUNT"),
    featureDimension: positiveInteger(axis.featureDimension, "REPRESENTATION_AXIS_FEATURE_DIMENSION"),
  };
}

function validateResidualQuantization(value) {
  requireCondition(plain(value), "REPRESENTATION_RVQ_REQUIRED");
  requireCondition(value.enabled === true, "REPRESENTATION_RVQ_ENABLED");
  const codebookCount = positiveInteger(value.codebookCount, "REPRESENTATION_RVQ_CODEBOOK_COUNT");
  requireCondition(
    value.reconstructionSemantics === "ADDITIVE_CODEBOOK_SUM",
    "REPRESENTATION_RVQ_MUST_RECONSTRUCT_ADDITIVELY",
  );
  const fusionStrategy = text(value.fusionStrategy, "REPRESENTATION_RVQ_FUSION_STRATEGY");
  requireCondition(
    RESIDUAL_FUSION_STRATEGIES.has(fusionStrategy),
    "REPRESENTATION_RVQ_NONADDITIVE_FUSION_REJECTED",
  );
  return {
    enabled: true,
    codebookCount,
    reconstructionSemantics: "ADDITIVE_CODEBOOK_SUM",
    fusionStrategy,
  };
}

function validateBridgeBinding(value, axis) {
  if (value === null || value === undefined) return null;
  requireCondition(plain(value), "REPRESENTATION_BRIDGE_REQUIRED");
  const consumedAxisSemantic = text(
    value.consumedAxisSemantic,
    "REPRESENTATION_BRIDGE_AXIS_SEMANTIC",
  );
  requireCondition(
    AXIS_SEMANTICS.has(consumedAxisSemantic) && consumedAxisSemantic !== "NONE",
    "REPRESENTATION_BRIDGE_AXIS_SEMANTIC_UNSUPPORTED",
  );
  requireCondition(
    consumedAxisSemantic === axis.semantic,
    "REPRESENTATION_BRIDGE_AXIS_MISMATCH",
  );
  requireCondition(
    positiveInteger(value.positionCount, "REPRESENTATION_BRIDGE_POSITION_COUNT") === axis.positionCount,
    "REPRESENTATION_BRIDGE_POSITION_COUNT_MISMATCH",
  );
  requireCondition(
    value.structuralConfigBoundToCheckpoint === true,
    "REPRESENTATION_BRIDGE_CHECKPOINT_BINDING_REQUIRED",
  );
  return {
    consumedAxisSemantic,
    positionCount: value.positionCount,
    structuralConfigBoundToCheckpoint: true,
  };
}

function validateRepresentationSpec(spec) {
  requireCondition(plain(spec), "REPRESENTATION_SPEC_REQUIRED");
  const representationId = text(spec.representationId, "REPRESENTATION_ID_REQUIRED");
  requireCondition(
    /^[A-Za-z0-9._:-]{3,160}$/.test(representationId),
    "REPRESENTATION_ID_FORMAT",
  );
  const representationType = text(spec.representationType, "REPRESENTATION_TYPE_REQUIRED");
  requireCondition(
    ["RESIDUAL_VQ", "CONTINUOUS_SEQUENCE", "DISCRETE_SEQUENCE"].includes(representationType),
    "REPRESENTATION_TYPE_UNSUPPORTED",
  );
  const axis = validateAxisDescriptor(spec.axis);

  let residualQuantization = null;
  if (representationType === "RESIDUAL_VQ") {
    residualQuantization = validateResidualQuantization(spec.residualQuantization);
  } else {
    requireCondition(
      spec.residualQuantization === null || spec.residualQuantization === undefined,
      "REPRESENTATION_RVQ_UNEXPECTED",
    );
  }

  const bridge = validateBridgeBinding(spec.bridge, axis);
  requireCondition(
    spec.runtimeAuthority === false,
    "REPRESENTATION_RUNTIME_AUTHORITY_FORBIDDEN",
  );
  requireCondition(
    spec.clinicalValidityInferred === false,
    "REPRESENTATION_CLINICAL_VALIDITY_FORBIDDEN",
  );

  return {
    schema: "ekg-representation-semantics-receipt-v1",
    pass: true,
    representationId,
    representationType,
    axis,
    residualQuantization,
    bridge,
    ...REPRESENTATION_GOVERNANCE,
  };
}

module.exports = {
  AXIS_SEMANTICS,
  REPRESENTATION_GOVERNANCE,
  RESIDUAL_FUSION_STRATEGIES,
  validateAxisDescriptor,
  validateBridgeBinding,
  validateRepresentationSpec,
  validateResidualQuantization,
};
