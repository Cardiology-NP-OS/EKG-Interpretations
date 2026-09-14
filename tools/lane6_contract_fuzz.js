'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'clinical_control', 'v12_1_candidate', 'source_core');
const load = (name) => JSON.parse(fs.readFileSync(path.join(CORE, name), 'utf8'));

const schema = load('07_OUTPUT_SCHEMA.json');
const patternsDoc = load('23_PATTERN_REGISTRY.json');
const failuresDoc = load('36_FAILURE_MODE_REGISTRY.json');
const sourcesDoc = load('63_SOURCE_REGISTRY.json');
const patterns = patternsDoc.patterns;
const failures = failuresDoc.failure_modes;
const sources = sourcesDoc.sources;
const patternById = new Map(patterns.map((item) => [item.id, item]));

const clone = (value) => structuredClone(value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const unique = (values) => new Set(values).size === values.length;
const asArray = (value) => Array.isArray(value) ? value : [];
let passed = 0;
const failed = [];
const findings = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed.push({ name, detail });
    console.log('FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  return true;
}

function schemaErrors(value, rule, at = '$', errors = []) {
  if (!rule || typeof rule !== 'object') return errors;
  if (Object.prototype.hasOwnProperty.call(rule, 'const') && !Object.is(value, rule.const)) {
    errors.push(at + ': const mismatch');
  }
  if (rule.enum && !rule.enum.some((item) => Object.is(item, value))) {
    errors.push(at + ': enum mismatch');
  }
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some((type) => typeMatches(value, type))) {
      errors.push(at + ': type mismatch');
      return errors;
    }
  }
  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(at + ': minLength');
    if (rule.pattern && !(new RegExp(rule.pattern)).test(value)) errors.push(at + ': pattern');
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (rule.minimum !== undefined && value < rule.minimum) errors.push(at + ': minimum');
    if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum) errors.push(at + ': exclusiveMinimum');
    if (rule.exclusiveMaximum !== undefined && value >= rule.exclusiveMaximum) errors.push(at + ': exclusiveMaximum');
  }
  if (Array.isArray(value)) {
    if (rule.uniqueItems) {
      const encoded = value.map((item) => JSON.stringify(item));
      if (!unique(encoded)) errors.push(at + ': uniqueItems');
    }
    if (rule.items) value.forEach((item, index) => schemaErrors(item, rule.items, at + '[' + index + ']', errors));
  }
  if (isObject(value)) {
    const props = rule.properties || {};
    for (const name of rule.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) errors.push(at + '.' + name + ': required');
    }
    if (rule.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, name)) errors.push(at + '.' + name + ': additional property');
      }
    }
    for (const [name, childRule] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(value, name)) {
        schemaErrors(value[name], childRule, at + '.' + name, errors);
      }
    }
  }
  for (const branch of rule.allOf || []) {
    if (!branch.if) {
      schemaErrors(value, branch, at, errors);
      continue;
    }
    const probe = [];
    schemaErrors(value, branch.if, at, probe);
    if (probe.length === 0 && branch.then) schemaErrors(value, branch.then, at, errors);
    if (probe.length !== 0 && branch.else) schemaErrors(value, branch.else, at, errors);
  }
  return errors;
}

function requiredStringErrors(value, rule, at = '$', errors = []) {
  if (isObject(value)) {
    const props = rule && rule.properties ? rule.properties : {};
    for (const name of (rule && rule.required) || []) {
      if (typeof value[name] === 'string' && value[name].trim() === '') {
        errors.push(at + '.' + name + ': empty required string');
      }
    }
    for (const [name, childRule] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(value, name)) {
        requiredStringErrors(value[name], childRule, at + '.' + name, errors);
      }
    }
  } else if (Array.isArray(value) && rule && rule.items) {
    value.forEach((item, index) => requiredStringErrors(item, rule.items, at + '[' + index + ']', errors));
  }
  return errors;
}

