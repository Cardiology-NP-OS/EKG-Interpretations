# Cross-Donor Capability Synthesis

This checkpoint maps 213 accepted-donor source capabilities into 52 target-owned brand-neutral capabilities. Donor packages remain provenance only.

## Cross-donor overlaps

- **ECG-CAP-DATASET-CATALOG ? Canonical ECG dataset identity catalog:** tmehari/ptbxl_feature_benchmark, vlbthambawita/ECGBench. Canonical home: `evaluation/datasets/ECG_DATASET_CATALOG.json`.
- **ECG-CAP-EVALUATION-ANNOTATION-AGREEMENT ? Annotation/event agreement and timing:** MIT-LCP/wfdb-python, vitaldb/openecg, neuropsychology/NeuroKit, DeepPSP/torch_ecg. Canonical home: `lib/challenger_contract.js`.
- **ECG-CAP-EVALUATION-FAILURE-MODES ? Evaluation failure-mode catalog:** neuropsychology/NeuroKit, tmehari/ptbxl_feature_benchmark. Canonical home: `evaluation/failure_modes/FAILURE_MODE_CATALOG.json`.
- **ECG-CAP-EVALUATION-LEAKAGE-CONTROL ? Patient and record leakage controls:** vitaldb/openecg, tmehari/ptbxl_feature_benchmark, vlbthambawita/ECGBench. Canonical home: `lib/evaluation_contract.js`.
- **ECG-CAP-EVALUATION-METRICS ? Non-reportable evaluation metric contracts:** DeepPSP/torch_ecg, tmehari/ptbxl_feature_benchmark. Canonical home: `evaluation/benchmarks/BENCHMARK_CONTRACTS.json`.
- **ECG-CAP-EVALUATION-PATIENT-SPLITS ? Patient/record-level split contracts:** vitaldb/openecg, tmehari/ptbxl_feature_benchmark, vlbthambawita/ECGBench. Canonical home: `lib/evaluation_contract.js`.
- **ECG-CAP-EVALUATION-REPRODUCIBILITY ? Reproducibility and regression contracts:** MIT-LCP/wfdb-python, neuropsychology/NeuroKit, DeepPSP/torch_ecg, tmehari/ptbxl_feature_benchmark, vlbthambawita/ECGBench. Canonical home: `evaluation/protocols/REPRODUCIBILITY_CONTRACT.json`.
- **ECG-CAP-EVALUATION-ROBUSTNESS ? Robustness and distortion evaluation:** vitaldb/openecg, neuropsychology/NeuroKit, DeepPSP/torch_ecg, tmehari/ptbxl_feature_benchmark. Canonical home: `evaluation/robustness/ROBUSTNESS_CATALOG.json`.
- **ECG-CAP-EVENT-BEAT-RHYTHM-REPRESENTATION ? Beat, rhythm, and event representations:** MIT-LCP/wfdb-python, vitaldb/openecg, DeepPSP/torch_ecg. Canonical home: `lib/challenger_contract.js`.
- **ECG-CAP-EVENT-FIDUCIAL-DELINEATION ? P/QRS/T fiducial delineation:** vitaldb/openecg, neuropsychology/NeuroKit, vlbthambawita/ECGBench. Canonical home: `evaluation/protocols/ANNOTATION_EVALUATION_CONTRACTS.json`.
- **ECG-CAP-EVENT-RPEAK-DETECTION ? R-peak event detection challengers:** MIT-LCP/wfdb-python, vitaldb/openecg, neuropsychology/NeuroKit, DeepPSP/torch_ecg. Canonical home: `research/signal_processing/README.md`.
- **ECG-CAP-GOVERNANCE-CLINICAL-AUTHORITY ? Clinical-authority separation and inactive control:** MIT-LCP/wfdb-python, vitaldb/openecg, neuropsychology/NeuroKit, DeepPSP/torch_ecg, tmehari/ptbxl_feature_benchmark, vlbthambawita/ECGBench. Canonical home: `docs/REPOSITORY_ARCHITECTURE.md`.
- **ECG-CAP-GOVERNANCE-DEPENDENCY-REPRODUCIBILITY ? Dependency and environment reproducibility:** MIT-LCP/wfdb-python, neuropsychology/NeuroKit, DeepPSP/torch_ecg, alphanumericslab/ecg-image-kit, tmehari/ptbxl_feature_benchmark, vlbthambawita/ECGBench. Canonical home: `evaluation/protocols/REPRODUCIBILITY_CONTRACT.json`.
- **ECG-CAP-GOVERNANCE-LICENSE-PROVENANCE ? License and asset provenance boundaries:** MIT-LCP/wfdb-python, vitaldb/openecg, neuropsychology/NeuroKit, DeepPSP/torch_ecg, alphanumericslab/ecg-image-kit, tmehari/ptbxl_feature_benchmark, vlbthambawita/ECGBench. Canonical home: `ECG_CROSS_DONOR_INTEGRATION_AUDIT.json`.
- **ECG-CAP-GOVERNANCE-REMOTE-ACQUISITION ? Remote/mutable acquisition rejection boundary:** MIT-LCP/wfdb-python, DeepPSP/torch_ecg, alphanumericslab/ecg-image-kit, vlbthambawita/ECGBench. Canonical home: `evaluation/failure_modes/FAILURE_MODE_CATALOG.json`.
- **ECG-CAP-GOVERNANCE-SOURCE-INTEGRITY ? Exact-source identity and substitution resistance:** MIT-LCP/wfdb-python, vlbthambawita/ECGBench. Canonical home: `docs/REPOSITORY_ARCHITECTURE.md`.
- **ECG-CAP-GOVERNANCE-UNSAFE-DESERIALIZATION ? Unsafe model/state deserialization rejection boundary:** DeepPSP/torch_ecg, tmehari/ptbxl_feature_benchmark. Canonical home: `evaluation/failure_modes/FAILURE_MODE_CATALOG.json`.
- **ECG-CAP-IMAGE-RENDERING ? Waveform-to-paper rendering concepts:** MIT-LCP/wfdb-python, DeepPSP/torch_ecg, alphanumericslab/ecg-image-kit. Canonical home: `research/image_ecg/README.md`.
- **ECG-CAP-MODEL-CLASSIFICATION-CHALLENGERS ? Classification encoder challengers:** DeepPSP/torch_ecg, tmehari/ptbxl_feature_benchmark. Canonical home: `research/models/CHALLENGER_CATALOG.md`.
- **ECG-CAP-MODEL-SSL-REPRESENTATIONS ? Self-supervised/foundation representation concepts:** vitaldb/openecg, DeepPSP/torch_ecg. Canonical home: `research/models/CHALLENGER_CATALOG.md`.
- **ECG-CAP-PREPROCESS-FILTERING-BASELINE ? Filtering and baseline-handling contracts:** MIT-LCP/wfdb-python, neuropsychology/NeuroKit, DeepPSP/torch_ecg, tmehari/ptbxl_feature_benchmark. Canonical home: `research/preprocessing/README.md`.
- **ECG-CAP-PREPROCESS-RESAMPLING ? Resampling contracts:** MIT-LCP/wfdb-python, neuropsychology/NeuroKit. Canonical home: `research/preprocessing/README.md`.
- **ECG-CAP-PREPROCESS-WINDOWING-SEGMENTATION ? Windowing and segmentation contracts:** neuropsychology/NeuroKit, vlbthambawita/ECGBench. Canonical home: `research/preprocessing/README.md`.
- **ECG-CAP-QUALITY-CALIBRATION-METADATA ? Calibration and metadata integrity:** MIT-LCP/wfdb-python, alphanumericslab/ecg-image-kit, vlbthambawita/ECGBench. Canonical home: `lib/input_quality_guard.js`.
- **ECG-CAP-QUALITY-FLATLINE-CLIPPING ? Flatline and clipping detection:** neuropsychology/NeuroKit, vlbthambawita/ECGBench. Canonical home: `lib/signal_quality.js`.
- **ECG-CAP-QUALITY-NOISE-ROBUSTNESS ? Noise and amplitude robustness:** neuropsychology/NeuroKit, vlbthambawita/ECGBench. Canonical home: `evaluation/robustness/ROBUSTNESS_CATALOG.json`.
- **ECG-CAP-RESEARCH-DATA-LOADERS ? Dataset loader and adapter research:** DeepPSP/torch_ecg, tmehari/ptbxl_feature_benchmark, vlbthambawita/ECGBench. Canonical home: `research/datasets/DATASET_CARD_INDEX.json`.
- **ECG-CAP-RESEARCH-MODEL-BENCHMARK-CONTEXT ? Model/benchmark scientific context:** DeepPSP/torch_ecg, alphanumericslab/ecg-image-kit, tmehari/ptbxl_feature_benchmark. Canonical home: `research/benchmarks/README.md`.
- **ECG-CAP-SIGNAL-FORMAT-ADAPTERS ? Signal format interoperability and adapters:** MIT-LCP/wfdb-python, neuropsychology/NeuroKit, vlbthambawita/ECGBench. Canonical home: `research/signal_processing/README.md`.
- **ECG-CAP-SIGNAL-WFDB-CORE ? WFDB signal and metadata semantics:** MIT-LCP/wfdb-python, vitaldb/openecg, DeepPSP/torch_ecg, alphanumericslab/ecg-image-kit, vlbthambawita/ECGBench. Canonical home: `lib/wfdb_signal.js`.

## Preservation result

- Capabilities previously lacking an external canonical target pointer: **204**.
- Ambiguous after normalization: **0**.
- Rejected capabilities are preserved as negative findings; license-blocked capabilities remain blocked.
- No source label, dataset byte, model weight, or donor benchmark score is admitted by this checkpoint.
