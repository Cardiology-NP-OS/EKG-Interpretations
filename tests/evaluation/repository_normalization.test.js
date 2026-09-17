"use strict";
const assert=require("assert");
const crypto=require("crypto");
const cp=require("child_process");
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"../..");
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,""));
const gitBlobSha=p=>crypto.createHash("sha256").update(cp.execFileSync("git",["show",`HEAD:${p}`],{cwd:root})).digest("hex");
const exists=p=>fs.existsSync(path.join(root,p));
let passed=0; const check=(name,fn)=>{fn(); passed++; console.log(`PASS ${name}`);};
const donor=readJson("ECG_DONOR_CAPABILITY_REGISTRY.json");
const canonical=readJson("ECG_CAPABILITY_REGISTRY.json");
const audit=readJson("ECG_CROSS_DONOR_INTEGRATION_AUDIT.json");
const datasets=readJson("ECG_DATASET_REGISTRY.json");
const catalog=readJson("evaluation/datasets/ECG_DATASET_CATALOG.json");
const cards=readJson("research/datasets/DATASET_CARD_INDEX.json");
check("every accepted-donor material capability is normalized exactly once",()=>{
  assert.strictEqual(audit.material_source_capability_count,donor.capability_count);
  assert.strictEqual(audit.capabilities.length,donor.capabilities.length);
  const ids=audit.capabilities.map(x=>x.source_capability_id);
  assert.strictEqual(new Set(ids).size,ids.length);
  assert.deepStrictEqual(new Set(ids),new Set(donor.capabilities.map(x=>x.capability_id)));
  assert.strictEqual(audit.ambiguous_after_checkpoint_count,0);
});
check("canonical capability identifiers are unique and brand-neutral",()=>{
  assert.strictEqual(canonical.capability_count,canonical.capabilities.length);
  const ids=canonical.capabilities.map(x=>x.capability_id);
  assert.strictEqual(new Set(ids).size,ids.length);
  for(const id of ids){assert.ok(/^ECG-CAP-[A-Z0-9-]+$/.test(id)); assert.ok(!/(NEUROKIT|ECGBENCH|TORCH.ECG|OPENECG|IMAGE.KIT)/i.test(id));}
});
check("canonical homes exist outside donor provenance",()=>{
  const ids=new Set(canonical.capabilities.map(x=>x.capability_id));
  for(const row of audit.capabilities){
    assert.ok(ids.has(row.canonical_target_capability_id),row.source_capability_id);
    assert.ok(!row.canonical_target_path.replace(/\\/g,"/").startsWith("donors/"),row.source_capability_id);
    assert.ok(exists(row.canonical_target_path),row.canonical_target_path);
    assert.ok(row.research_representation.every(exists),row.source_capability_id);
    assert.ok(row.evaluation_representation.every(exists),row.source_capability_id);
    assert.ok(row.tests.every(exists),row.source_capability_id);
  }
});
check("canonical capabilities retain exact upstream provenance and explicit license state",()=>{
  for(const c of canonical.capabilities){
    assert.ok(c.source_provenance.length>0,c.capability_id);
    for(const p of c.source_provenance){assert.ok(/^[0-9a-f]{40}$/.test(p.commit),`${c.capability_id} commit`); assert.ok(/^[0-9a-f]{40}$/.test(p.tree),`${c.capability_id} tree`); assert.ok(!p.manifest.includes("\\"),`${c.capability_id} portable manifest path`); assert.ok(exists(p.manifest),p.manifest);}
    assert.ok(c.licenses.length>0,c.capability_id);
    for(const l of c.licenses) assert.ok(typeof l.status==="string"&&l.status.length>0,c.capability_id);
    assert.ok(!c.canonical_target_path.replace(/\\/g,"/").startsWith("donors/"));
    assert.ok(exists(c.canonical_target_path),c.canonical_target_path);
  }
});
check("public target implementation paths contain no donor branding",()=>{
  const banned=/(neurokit|ecgbench|torch_ecg|openecg|ecg-image-kit|ptbxl_feature_benchmark)/i;
  for(const c of canonical.capabilities.filter(x=>x.canonical_target_path.startsWith("lib/"))){
    assert.ok(!banned.test(c.canonical_target_path),c.canonical_target_path);
    assert.ok(!banned.test(fs.readFileSync(path.join(root,c.canonical_target_path),"utf8")),c.canonical_target_path);
  }
});
check("research and dataset authority fences remain false",()=>{
  const assertions=readJson("research/RESEARCH_ASSERTION_REGISTRY.json");
  assert.strictEqual(assertions.project_gold,false);
  assert.strictEqual(assertions.runtime_authority,false);
  assert.strictEqual(datasets.approved_adjudicated_project_gold_count,0);
  assert.strictEqual(catalog.projectGold,false);
  assert.strictEqual(catalog.sourceLabelsAreProjectGold,false);
  assert.strictEqual(catalog.runtimeAuthority,false);
  assert.strictEqual(catalog.clinicalValidityInferred,false);
  for(const d of catalog.entries){assert.strictEqual(d.projectGold,false); assert.strictEqual(d.sourceLabelsAreProjectGold,false); assert.strictEqual(d.runtimeAuthority,false);}
});
check("dataset cards agree with normalized identities and global registry coverage",()=>{
  assert.strictEqual(cards.cardCount,catalog.datasetCount);
  assert.strictEqual(cards.cards.length,catalog.entries.length);
  assert.strictEqual(catalog.canonicalDatasetCount,68); assert.strictEqual(catalog.sourceAssetCompatibilityCount,6);
  assert.strictEqual(cards.canonicalDatasetCardCount,68); assert.strictEqual(cards.sourceAssetCompatibilityCardCount,6);
  const byId=new Map(catalog.entries.map(x=>[x.datasetId,x]));
  const banned=/(NEUROKIT|ECGBENCH|TORCH.ECG|IMAGE.KIT|OPENECG)/i;
  for(const card of cards.cards){
    const d=byId.get(card.datasetId); assert.ok(d,card.datasetId); assert.strictEqual(card.name,d.name); assert.ok(exists(card.path));
    const cls=card.identityClass||d.identityClass||"CANONICAL_DATASET"; assert.strictEqual(cls,d.identityClass||"CANONICAL_DATASET");
    const text=fs.readFileSync(path.join(root,card.path),"utf8");
    if(cls==="CANONICAL_DATASET"){assert.ok(card.datasetId.startsWith("ECG-DATASET-"),card.datasetId); assert.ok(text.includes("Canonical dataset ID: `"+card.datasetId+"`"),card.path);}
    else {assert.ok(text.includes("Normalized source-asset ID: `"+card.datasetId+"`"),card.path); assert.ok(!banned.test(card.datasetId+card.name+card.path),card.path);}
    assert.ok(text.includes("Current project disposition: "+card.currentProjectDisposition),card.path);
  }
  const aliases={"LUDB":"ECG-DATASET-LUDB","QT Database (QTDB)":"ECG-DATASET-QTDB","MIT-BIH Atrial Fibrillation Database (AFDB)":"ECG-DATASET-AFDB","MIT-BIH Malignant Ventricular Ectopy Database (VFDB)":"ECG-DATASET-VFDB","MIT-BIH Normal Sinus Rhythm Database (NSRDB)":"ECG-DATASET-NSRDB","CODE-test":"ECG-DATASET-CODE-TEST","PTB-XL":"ECG-DATASET-PTBXL","ECG-Image-Kit bundled ECG/image/ROI/sample assets":"ECG-ASSET-BUNDLE-IMAGE-ROI-SAMPLE-ASSETS","ECGBench catalogue of 64 external ECG datasets":"ECG-SOURCE-CATALOG-EXTERNAL-ECG-DATASETS","NeuroKit bundled physiological example/test assets":"ECG-ASSET-BUNDLE-PHYSIOLOGICAL-EXAMPLE-TEST-ASSETS","torch_ecg bundled sample/benchmark physiological assets":"ECG-ASSET-BUNDLE-PHYSIOLOGICAL-BENCHMARK-SAMPLE-ASSETS","PTB-XL+ external engineered feature/statement assets":"ECG-DERIVED-ASSET-PTBXL-PLUS-FEATURE-STATEMENT-ASSETS","VitalDB arrhythmia-derived beat data":"ECG-DERIVED-ASSET-VITALDB-ARRHYTHMIA-BEAT-DATA"};
  for(const g of datasets.datasets){if(aliases[g.name]) assert.ok(byId.has(aliases[g.name]),g.name); else assert.ok(catalog.entries.some(x=>x.name===g.name),g.name);}
});
check("evaluation fixtures are synthetic and provenance-bound",()=>{
  for(const name of fs.readdirSync(path.join(root,"evaluation/fixtures")).filter(x=>x.endsWith(".json"))){const f=readJson(`evaluation/fixtures/${name}`); assert.ok(f.provenance&&f.provenance.source&&f.provenance.locator,name); assert.strictEqual(f.projectGold,false,name); assert.strictEqual(f.runtimeAuthority,false,name);}
});
check("accepted donor receipts remain byte-for-byte reproducible",()=>{
  const b=readJson("evaluation/protocols/ACCEPTED_DONOR_RECEIPT_BASELINE.json");
  assert.strictEqual(b.receiptCount,7);
  for(const x of b.receipts){assert.ok(exists(x.path),x.path); assert.strictEqual(gitBlobSha(x.path),x.sha256_git_blob_content,x.path);}
});
check("legacy governance compatibility registries remain unchanged",()=>{
  const b=readJson("evaluation/protocols/GOVERNANCE_COMPATIBILITY_BASELINE.json");
  for(const x of b.files){assert.ok(exists(x.path),x.path); assert.strictEqual(gitBlobSha(x.path),x.sha256_git_blob_content,x.path);}
});
check("superseded source implementations remain inactive provenance only",()=>{
  for(const row of audit.capabilities.filter(x=>x.prior_disposition==="SUPERSEDED")){
    assert.strictEqual(row.final_disposition,"SUPERSEDED",row.source_capability_id);
    const c=canonical.capabilities.find(x=>x.capability_id===row.canonical_target_capability_id);
    assert.ok(c.supersedes.includes(`${row.original_source}:${row.source_capability_id}`),row.source_capability_id);
  }
  const pkg=readJson("package.json"); const deps=Object.keys(pkg.dependencies||{}).concat(Object.keys(pkg.devDependencies||{})).join(" ");
  assert.ok(!/(neurokit|torch.ecg|openecg|ecgbench|ecg.image.kit)/i.test(deps));
});
check("all prior dispositions remain terminal and no capability is ambiguous",()=>{
  const allowed=new Set(["INTEGRATED","DEPENDENCY","ADAPTER","CHALLENGER","EVALUATION_ONLY","DATA_ONLY","RESEARCH_ONLY","SUPERSEDED","REJECTED","LICENSE_REVIEW_REQUIRED"]);
  for(const row of audit.capabilities){assert.ok(allowed.has(row.final_disposition),row.source_capability_id); assert.ok(row.action_required); assert.ok(row.preservation_assessment);}
  assert.strictEqual(audit.ambiguous_after_checkpoint_count,0);
});
check("governed clinical state is unchanged",()=>{
  assert.strictEqual(audit.governed_state.completion_state,"SPECIALIST_COMPLETE_INACTIVE");
  assert.strictEqual(audit.governed_state.diagnostic_runtime,"GOVERNED_INACTIVE");
  assert.strictEqual(audit.governed_state.evidence_admission,"NOT_ADMITTED");
  assert.strictEqual(audit.governed_state.approved_adjudicated_gold_count,0);
  assert.strictEqual(audit.governed_state.metrics,"NOT_REPORTABLE");
  assert.strictEqual(audit.governed_state.activation,"NOT_ELIGIBLE");
  assert.strictEqual(audit.governed_state.clinical_validity,"NOT_INFERRED");
});
console.log(JSON.stringify({schema:"ekg-cross-donor-normalization-tests-v1",pass:true,passed,total:passed,source_capabilities:audit.material_source_capability_count,canonical_capabilities:canonical.capability_count,dataset_cards:cards.cardCount,ambiguous:audit.ambiguous_after_checkpoint_count,diagnostic_runtime:"GOVERNED_INACTIVE",clinical_authority_added:false}));