function registryErrors(pd = patternsDoc, fd = failuresDoc, sd = sourcesDoc) {
  const errors = [];
  const ps = pd.patterns || [];
  const fsx = fd.failure_modes || [];
  const ss = sd.sources || [];
  const pids = ps.map((item) => item.id);
  const fids = fsx.map((item) => item.id);
  const skeys = ss.map((item) => item.key);
  const sourceSet = new Set(skeys);
  if (pd.version !== '5.0') errors.push('pattern registry version');
  if (fd.version !== '3.0') errors.push('failure registry version');
  if (sd.version !== '2.0') errors.push('source registry version');
  if (pd.snapshot_date !== sd.snapshot_date) errors.push('registry snapshot mismatch');
  if (pd.source_registry !== '63_SOURCE_REGISTRY.json') errors.push('source registry filename mismatch');
  if (!unique(pids)) errors.push('duplicate pattern id');
  if (!unique(fids)) errors.push('duplicate failure id');
  if (!unique(skeys)) errors.push('duplicate source key');
  for (const item of ps) {
    if (!Array.isArray(item.source_keys) || item.source_keys.length === 0) errors.push('pattern without source key: ' + item.id);
    for (const key of item.source_keys || []) if (!sourceSet.has(key)) errors.push('unsupported source key: ' + key);
  }
  return errors;
}

function makeFixture() {
  return {
    schema_version: '3.1',
    analysis_metadata: {
      project_version: '12.0',
      criteria_snapshot: patternsDoc.snapshot_date,
      source_registry_version: sourcesDoc.version,
      analysis_mode: 'general'
    },
    input: { tracing_type: 'unknown', population: 'unknown' },
    technical_quality: { grade: 'cannot_interpret', limitations: ['synthetic lane-6 fixture'] },
    urgency: {
      level: 'educational_only',
      reason: 'synthetic fixture',
      uncertainty: 'intentionally non-clinical'
    },
    measurements: [],
    rhythm: {
      finding: 'synthetic placeholder',
      confidence: 'low',
      regularity: 'unknown',
      atrial_activity: 'not asserted',
      av_relationship: 'not asserted',
      evidence: ['synthetic fixture'],
      contradictions: []
    },
    lead_observations: [],
    st_t_assessment: {
      ischemia_concern: 'indeterminate',
      occlusion_pattern_concern: 'indeterminate',
      conventional_st_elevation_threshold: 'not_assessable',
      patterns_considered: [],
      mimics_or_confounders: [],
      evidence: [],
      contradictions: []
    },
    interpretation: {
      primary_pattern: {
        label: 'synthetic non-diagnostic placeholder',
        confidence: 'low',
        evidence_for: ['synthetic fixture'],
        evidence_against: [],
        pattern_id: null
      },
      secondary_findings: [],
      differential: [],
      contradiction_summary: []
    },
    limitations: ['synthetic fuzz fixture only'],
    verification: ['not for clinical use']
  };
}

function makeMeasurementEvidence(id, calibrationId = null) {
  return {
    version: '1.0',
    measurement_id: id,
    metric: 'other',
    lead: null,
    value: null,
    unit: null,
    source_kind: 'unavailable',
    method: 'unavailable',
    calibration_id: calibrationId,
    fiducials: [],
    uncertainty: { lower: null, upper: null, unit: null, method: 'not_available' },
    exact_numeric_claim_allowed: false,
    evidence_source: { asset_id: null, asset_sha256: null }
  };
}

const validLeads = new Set(schema.properties.lead_observations.items.properties.lead.enum);

