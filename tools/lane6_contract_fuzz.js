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
const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
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
  if (!isIsoDate(pd.snapshot_date)) errors.push('invalid pattern registry snapshot date');
  if (!isIsoDate(sd.snapshot_date)) errors.push('invalid source registry snapshot date');
  if (pd.source_registry !== '63_SOURCE_REGISTRY.json') errors.push('source registry filename mismatch');
  if (!unique(pids)) errors.push('duplicate pattern id');
  if (!unique(fids)) errors.push('duplicate failure id');
  if (!unique(skeys)) errors.push('duplicate source key');
  if (pids.some((id) => typeof id !== 'string' || id.trim() === '')) errors.push('blank pattern id');
  if (fids.some((id) => typeof id !== 'string' || id.trim() === '')) errors.push('blank failure id');
  if (skeys.some((key) => typeof key !== 'string' || key.trim() === '')) errors.push('blank source key');
  for (const item of ps) {
    if (!Array.isArray(item.source_keys) || item.source_keys.length === 0) errors.push('pattern without source key: ' + item.id);
    if (Array.isArray(item.source_keys) && !unique(item.source_keys)) errors.push('duplicate pattern source key: ' + item.id);
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
  if (output.input && output.input.tracing_type === 'rhythm_strip' && output.axis !== undefined && output.axis !== null) {
    errors.push('rhythm strip contains unsupported axis assessment');
  }
  if (md.analysis_mode === 'perioperative' && !isObject(output.perioperative_lens)) {
    errors.push('perioperative mode missing appended perioperative lens');
  }

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
    if (output.technical_quality && output.technical_quality.grade === 'cannot_interpret' &&
        typeof m.value === 'number' && Number.isFinite(m.value) && (m.source === 'estimated' || m.source === 'calculated')) {
      errors.push('model-derived exact measurement despite cannot_interpret');
    }
    if (m.name === 'qtc' && m.source === 'calculated' && (typeof m.formula !== 'string' || m.formula.trim() === '')) {
      errors.push('calculated QTc missing formula');
    }
  }
  for (const e of asArray(output.measurement_evidence)) {
    if (e.lead !== null && e.lead !== undefined && !validLeads.has(e.lead)) errors.push('invalid evidence lead');
  }

  const evidence = asArray(output.measurement_evidence);
  const evidenceIds = evidence.map((item) => item.measurement_id);
  if (!unique(evidenceIds)) errors.push('duplicate measurement evidence id');
  const evidenceSet = new Set(evidenceIds);
  const evidenceById = new Map(evidence.map((item) => [item.measurement_id, item]));
  for (const m of asArray(output.measurements)) {
    if (m.measurement_evidence_ref) {
      if (!evidenceSet.has(m.measurement_evidence_ref)) errors.push('missing measurement evidence reference');
      else {
        const e = evidenceById.get(m.measurement_evidence_ref);
        if (e.metric !== m.name) errors.push('measurement/evidence metric mismatch');
        if (!Object.is(e.value, m.value)) errors.push('measurement/evidence value mismatch');
        if (!Object.is(e.unit, m.unit)) errors.push('measurement/evidence unit mismatch');
        if (m.lead !== undefined && m.lead !== null && e.lead !== m.lead) errors.push('measurement/evidence lead mismatch');
        const expectedEvidenceSource = {
          user: 'user_provided', machine: 'machine_reported',
          calculated: 'calculated', unavailable: 'unavailable'
        }[m.source];
        if (expectedEvidenceSource && e.source_kind !== expectedEvidenceSource) {
          errors.push('measurement/evidence source mismatch');
        }
      }
    }
  }
  for (const obs of asArray(output.lead_observations)) {
    if (obs.measurement_evidence_ref) {
      if (!evidenceSet.has(obs.measurement_evidence_ref)) errors.push('missing lead evidence reference');
      else {
        const e = evidenceById.get(obs.measurement_evidence_ref);
        if (e.lead !== null && e.lead !== undefined && e.lead !== obs.lead) errors.push('lead observation/evidence lead mismatch');
        const compatibleEvidenceSources = {
          user: ['user_provided'], machine: ['machine_reported'],
          calculated: ['calculated'], visual: ['visual_fiducial'],
          mixed: ['visual_fiducial', 'user_provided', 'machine_reported', 'calculated', 'digital_signal']
        }[obs.source];
        if (compatibleEvidenceSources && !compatibleEvidenceSources.includes(e.source_kind)) errors.push('lead observation/evidence source mismatch');
      }
    }
    const labelsExplicitlyHidden = output.technical_quality && output.technical_quality.lead_labels_visible === false;
    const layoutEstablishesIdentity = output.lead_layout && output.lead_layout.status === 'verified' &&
      output.lead_layout.labels_verified === true && output.lead_layout.specific_lead_claims_allowed === true;
    if (labelsExplicitlyHidden && !layoutEstablishesIdentity && (obs.source === 'visual' || obs.source === 'mixed')) {
      errors.push('named visual lead claim without established lead identity');
    }
  }

  const calibrations = asArray(output.geometry_calibrations);
  const calibrationIds = calibrations.map((item) => item.calibration_id);
  if (!unique(calibrationIds)) errors.push('duplicate calibration id');
  const calibrationById = new Map(calibrations.map((item) => [item.calibration_id, item]));
  for (const e of evidence) {
    const assetIdPresent = typeof e.evidence_source?.asset_id === 'string' && e.evidence_source.asset_id.length > 0;
    const assetHashPresent = typeof e.evidence_source?.asset_sha256 === 'string' && e.evidence_source.asset_sha256.length > 0;
    if (assetIdPresent !== assetHashPresent) errors.push('partial evidence source asset identity');
    if (e.calibration_id && !calibrationById.has(e.calibration_id)) errors.push('missing calibration reference');
    if (e.source_kind === 'visual_fiducial' && e.exact_numeric_claim_allowed) {
      const c = e.calibration_id ? calibrationById.get(e.calibration_id) : null;
      if (!c) errors.push('F10 exact visual measurement without calibration');
      else {
        if (c.geometry_state === 'unknown' || c.geometry_state === 'perspective_uncorrected') {
          errors.push('F10 exact visual measurement with unsafe geometry');
        }
        if (!c.exact_time_measurement_allowed && !c.exact_voltage_measurement_allowed) {
          errors.push('F10 exact visual measurement despite calibration disallowing exact measurement');
        }
      }
      if (!Array.isArray(e.fiducials) || e.fiducials.length === 0) {
        errors.push('F10 exact visual measurement missing fiducials');
      }
    }
    const expectedMethodBySource = {
      visual_fiducial: ['manual_fiducial', 'automated_fiducial_unvalidated'],
      digital_signal: ['digital_sample'], machine_reported: ['machine_printout'],
      user_provided: ['user_input'], calculated: ['formula'], unavailable: ['unavailable']
    };
    if (expectedMethodBySource[e.source_kind] && !expectedMethodBySource[e.source_kind].includes(e.method)) {
      errors.push('measurement evidence source/method mismatch');
    }
    if (e.source_kind === 'unavailable' && (e.value !== null || e.calibration_id !== null ||
        asArray(e.fiducials).length > 0 || e.exact_numeric_claim_allowed)) {
      errors.push('unavailable measurement evidence carries asserted measurement state');
    }
    if (e.uncertainty) {
      const lowerPresent = typeof e.uncertainty.lower === 'number' && Number.isFinite(e.uncertainty.lower);
      const upperPresent = typeof e.uncertainty.upper === 'number' && Number.isFinite(e.uncertainty.upper);
      if (lowerPresent !== upperPresent) errors.push('measurement uncertainty interval partially populated');
      if (lowerPresent && upperPresent && e.uncertainty.lower > e.uncertainty.upper) {
        errors.push('measurement uncertainty interval reversed');
      }
      if (lowerPresent && upperPresent && !Object.is(e.uncertainty.unit, e.unit)) {
        errors.push('measurement uncertainty unit mismatch');
      }
      if (e.uncertainty.method === 'not_available' &&
          (lowerPresent || upperPresent || e.uncertainty.unit !== null)) {
        errors.push('measurement uncertainty marked not_available with asserted interval state');
      }
    }
    const fiducialIds = asArray(e.fiducials).map((item) => item.fiducial_id);
    if (!unique(fiducialIds)) errors.push('duplicate fiducial id');
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

  const acquisition = output.acquisition_integrity;
  if (acquisition && acquisition.status === 'not_assessed') {
    const hasAssessmentEvidence = (Array.isArray(acquisition.findings) && acquisition.findings.length > 0) ||
      (typeof acquisition.limb_relation_max_normalized_rmse === 'number' && Number.isFinite(acquisition.limb_relation_max_normalized_rmse)) ||
      (Array.isArray(acquisition.duplicate_signal_pairs) && acquisition.duplicate_signal_pairs.length > 0) ||
      (Array.isArray(acquisition.flatline_leads) && acquisition.flatline_leads.length > 0);
    if (hasAssessmentEvidence) errors.push('acquisition marked not_assessed despite assessment evidence');
  }

  if (acquisition && acquisition.status === 'consistent' &&
      ((Array.isArray(acquisition.duplicate_signal_pairs) && acquisition.duplicate_signal_pairs.length > 0) ||
       (Array.isArray(acquisition.flatline_leads) && acquisition.flatline_leads.length > 0))) {
    errors.push('acquisition marked consistent despite explicit signal-integrity defects');
  }

  const layout = output.lead_layout;
  if (layout) {
    if (layout.status === 'verified' && !layout.labels_verified) errors.push('verified layout without verified labels');
    if (layout.status === 'verified' && Array.isArray(layout.duplicate_primary_labels) && layout.duplicate_primary_labels.length > 0) {
      errors.push('verified layout contains duplicate primary labels');
    }
    if (layout.status === 'verified' && Array.isArray(layout.position_mismatches) && layout.position_mismatches.length > 0) {
      errors.push('verified layout contains position mismatches');
    }
    if (layout.specific_lead_claims_allowed && (layout.status !== 'verified' || !layout.labels_verified)) {
      errors.push('specific lead claims allowed despite ambiguous labels');
    }
    if ((!layout.labels_verified || layout.status === 'ambiguous' || !layout.specific_lead_claims_allowed) &&
        (output.lead_observations || []).length > 0) {
      errors.push('F09 specific lead observations despite unverified layout');
    }
  }

  const binding = output.serial_binding;
  if (md.analysis_mode === 'comparison' && !binding) {
    errors.push('comparison mode missing serial binding state');
  }
  if (Array.isArray(output.serial_comparison) && output.serial_comparison.length > 0 && !binding) {
    errors.push('serial comparison present without serial binding');
  }
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
expectOutputReject('guide_unclassified_pattern_id_conflict', (x) => {
  x.interpretation.primary_pattern.pattern_id = 'unclassified';
}, true);
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
expectOutputReject('measurement_evidence_metric_mismatch', (x) => {
  const ev = makeMeasurementEvidence('linked-1'); ev.metric = 'qrs'; ev.value = 1; ev.unit = 'ms'; ev.source_kind = 'user_provided'; ev.method = 'user_input';
  x.measurements.push({ name: 'other', value: 1, unit: 'ms', source: 'user', confidence: 'low', measurement_evidence_ref: 'linked-1' }); x.measurement_evidence = [ev];
}, true);
expectOutputReject('measurement_evidence_value_mismatch', (x) => {
  const ev = makeMeasurementEvidence('linked-1'); ev.value = 2; ev.unit = 'ms'; ev.source_kind = 'user_provided'; ev.method = 'user_input';
  x.measurements.push({ name: 'other', value: 1, unit: 'ms', source: 'user', confidence: 'low', measurement_evidence_ref: 'linked-1' }); x.measurement_evidence = [ev];
}, true);
expectOutputReject('measurement_evidence_unit_mismatch', (x) => {
  const ev = makeMeasurementEvidence('linked-1'); ev.value = 1; ev.unit = 'mV'; ev.source_kind = 'user_provided'; ev.method = 'user_input';
  x.measurements.push({ name: 'other', value: 1, unit: 'ms', source: 'user', confidence: 'low', measurement_evidence_ref: 'linked-1' }); x.measurement_evidence = [ev];
}, true);
expectOutputReject('measurement_evidence_lead_mismatch', (x) => {
  const ev = makeMeasurementEvidence('linked-1'); ev.lead = 'II'; ev.source_kind = 'user_provided'; ev.method = 'user_input';
  x.measurements.push({ name: 'other', value: null, unit: null, source: 'user', confidence: 'low', lead: 'I', measurement_evidence_ref: 'linked-1' }); x.measurement_evidence = [ev];
}, true);
expectOutputReject('measurement_evidence_user_source_mismatch', (x) => {
  const ev = makeMeasurementEvidence('linked-1'); ev.source_kind = 'machine_reported'; ev.method = 'machine_printout';
  x.measurements.push({ name: 'other', value: null, unit: null, source: 'user', confidence: 'low', measurement_evidence_ref: 'linked-1' }); x.measurement_evidence = [ev];
}, true);
expectOutputReject('measurement_evidence_machine_source_mismatch', (x) => {
  const ev = makeMeasurementEvidence('linked-1'); ev.source_kind = 'user_provided'; ev.method = 'user_input';
  x.measurements.push({ name: 'other', value: null, unit: null, source: 'machine', confidence: 'low', measurement_evidence_ref: 'linked-1' }); x.measurement_evidence = [ev];
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
expectOutputReject('cannot_interpret_calculated_numeric', (x) => {
  x.measurements.push({ name: 'other', value: 1, unit: 'synthetic', source: 'calculated', confidence: 'low' });
}, true);
expectOutputReject('hidden_labels_named_visual_lead', (x) => {
  x.technical_quality.lead_labels_visible = false;
  x.lead_observations = [{ lead: 'I', observations: ['synthetic'], source: 'visual', confidence: 'low' }];
}, true);
expectOutputReject('lead_observation_evidence_lead_mismatch', (x) => {
  const ev = makeMeasurementEvidence('obs-1'); ev.lead = 'II'; ev.source_kind = 'user_provided'; ev.method = 'user_input';
  x.measurement_evidence = [ev];
  x.lead_observations = [{ lead: 'I', observations: ['synthetic'], source: 'user', confidence: 'low', measurement_evidence_ref: 'obs-1' }];
}, true);
expectOutputReject('lead_observation_evidence_source_mismatch', (x) => {
  const ev = makeMeasurementEvidence('obs-1'); ev.lead = 'I'; ev.source_kind = 'machine_reported'; ev.method = 'machine_printout';
  x.measurement_evidence = [ev];
  x.lead_observations = [{ lead: 'I', observations: ['synthetic'], source: 'user', confidence: 'low', measurement_evidence_ref: 'obs-1' }];
}, true);
expectOutputReject('serial_comparison_without_binding', (x) => {
  x.serial_comparison = [{ domain: 'synthetic', prior: 'a', current: 'b', change: 'different', confidence: 'low' }];
}, true);
expectOutputReject('comparison_mode_without_binding', (x) => { x.analysis_metadata.analysis_mode = 'comparison'; }, true);
expectOutputReject('perioperative_mode_without_lens', (x) => { x.analysis_metadata.analysis_mode = 'perioperative'; }, true);
expectOutputReject('rhythm_strip_with_axis', (x) => {
  x.input.tracing_type = 'rhythm_strip';
  x.axis = { category: null, degrees: null, confidence: 'low', evidence: [] };
}, true);
expectOutputReject('calculated_qtc_without_formula', (x) => {
  x.technical_quality.grade = 'adequate';
  x.measurements.push({ name: 'qtc', value: 1, unit: 'synthetic', source: 'calculated', confidence: 'low' });
}, true);
expectOutputReject('visual_exact_calibration_disallows_exact_measurement', (x) => {
  x.technical_quality.grade = 'adequate';
  const ev = makeMeasurementEvidence('m1', 'c1');
  ev.source_kind = 'visual_fiducial'; ev.method = 'manual_fiducial'; ev.exact_numeric_claim_allowed = true;
  ev.fiducials = [{ fiducial_id: 'f1', kind: 'other', x_px: 1, y_px: 1, point_uncertainty_px: 0 }];
  ev.evidence_source = { asset_id: 'synthetic-asset', asset_sha256: '0'.repeat(64) };
  x.measurement_evidence = [ev];
  x.geometry_calibrations = [{ version: '1.0', calibration_id: 'c1', source: 'visible_grid_manual', geometry_state: 'native', x_pixels_per_mm: 1, y_pixels_per_mm: 1, paper_speed_mm_s: 1, gain_mm_per_mV: 1, x_scale_uncertainty_fraction: 0, y_scale_uncertainty_fraction: 0, residual_error_fraction_small_box: 0, exact_time_measurement_allowed: false, exact_voltage_measurement_allowed: false, supporting_evidence: ['synthetic fixture'] }];
}, true);
expectOutputReject('visual_exact_missing_fiducials', (x) => {
  x.technical_quality.grade = 'adequate';
  const ev = makeMeasurementEvidence('m1', 'c1');
  ev.source_kind = 'visual_fiducial'; ev.method = 'manual_fiducial'; ev.exact_numeric_claim_allowed = true;
  ev.evidence_source = { asset_id: 'synthetic-asset', asset_sha256: '0'.repeat(64) }; x.measurement_evidence = [ev];
  x.geometry_calibrations = [{ version: '1.0', calibration_id: 'c1', source: 'visible_grid_manual', geometry_state: 'native', x_pixels_per_mm: 1, y_pixels_per_mm: 1, paper_speed_mm_s: 1, gain_mm_per_mV: 1, x_scale_uncertainty_fraction: 0, y_scale_uncertainty_fraction: 0, residual_error_fraction_small_box: 0, exact_time_measurement_allowed: true, exact_voltage_measurement_allowed: true, supporting_evidence: ['synthetic fixture'] }];
}, true);
expectOutputReject('reversed_uncertainty_interval', (x) => { const ev = makeMeasurementEvidence('m1'); ev.uncertainty = { lower: 2, upper: 1, unit: 'synthetic', method: 'conservative_interval' }; x.measurement_evidence = [ev]; }, true);
expectOutputReject('partial_uncertainty_interval_lower_only', (x) => { const ev = makeMeasurementEvidence('m1'); ev.unit = 'synthetic'; ev.uncertainty = { lower: 1, upper: null, unit: 'synthetic', method: 'conservative_interval' }; x.measurement_evidence = [ev]; }, true);
expectOutputReject('partial_uncertainty_interval_upper_only', (x) => { const ev = makeMeasurementEvidence('m1'); ev.unit = 'synthetic'; ev.uncertainty = { lower: null, upper: 2, unit: 'synthetic', method: 'conservative_interval' }; x.measurement_evidence = [ev]; }, true);
expectOutputReject('uncertainty_unit_mismatch', (x) => { const ev = makeMeasurementEvidence('m1'); ev.unit = 'unit-a'; ev.uncertainty = { lower: 1, upper: 2, unit: 'unit-b', method: 'conservative_interval' }; x.measurement_evidence = [ev]; }, true);
expectOutputReject('uncertainty_not_available_with_interval_state', (x) => { const ev = makeMeasurementEvidence('m1'); ev.unit = 'synthetic'; ev.uncertainty = { lower: 1, upper: 2, unit: 'synthetic', method: 'not_available' }; x.measurement_evidence = [ev]; }, true);
expectOutputReject('duplicate_fiducial_ids', (x) => { const ev = makeMeasurementEvidence('m1'); ev.fiducials = [{ fiducial_id: 'dup', kind: 'other', x_px: 1, y_px: 1, point_uncertainty_px: 0 }, { fiducial_id: 'dup', kind: 'other', x_px: 2, y_px: 2, point_uncertainty_px: 0 }]; x.measurement_evidence = [ev]; }, true);
expectOutputReject('evidence_source_method_mismatch', (x) => { const ev = makeMeasurementEvidence('m1'); ev.source_kind = 'digital_signal'; ev.method = 'user_input'; x.measurement_evidence = [ev]; }, true);
expectOutputReject('unavailable_evidence_with_numeric_value', (x) => { const ev = makeMeasurementEvidence('m1'); ev.value = 1; x.measurement_evidence = [ev]; }, true);
expectOutputReject('unavailable_evidence_with_exact_claim', (x) => { const ev = makeMeasurementEvidence('m1'); ev.exact_numeric_claim_allowed = true; x.measurement_evidence = [ev]; }, true);
expectOutputReject('evidence_source_asset_id_without_hash', (x) => { const ev = makeMeasurementEvidence('m1'); ev.evidence_source = { asset_id: 'asset-1', asset_sha256: null }; x.measurement_evidence = [ev]; }, true);
expectOutputReject('evidence_source_hash_without_asset_id', (x) => { const ev = makeMeasurementEvidence('m1'); ev.evidence_source = { asset_id: null, asset_sha256: '0'.repeat(64) }; x.measurement_evidence = [ev]; }, true);
expectOutputReject('acquisition_consistent_with_duplicate_signal', (x) => { x.acquisition_integrity = { status: 'consistent', source_kind: 'digital_signal', findings: [], duplicate_signal_pairs: ['I-II'] }; }, true);
expectOutputReject('acquisition_consistent_with_flatline', (x) => { x.acquisition_integrity = { status: 'consistent', source_kind: 'digital_signal', findings: [], flatline_leads: ['I'] }; }, true);

expectRegistryReject('duplicate_pattern_ids', (pd) => { pd.patterns[1].id = pd.patterns[0].id; });
expectRegistryReject('duplicate_source_keys', (pd, fd, sd) => { sd.sources[1].key = sd.sources[0].key; });
expectRegistryReject('duplicate_pattern_source_keys', (pd) => { pd.patterns[0].source_keys.push(pd.patterns[0].source_keys[0]); });
expectRegistryReject('blank_pattern_id', (pd) => { pd.patterns[0].id = ''; });
expectRegistryReject('blank_failure_id', (pd, fd) => { fd.failure_modes[0].id = ''; });
expectRegistryReject('blank_unused_source_key', (pd, fd, sd) => {
  const item = sd.sources.find((source) => source.key === 'imdrf_gmlp_2025');
  item.key = '';
});
expectRegistryReject('unsupported_source_key', (pd) => { pd.patterns[0].source_keys.push('not_registered'); });
expectRegistryReject('stale_pattern_registry_version', (pd) => { pd.version = '4.0'; });
expectRegistryReject('stale_failure_registry_version', (pd, fd) => { fd.version = '2.0'; });
expectRegistryReject('stale_source_registry_version', (pd, fd, sd) => { sd.version = '1.0'; });
expectRegistryReject('malformed_registry_timestamp', (pd) => { pd.snapshot_date = 'not-a-date'; });
expectRegistryReject('malformed_matching_registry_timestamps', (pd, fd, sd) => {
  pd.snapshot_date = '2026-99-99';
  sd.snapshot_date = '2026-99-99';
});

const registryIdentityMismatches = [];
for (const target of ['pattern', 'failure', 'unused_source']) {
  for (const badValue of [null, '', '   ']) {
    const pd = clone(patternsDoc); const fd = clone(failuresDoc); const sd = clone(sourcesDoc);
    if (target === 'pattern') pd.patterns[0].id = badValue;
    if (target === 'failure') fd.failure_modes[0].id = badValue;
    if (target === 'unused_source') sd.sources.find((source) => source.key === 'imdrf_gmlp_2025').key = badValue;
    const rejected = registryErrors(pd, fd, sd).length > 0;
    if (!rejected) registryIdentityMismatches.push({ target, badValue });
  }
}
check('generated_registry_identity_matrix_9', registryIdentityMismatches.length === 0, registryIdentityMismatches);

const qualityMatrixMismatches = [];
for (const quality of ['adequate', 'limited', 'poor', 'cannot_interpret']) {
  for (const confidence of ['low', 'moderate', 'high']) {
    for (const hasContradiction of [false, true]) {
      const candidate = makeFixture();
      candidate.technical_quality.grade = quality;
      candidate.interpretation.primary_pattern.confidence = confidence;
      if (hasContradiction) candidate.interpretation.primary_pattern.evidence_against = ['synthetic contradiction'];
      const rejected = deepErrors(candidate).length > 0;
      const expectedReject = (quality === 'cannot_interpret' && confidence !== 'low') ||
        (confidence === 'high' && hasContradiction);
      if (rejected !== expectedReject) qualityMatrixMismatches.push({ quality, confidence, hasContradiction, rejected });
    }
  }
}
check('generated_quality_confidence_contradiction_matrix_24', qualityMatrixMismatches.length === 0, qualityMatrixMismatches);

const layoutMatrixMismatches = [];
for (const labelsVerified of [false, true]) {
  for (const status of ['verified', 'ambiguous']) {
    for (const specificAllowed of [false, true]) {
      for (const hasNamedObservation of [false, true]) {
        const candidate = makeFixture();
        candidate.technical_quality.lead_labels_visible = labelsVerified;
        candidate.lead_layout = {
          layout_type: 'unknown', labels_verified: labelsVerified, status,
          specific_lead_claims_allowed: specificAllowed
        };
        if (hasNamedObservation) {
          candidate.lead_observations = [{ lead: 'I', observations: ['synthetic'], source: 'visual', confidence: 'low' }];
        }
        const rejected = deepErrors(candidate).length > 0;
        const expectedReject = (status === 'verified' && !labelsVerified) ||
          (specificAllowed && (status !== 'verified' || !labelsVerified)) ||
          (hasNamedObservation && (!labelsVerified || status === 'ambiguous' || !specificAllowed));
        if (rejected !== expectedReject) layoutMatrixMismatches.push({ labelsVerified, status, specificAllowed, hasNamedObservation, rejected });
      }
    }
  }
}
check('generated_lead_layout_matrix_16', layoutMatrixMismatches.length === 0, layoutMatrixMismatches);

const serialMatrixMismatches = [];
const serialStates = ['same_family_verified', 'same_family_user_asserted', 'different_family', 'identity_unknown'];
for (const state of serialStates) {
  for (const scope of ['patient_serial', 'trace_only', 'not_allowed']) {
    for (const temporalAllowed of [false, true]) {
      for (const hasComparison of [false, true]) {
        const candidate = makeFixture();
        candidate.serial_binding = {
          state,
          comparison_scope: scope,
          evidence_source: state === 'same_family_verified' ? 'pseudonymous_family_token' :
            state === 'same_family_user_asserted' ? 'user_assertion' : 'none',
          temporal_change_language_allowed: temporalAllowed,
          reason: 'synthetic'
        };
        if (hasComparison) {
          candidate.serial_comparison = [{ domain: 'synthetic', prior: 'a', current: 'b', change: 'different', confidence: 'low' }];
        }
        const rejected = deepErrors(candidate).length > 0;
        const expectedReject = (scope === 'not_allowed' && temporalAllowed) ||
          ((state === 'different_family' || state === 'identity_unknown') && scope === 'patient_serial') ||
          (!temporalAllowed && hasComparison);
        if (rejected !== expectedReject) serialMatrixMismatches.push({ state, scope, temporalAllowed, hasComparison, rejected });
      }
    }
  }
}
check('generated_serial_binding_matrix_48', serialMatrixMismatches.length === 0, serialMatrixMismatches);

const geometryMatrixMismatches = [];
for (const geometryState of [null, 'native', 'perspective_uncorrected', 'unknown']) {
  for (const exactAllowed of [false, true]) {
    const candidate = makeFixture();
    candidate.technical_quality.grade = 'adequate';
    const ev = makeMeasurementEvidence('visual-1', geometryState ? 'cal-1' : null);
    ev.source_kind = 'visual_fiducial';
    ev.method = 'manual_fiducial';
    ev.exact_numeric_claim_allowed = exactAllowed;
    ev.evidence_source = { asset_id: 'synthetic-asset', asset_sha256: '0'.repeat(64) };
    ev.fiducials = [{ fiducial_id: 'f1', kind: 'other', x_px: 1, y_px: 1, point_uncertainty_px: 0 }];
    candidate.measurement_evidence = [ev];
    if (geometryState) {
      candidate.geometry_calibrations = [{
        version: '1.0', calibration_id: 'cal-1', source: 'visible_grid_manual',
        geometry_state: geometryState, x_pixels_per_mm: 1, y_pixels_per_mm: 1,
        paper_speed_mm_s: 1, gain_mm_per_mV: 1, x_scale_uncertainty_fraction: 0,
        y_scale_uncertainty_fraction: 0, residual_error_fraction_small_box: 0,
        exact_time_measurement_allowed: true, exact_voltage_measurement_allowed: true,
        supporting_evidence: ['synthetic fixture']
      }];
    }
    const rejected = deepErrors(candidate).length > 0;
    const expectedReject = exactAllowed && (geometryState === null || geometryState === 'perspective_uncorrected' || geometryState === 'unknown');
    if (rejected !== expectedReject) geometryMatrixMismatches.push({ geometryState, exactAllowed, rejected });
  }
}
check('generated_visual_geometry_exactness_matrix_8', geometryMatrixMismatches.length === 0, geometryMatrixMismatches);

expectOutputReject('acquisition_not_assessed_with_findings', (x) => {
  x.acquisition_integrity = { status: 'not_assessed', source_kind: 'unknown', findings: ['synthetic assessment evidence'] };
}, true);
expectOutputReject('verified_layout_with_duplicate_primary_labels', (x) => {
  x.lead_layout = { layout_type: 'standard_3x4_rhythm', labels_verified: true, status: 'verified', specific_lead_claims_allowed: true, duplicate_primary_labels: ['I'] };
}, true);
expectOutputReject('verified_layout_with_position_mismatch', (x) => {
  x.lead_layout = { layout_type: 'standard_3x4_rhythm', labels_verified: true, status: 'verified', specific_lead_claims_allowed: true, position_mismatches: ['synthetic mismatch'] };
}, true);

const acquisitionMatrixMismatches = [];
for (let mask = 0; mask < 16; mask += 1) {
  const candidate = makeFixture();
  const acquisition = { status: 'not_assessed', source_kind: 'unknown', findings: [] };
  if (mask & 1) acquisition.findings = ['synthetic'];
  if (mask & 2) acquisition.limb_relation_max_normalized_rmse = 0;
  if (mask & 4) acquisition.duplicate_signal_pairs = ['I-II'];
  if (mask & 8) acquisition.flatline_leads = ['I'];
  candidate.acquisition_integrity = acquisition;
  const rejected = deepErrors(candidate).length > 0;
  const expectedReject = mask !== 0;
  if (rejected !== expectedReject) acquisitionMatrixMismatches.push({ mask, rejected });
}
check('generated_acquisition_not_assessed_matrix_16', acquisitionMatrixMismatches.length === 0, acquisitionMatrixMismatches);

const layoutConflictMismatches = [];
for (const status of ['verified', 'ambiguous']) {
  for (const hasDuplicateLabels of [false, true]) {
    for (const hasPositionMismatch of [false, true]) {
      const candidate = makeFixture();
      candidate.lead_layout = {
        layout_type: 'standard_3x4_rhythm', labels_verified: true, status,
        specific_lead_claims_allowed: status === 'verified',
        duplicate_primary_labels: hasDuplicateLabels ? ['I'] : [],
        position_mismatches: hasPositionMismatch ? ['synthetic mismatch'] : []
      };
      const rejected = deepErrors(candidate).length > 0;
      const expectedReject = status === 'verified' && (hasDuplicateLabels || hasPositionMismatch);
      if (rejected !== expectedReject) layoutConflictMismatches.push({ status, hasDuplicateLabels, hasPositionMismatch, rejected });
    }
  }
}
check('generated_layout_conflict_matrix_8', layoutConflictMismatches.length === 0, layoutConflictMismatches);

const evidenceMatrixMismatches = [];
const sourceMethods = {
  visual_fiducial: 'manual_fiducial', digital_signal: 'digital_sample',
  machine_reported: 'machine_printout', user_provided: 'user_input'
};
for (const sourceKind of Object.keys(sourceMethods)) {
  for (const geometryState of [null, 'native', 'perspective_uncorrected']) {
    for (const exactAllowed of [false, true]) {
      for (const hasFiducial of [false, true]) {
        const candidate = makeFixture();
        candidate.technical_quality.grade = 'adequate';
        const ev = makeMeasurementEvidence('mx', geometryState ? 'cx' : null);
        ev.source_kind = sourceKind;
        ev.method = sourceMethods[sourceKind];
        ev.exact_numeric_claim_allowed = exactAllowed;
        ev.fiducials = hasFiducial ? [{ fiducial_id: 'fx', kind: 'other', x_px: 1, y_px: 1, point_uncertainty_px: 0 }] : [];
        ev.evidence_source = { asset_id: 'synthetic-asset', asset_sha256: '0'.repeat(64) };
        candidate.measurement_evidence = [ev];
        if (geometryState) candidate.geometry_calibrations = [{
          version: '1.0', calibration_id: 'cx', source: 'visible_grid_manual', geometry_state: geometryState,
          x_pixels_per_mm: 1, y_pixels_per_mm: 1, paper_speed_mm_s: 1, gain_mm_per_mV: 1,
          x_scale_uncertainty_fraction: 0, y_scale_uncertainty_fraction: 0, residual_error_fraction_small_box: 0,
          exact_time_measurement_allowed: true, exact_voltage_measurement_allowed: true,
          supporting_evidence: ['synthetic fixture']
        }];
        const rejected = deepErrors(candidate).length > 0;
        const expectedReject = sourceKind === 'visual_fiducial' && exactAllowed &&
          (!hasFiducial || geometryState === null || geometryState === 'perspective_uncorrected');
        if (rejected !== expectedReject) evidenceMatrixMismatches.push({ sourceKind, geometryState, exactAllowed, hasFiducial, rejected });
      }
    }
  }
}
check('generated_evidence_source_geometry_matrix_48', evidenceMatrixMismatches.length === 0, evidenceMatrixMismatches);

const sourceMethodMatrixMismatches = [];
const allowedMethodsBySource = {
  visual_fiducial: ['manual_fiducial', 'automated_fiducial_unvalidated'], digital_signal: ['digital_sample'],
  machine_reported: ['machine_printout'], user_provided: ['user_input'], calculated: ['formula'], unavailable: ['unavailable']
};
const allEvidenceMethods = ['manual_fiducial', 'automated_fiducial_unvalidated', 'digital_sample', 'machine_printout', 'user_input', 'formula', 'unavailable'];
for (const [sourceKind, allowedMethods] of Object.entries(allowedMethodsBySource)) {
  for (const method of allEvidenceMethods) {
    const candidate = makeFixture();
    const ev = makeMeasurementEvidence('method-matrix');
    ev.source_kind = sourceKind; ev.method = method;
    candidate.measurement_evidence = [ev];
    const rejected = deepErrors(candidate).length > 0;
    const expectedReject = !allowedMethods.includes(method);
    if (rejected !== expectedReject) sourceMethodMatrixMismatches.push({ sourceKind, method, rejected });
  }
}
check('generated_evidence_source_method_matrix_42', sourceMethodMatrixMismatches.length === 0, sourceMethodMatrixMismatches);

const unavailableStateMismatches = [];
for (let mask = 0; mask < 16; mask += 1) {
  const candidate = makeFixture();
  const ev = makeMeasurementEvidence('unavailable-matrix');
  if (mask & 1) ev.value = 1;
  if (mask & 2) ev.calibration_id = 'asserted-calibration';
  if (mask & 4) ev.fiducials = [{ fiducial_id: 'f', kind: 'other', x_px: 1, y_px: 1, point_uncertainty_px: 0 }];
  if (mask & 8) ev.exact_numeric_claim_allowed = true;
  candidate.measurement_evidence = [ev];
  const rejected = deepErrors(candidate).length > 0;
  const expectedReject = mask !== 0;
  if (rejected !== expectedReject) unavailableStateMismatches.push({ mask, rejected });
}
check('generated_unavailable_evidence_state_matrix_16', unavailableStateMismatches.length === 0, unavailableStateMismatches);

const measurementEvidenceSourceMismatches = [];
const measurementSourceMap = {
  user: 'user_provided', machine: 'machine_reported',
  calculated: 'calculated', unavailable: 'unavailable'
};
const evidenceMethodMap = {
  visual_fiducial: 'manual_fiducial', digital_signal: 'digital_sample', machine_reported: 'machine_printout',
  user_provided: 'user_input', calculated: 'formula', unavailable: 'unavailable'
};
for (const [measurementSource, expectedEvidenceSource] of Object.entries(measurementSourceMap)) {
  for (const evidenceSource of Object.keys(evidenceMethodMap)) {
    const candidate = makeFixture();
    candidate.technical_quality.grade = 'adequate';
    const ev = makeMeasurementEvidence('source-matrix');
    ev.source_kind = evidenceSource; ev.method = evidenceMethodMap[evidenceSource];
    candidate.measurement_evidence = [ev];
    candidate.measurements.push({ name: 'other', value: null, unit: null, source: measurementSource, confidence: 'low', measurement_evidence_ref: 'source-matrix' });
    const rejected = deepErrors(candidate).length > 0;
    const expectedReject = evidenceSource !== expectedEvidenceSource;
    if (rejected !== expectedReject) measurementEvidenceSourceMismatches.push({ measurementSource, evidenceSource, rejected });
  }
}
check('generated_measurement_evidence_source_binding_matrix_24', measurementEvidenceSourceMismatches.length === 0, measurementEvidenceSourceMismatches);

const leadObservationEvidenceMismatches = [];
const observationSourceMap = {
  visual: ['visual_fiducial'], user: ['user_provided'], machine: ['machine_reported'],
  calculated: ['calculated'], mixed: ['visual_fiducial', 'digital_signal', 'machine_reported', 'user_provided', 'calculated']
};
for (const [observationSource, allowedEvidenceSources] of Object.entries(observationSourceMap)) {
  for (const evidenceSource of Object.keys(evidenceMethodMap)) {
    const candidate = makeFixture();
    candidate.technical_quality.grade = 'adequate';
    const ev = makeMeasurementEvidence('obs-source-matrix');
    ev.lead = 'I'; ev.source_kind = evidenceSource; ev.method = evidenceMethodMap[evidenceSource];
    candidate.measurement_evidence = [ev];
    candidate.lead_observations = [{ lead: 'I', observations: ['synthetic'], source: observationSource, confidence: 'low', measurement_evidence_ref: 'obs-source-matrix' }];
    const rejected = deepErrors(candidate).length > 0;
    const expectedReject = !allowedEvidenceSources.includes(evidenceSource);
    if (rejected !== expectedReject) leadObservationEvidenceMismatches.push({ observationSource, evidenceSource, rejected });
  }
}
check('generated_lead_observation_evidence_source_binding_matrix_30', leadObservationEvidenceMismatches.length === 0, leadObservationEvidenceMismatches);

const assetIdentityMismatches = [];
for (const hasAssetId of [false, true]) {
  for (const hasAssetHash of [false, true]) {
    const candidate = makeFixture();
    const ev = makeMeasurementEvidence('asset-identity');
    ev.evidence_source = {
      asset_id: hasAssetId ? 'asset-1' : null,
      asset_sha256: hasAssetHash ? '0'.repeat(64) : null
    };
    candidate.measurement_evidence = [ev];
    const rejected = deepErrors(candidate).length > 0;
    const expectedReject = hasAssetId !== hasAssetHash;
    if (rejected !== expectedReject) assetIdentityMismatches.push({ hasAssetId, hasAssetHash, rejected });
  }
}
check('generated_evidence_source_asset_identity_matrix_4', assetIdentityMismatches.length === 0, assetIdentityMismatches);

const uncertaintyMatrixMismatches = [];
for (const lowerPresent of [false, true]) {
  for (const upperPresent of [false, true]) {
    for (const method of ['conservative_interval', 'source_reported', 'not_available']) {
      for (const unitState of ['match', 'other', 'null']) {
        const candidate = makeFixture();
        const ev = makeMeasurementEvidence('uncertainty-matrix');
        ev.unit = 'unit-a';
        const uncertaintyUnit = unitState === 'match' ? 'unit-a' : unitState === 'other' ? 'unit-b' : null;
        ev.uncertainty = {
          lower: lowerPresent ? 1 : null,
          upper: upperPresent ? 2 : null,
          unit: uncertaintyUnit,
          method
        };
        candidate.measurement_evidence = [ev];
        const rejected = deepErrors(candidate).length > 0;
        const partialInterval = lowerPresent !== upperPresent;
        const unitMismatch = lowerPresent && upperPresent && uncertaintyUnit !== ev.unit;
        const unavailableCarriesState = method === 'not_available' &&
          (lowerPresent || upperPresent || uncertaintyUnit !== null);
        const expectedReject = partialInterval || unitMismatch || unavailableCarriesState;
        if (rejected !== expectedReject) {
          uncertaintyMatrixMismatches.push({ lowerPresent, upperPresent, method, unitState, rejected });
        }
      }
    }
  }
}
check('generated_uncertainty_state_matrix_36', uncertaintyMatrixMismatches.length === 0, uncertaintyMatrixMismatches);
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
if (!patternById.has('unclassified')) {
  findings.push('Structured-output guide reserves pattern_id unclassified, but pattern registry does not define it; shallow schema accepts it and deep registry validation rejects it.');
}
findings.push('secondary_findings remains free-text only, limiting deterministic registry-level contradiction checks.');

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
