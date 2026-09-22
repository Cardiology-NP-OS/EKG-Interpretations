ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /opt/ekg-evaluation-candidate
COPY lib/development_candidate_isolation.js ./lib/development_candidate_isolation.js
COPY lib/development_candidate_runtime_attestation.js ./lib/development_candidate_runtime_attestation.js
COPY lib/development_candidate_worker.js ./lib/development_candidate_worker.js
COPY lib/development_control_snapshot.js ./lib/development_control_snapshot.js
COPY lib/development_evaluation_runner.js ./lib/development_evaluation_runner.js
COPY lib/development_execution_handoff.js ./lib/development_execution_handoff.js
COPY lib/development_execution_identity.js ./lib/development_execution_identity.js
COPY lib/development_execution_input.js ./lib/development_execution_input.js
COPY lib/development_run_accounting.js ./lib/development_run_accounting.js
COPY lib/evaluation_contract.js ./lib/evaluation_contract.js
COPY lib/evaluation_runtime.js ./lib/evaluation_runtime.js
COPY lib/evaluation_signatures.js ./lib/evaluation_signatures.js
COPY lib/local_dataset_loader.js ./lib/local_dataset_loader.js
COPY lib/pan_tompkins_detector.js ./lib/pan_tompkins_detector.js
COPY lib/signal_dsp_filtering.js ./lib/signal_dsp_filtering.js
COPY lib/signal_measurement_contract.js ./lib/signal_measurement_contract.js
COPY lib/wfdb_signal.js ./lib/wfdb_signal.js
COPY tools/run_development_evaluation.js ./tools/run_development_evaluation.js
COPY evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json ./evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json
COPY evaluation/protocols/DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json ./evaluation/protocols/DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json