function deepErrors(output) {
  const errors = schemaErrors(output, schema);
  requiredStringErrors(output, schema, '$', errors);
  const md = output.analysis_metadata || {};
  if (md.criteria_snapshot !== patternsDoc.snapshot_date || md.criteria_snapshot !== sourcesDoc.snapshot_date) {
    errors.push('criteria/source snapshot mismatch');
  }
  if (md.source_registry_version !== sourcesDoc.version) errors.push('stale source registry version');

  const primary = output.interpretation && output.interpretation.primary_pattern;
  if (primary && primary.pattern_id !== null && primary.pattern_id !== undefined) {
    const item = patternById.get(primary.pattern_id);
    if (!item) errors.push('unsupported primary pattern id');
    else {
      if (primary.label !== item.label) errors.push('primary label/pattern id mismatch');
      if (item.must_name_supporting_leads_when_regional && (!output.lead_observations || output.lead_observations.length === 0)) {
        errors.push('regional pattern missing supporting leads');
      }
    }
  }
  for (const diff of asArray(output.interpretation && output.interpretation.differential)) {
    if (diff.pattern_id !== null && diff.pattern_id !== undefined) {
      const item = patternById.get(diff.pattern_id);
      if (!item) errors.push('unsupported differential pattern id');
      else if (diff.label !== item.label) errors.push('differential label/pattern id mismatch');
    }
  }

  for (const m of asArray(output.measurements)) {
    if (m.lead !== null && m.lead !== undefined && !validLeads.has(m.lead)) errors.push('invalid measurement lead');
  }
  for (const e of asArray(output.measurement_evidence)) {
    if (e.lead !== null && e.lead !== undefined && !validLeads.has(e.lead)) errors.push('invalid evidence lead');
  }

  const evidence = asArray(output.measurement_evidence);
  const evidenceIds = evidence.map((item) => item.measurement_id);
  if (!unique(evidenceIds)) errors.push('duplicate measurement evidence id');
  const evidenceSet = new Set(evidenceIds);
  for (const m of asArray(output.measurements)) {
    if (m.measurement_evidence_ref && !evidenceSet.has(m.measurement_evidence_ref)) errors.push('missing measurement evidence reference');
  }
  for (const obs of asArray(output.lead_observations)) {
    if (obs.measurement_evidence_ref && !evidenceSet.has(obs.measurement_evidence_ref)) errors.push('missing lead evidence reference');
  }

  const calibrations = asArray(output.geometry_calibrations);
  const calibrationIds = calibrations.map((item) => item.calibration_id);
  if (!unique(calibrationIds)) errors.push('duplicate calibration id');
  const calibrationById = new Map(calibrations.map((item) => [item.calibration_id, item]));
  for (const e of evidence) {
    if (e.calibration_id && !calibrationById.has(e.calibration_id)) errors.push('missing calibration reference');
    if (e.source_kind === 'visual_fiducial' && e.exact_numeric_claim_allowed) {
      const c = e.calibration_id ? calibrationById.get(e.calibration_id) : null;
      if (!c) errors.push('F10 exact visual measurement without calibration');
      else if (c.geometry_state === 'unknown' || c.geometry_state === 'perspective_uncorrected') {
        errors.push('F10 exact visual measurement with unsafe geometry');
      }
    }
  }

  if (!Array.isArray(output.limitations) || output.limitations.length === 0) errors.push('limitations must be explicit');
  if (output.technical_quality && output.technical_quality.grade !== 'adequate' &&
      output.technical_quality.limitations && output.technical_quality.limitations.length === 0) {
    errors.push('non-adequate quality missing technical limitation');
  }

  const contradictions = []
    .concat((output.rhythm && output.rhythm.contradictions) || [])
    .concat((output.st_t_assessment && output.st_t_assessment.contradictions) || [])
    .concat((primary && primary.evidence_against) || [])
    .concat((output.interpretation && output.interpretation.contradiction_summary) || []);
  if (primary && primary.confidence === 'high' && contradictions.length > 0) {
    errors.push('F30 high confidence with unresolved contradiction');
  }
  if (primary && output.technical_quality && output.technical_quality.grade === 'cannot_interpret' &&
      primary.confidence !== 'low') {
    errors.push('certainty despite failed technical prerequisite');
  }

  const layout = output.lead_layout;
  if (layout) {
    if (layout.status === 'verified' && !layout.labels_verified) errors.push('verified layout without verified labels');
    if (layout.specific_lead_claims_allowed && (layout.status !== 'verified' || !layout.labels_verified)) {
      errors.push('specific lead claims allowed despite ambiguous labels');
    }
    if ((!layout.labels_verified || layout.status === 'ambiguous' || !layout.specific_lead_claims_allowed) &&
        (output.lead_observations || []).length > 0) {
      errors.push('F09 specific lead observations despite unverified layout');
    }
  }

  const binding = output.serial_binding;
  if (binding) {
    if (binding.comparison_scope === 'not_allowed' && binding.temporal_change_language_allowed) {
      errors.push('temporal change allowed while comparison not allowed');
    }
    if ((binding.state === 'different_family' || binding.state === 'identity_unknown') &&
        binding.comparison_scope === 'patient_serial') {
      errors.push('patient serial scope without verified identity');
    }
    if (!binding.temporal_change_language_allowed && Array.isArray(output.serial_comparison) &&
        output.serial_comparison.length > 0) {
      errors.push('F11 temporal comparison emitted while disallowed');
    }
  }
  return errors;
}

function expectOutputReject(name, mutate, shouldBypassShallow = false) {
  const candidate = makeFixture();
  mutate(candidate);
  const shallow = schemaErrors(candidate, schema);
  const deep = deepErrors(candidate);
  check(name, deep.length > 0, { shallow, deep });
  if (shouldBypassShallow) check(name + '_bypasses_shallow', shallow.length === 0, shallow);
}

