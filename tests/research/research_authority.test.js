"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"../..");
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,""));
let passed=0; const check=(name,fn)=>{fn(); passed++; console.log(`PASS ${name}`);};
check("research README declares NONRUNTIME_AUTHORITY",()=>{
  const text=fs.readFileSync(path.join(root,"research/README.md"),"utf8");
  assert.ok(text.includes("NONRUNTIME_AUTHORITY"));
  for(const phrase of ["project clinical gold","evidence admission","runtime authority","clinical validity"]) assert.ok(text.toLowerCase().includes(phrase));
});
check("research assertion registry cannot claim authority",()=>{
  const r=readJson("research/RESEARCH_ASSERTION_REGISTRY.json");
  assert.strictEqual(r.project_gold,false);
  assert.strictEqual(r.source_labels_are_project_gold,false);
  assert.strictEqual(r.runtime_authority,false);
  assert.strictEqual(r.clinical_validity_inferred,false);
  assert.strictEqual(r.count,r.assertions.length);
  for(const a of r.assertions){
    assert.strictEqual(a.project_gold,false);
    assert.strictEqual(a.source_labels_are_project_gold,false);
    assert.strictEqual(a.runtime_authority,false);
    assert.strictEqual(a.clinical_validity_inferred,false);
    assert.ok(Array.isArray(a.evidence)&&a.evidence.length>0);
  }
});
check("dataset card index remains non-authoritative",()=>{
  const i=readJson("research/datasets/DATASET_CARD_INDEX.json");
  assert.strictEqual(i.projectGold,false);
  assert.strictEqual(i.sourceLabelsAreProjectGold,false);
  assert.strictEqual(i.runtimeAuthority,false);
  assert.strictEqual(i.clinicalValidityInferred,false);
});
check("research markdown contains no explicit true authority marker",()=>{
  const stack=[path.join(root,"research")];
  while(stack.length){const p=stack.pop(); for(const d of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,d.name); if(d.isDirectory())stack.push(q); else if(d.name.endsWith(".md")){const t=fs.readFileSync(q,"utf8").toLowerCase(); assert.ok(!/project gold:\s*\*\*true\*\*/.test(t),q); assert.ok(!/runtime authority:\s*\*\*true\*\*/.test(t),q); assert.ok(!/clinical validity inferred:\s*\*\*true\*\*/.test(t),q);}}}
});
console.log(JSON.stringify({schema:"ekg-research-authority-tests-v1",pass:true,passed,total:passed,runtime_authority:false,project_gold:false,clinical_validity_inferred:false}));
