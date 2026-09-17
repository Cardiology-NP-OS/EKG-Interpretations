"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"); const root=path.resolve(__dirname,"..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,"")); let passed=0; const check=(n,f)=>{f();passed++;console.log("PASS "+n)};
const c=read("ECG_EDGE_CASE_COVERAGE.json");
check("edge coverage remains governed inactive",()=>{assert.strictEqual(c.authority.diagnostic_runtime,"GOVERNED_INACTIVE");assert.strictEqual(c.authority.project_gold,false);assert.strictEqual(c.authority.metrics,"NOT_REPORTABLE")});
check("edge categories are unique and broad",()=>{assert.ok(c.categories.length>=14);assert.strictEqual(new Set(c.categories.map(x=>x.id)).size,c.categories.length)});
check("every declared edge test exists",()=>{for(const x of c.categories)for(const t of x.tests)assert.ok(fs.existsSync(path.join(root,t)),`${x.id}: ${t}`)});
check("critical adversarial domains are explicit",()=>{for(const id of ["SOURCE-PROVENANCE","STRUCTURED-INPUT-ADVERSARIAL","WFDB-FORMAT","DATASET-SPLITS","MODEL-ASSETS","GOVERNANCE","HANDOFF-CONTINUITY"])assert.ok(c.categories.some(x=>x.id===id),id)});
console.log(JSON.stringify({schema:"ekg-edge-case-coverage-tests-v1",pass:true,passed,total:passed,categories:c.categories.length}));