function expectRegistryReject(name, mutate) {
  const pd = clone(patternsDoc);
  const fd = clone(failuresDoc);
  const sd = clone(sourcesDoc);
  mutate(pd, fd, sd);
  const errors = registryErrors(pd, fd, sd);
  check(name, errors.length > 0, errors);
}

function setPath(target, parts, value) {
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]];
  cursor[parts[parts.length - 1]] = value;
}

function deletePath(target, parts) {
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]];
  delete cursor[parts[parts.length - 1]];
}

check('baseline_registry_contract', registryErrors().length === 0, registryErrors());
const baselineErrors = deepErrors(makeFixture());
check('baseline_fixture_valid', baselineErrors.length === 0, baselineErrors);

expectOutputReject('missing_required_field', (x) => deletePath(x, ['urgency']));
expectOutputReject('null_required_field', (x) => setPath(x, ['rhythm'], null));
expectOutputReject('empty_required_string', (x) => setPath(x, ['urgency', 'reason'], ''));
expectOutputReject('extra_unsupported_field', (x) => { x.ready = true; });
expectOutputReject('invalid_enum', (x) => setPath(x, ['analysis_metadata', 'analysis_mode'], 'invalid'));
expectOutputReject('invalid_type', (x) => setPath(x, ['measurements'], {}));
expectOutputReject('wrong_schema_version', (x) => { x.schema_version = '999'; });
expectOutputReject('stale_registry_version', (x) => { x.analysis_metadata.source_registry_version = '1.0'; });
expectOutputReject('stale_criteria_snapshot', (x) => { x.analysis_metadata.criteria_snapshot = '2000-01-01'; });
expectOutputReject('unsupported_pattern_id', (x) => {
  x.interpretation.primary_pattern.pattern_id = 'not_a_registered_pattern';
}, true);
expectOutputReject('invalid_measurement_lead', (x) => {
  x.measurements.push({ name: 'other', value: null, unit: null, source: 'unavailable', confidence: 'low', lead: 'NOT_A_LEAD' });
}, true);
expectOutputReject('missing_limitations', (x) => delete x.limitations);
expectOutputReject('absent_contradiction_summary', (x) => delete x.interpretation.contradiction_summary);
expectOutputReject('nan_measurement', (x) => {
  x.measurements.push({ name: 'other', value: NaN, unit: null, source: 'user', confidence: 'low' });
});
expectOutputReject('positive_infinity_measurement', (x) => {
  x.measurements.push({ name: 'other', value: Infinity, unit: null, source: 'user', confidence: 'low' });
});
expectOutputReject('negative_infinity_measurement', (x) => {
  x.measurements.push({ name: 'other', value: -Infinity, unit: null, source: 'user', confidence: 'low' });
});
expectOutputReject('certainty_failed_prerequisite', (x) => {
  x.interpretation.primary_pattern.confidence = 'high';
}, true);
expectOutputReject('high_confidence_with_contradiction', (x) => {
  x.interpretation.primary_pattern.confidence = 'high';
  x.interpretation.primary_pattern.evidence_against = ['synthetic contradiction'];
}, true);
expectOutputReject('lead_layout_impossible_state', (x) => {
  x.lead_layout = { layout_type: 'unknown', labels_verified: false, status: 'verified', specific_lead_claims_allowed: true };
}, true);
expectOutputReject('lead_label_guessing', (x) => {
  x.lead_layout = { layout_type: 'unknown', labels_verified: false, status: 'ambiguous', specific_lead_claims_allowed: false };
  x.lead_observations = [{ lead: 'I', observations: ['synthetic'], source: 'visual', confidence: 'low' }];
}, true);
expectOutputReject('serial_identity_impossible_state', (x) => {
  x.serial_binding = {
    state: 'identity_unknown', comparison_scope: 'patient_serial', evidence_source: 'none',
    temporal_change_language_allowed: true, reason: 'synthetic'
  };
}, true);
expectOutputReject('missing_measurement_evidence_ref', (x) => {
  x.measurements.push({
    name: 'other', value: null, unit: null, source: 'unavailable', confidence: 'low',
    measurement_evidence_ref: 'missing'
  });
}, true);
expectOutputReject('duplicate_measurement_evidence_id', (x) => {
  x.measurement_evidence = [makeMeasurementEvidence('m1'), makeMeasurementEvidence('m1')];
}, true);
expectOutputReject('missing_calibration_ref', (x) => {
  x.measurement_evidence = [makeMeasurementEvidence('m1', 'missing-calibration')];
}, true);
expectOutputReject('missing_required_supporting_leads', (x) => {
  x.interpretation.primary_pattern.pattern_id = 'first_degree_av_delay';
  x.interpretation.primary_pattern.label = 'First-degree AV delay';
}, true);
expectOutputReject('malformed_measurement_evidence_array', (x) => {
  x.measurement_evidence = { measurement_id: 'not-an-array' };
});
expectOutputReject('malformed_primary_evidence_array', (x) => {
  x.interpretation.primary_pattern.evidence_for = { text: 'not-an-array' };
});
expectOutputReject('false_pass_flag', (x) => { x.pass = true; });
expectOutputReject('false_ready_flag', (x) => { x.ready_for_clinical_use = true; });

expectRegistryReject('duplicate_pattern_ids', (pd) => { pd.patterns[1].id = pd.patterns[0].id; });
expectRegistryReject('duplicate_source_keys', (pd, fd, sd) => { sd.sources[1].key = sd.sources[0].key; });
expectRegistryReject('unsupported_source_key', (pd) => { pd.patterns[0].source_keys.push('not_registered'); });
expectRegistryReject('stale_pattern_registry_version', (pd) => { pd.version = '4.0'; });
expectRegistryReject('stale_failure_registry_version', (pd, fd) => { fd.version = '2.0'; });
expectRegistryReject('stale_source_registry_version', (pd, fd, sd) => { sd.version = '1.0'; });
expectRegistryReject('malformed_registry_timestamp', (pd) => { pd.snapshot_date = 'not-a-date'; });

let seed = 0x6c06f00d;
function randomIndex(max) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) % max;
}

const fuzzMutators = [
  (x) => { x.schema_version = String(randomIndex(1000)); },
  (x) => { x.analysis_metadata.analysis_mode = 'bad_' + randomIndex(1000); },
  (x) => { x.measurements = { fuzz: randomIndex(1000) }; },
  (x) => { x.urgency.level = 'bad_' + randomIndex(1000); },
  (x) => { delete x.technical_quality.grade; },
  (x) => { x.interpretation.primary_pattern.confidence = 'high'; },
  (x) => { x.measurements.push({ name: 'other', value: Infinity, unit: null, source: 'user', confidence: 'low' }); }
];

const fuzzMisses = [];
for (let i = 0; i < 64; i += 1) {
  const candidate = makeFixture();
  fuzzMutators[randomIndex(fuzzMutators.length)](candidate);
  if (deepErrors(candidate).length === 0) fuzzMisses.push(i);
}
check('seeded_fuzz_64_cases_rejected', fuzzMisses.length === 0, fuzzMisses);

const extreme = makeFixture();
extreme.measurements.push({ name: 'other', value: Number.MAX_VALUE, unit: null, source: 'user', confidence: 'low' });
if (deepErrors(extreme).length === 0) {
  findings.push('Finite extreme measurement values remain structurally unbounded; no medical cutoff was invented by this lane.');
}

function collectUnboundedNumberPaths(rule, at = '$', out = []) {
  if (!rule || typeof rule !== 'object') return out;
  const types = Array.isArray(rule.type) ? rule.type : [rule.type];
  if (types.includes('number') && rule.maximum === undefined && rule.exclusiveMaximum === undefined) out.push(at);
  for (const [name, child] of Object.entries(rule.properties || {})) collectUnboundedNumberPaths(child, at + '.' + name, out);
  if (rule.items) collectUnboundedNumberPaths(rule.items, at + '[]', out);
  for (const branch of rule.allOf || []) {
    if (branch.then) collectUnboundedNumberPaths(branch.then, at + '.then', out);
    if (branch.else) collectUnboundedNumberPaths(branch.else, at + '.else', out);
  }
  return out;
}

const unboundedNumberPaths = [...new Set(collectUnboundedNumberPaths(schema))];
findings.push('Schema numeric fields without explicit upper bound: ' + unboundedNumberPaths.length);

const result = {
  schema: 'ekg-lane6-contract-fuzz-v1',
  pass: failed.length === 0,
  passed,
  failed,
  findings,
  seed: '0x6c06f00d',
  seeded_cases: 64,
  pattern_count: patterns.length,
  failure_mode_count: failures.length,
  source_count: sources.length,
  candidate_active: false
};
console.log(JSON.stringify(result));
if (failed.length) process.exit(1);
