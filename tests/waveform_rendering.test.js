"use strict";
const assert = require("assert");
const { RENDER_GOVERNANCE, escapeXml, renderWaveformSvg, waveformPath } = require("../lib/waveform_rendering");
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
const leads = [
  { leadName:"I", samples:[0,1,0,-1,0] },
  { leadName:"II", samples:[0,2,0,-2,0] },
];
test("waveform SVG rendering is deterministic", () => {
  const a=renderWaveformSvg({leads}), b=renderWaveformSvg({leads});
  assert.strictEqual(a.svg,b.svg); assert.strictEqual(a.svgSha256,b.svgSha256);
});
test("renderer preserves bounded lead labels and paths", () => {
  const out=renderWaveformSvg({leads});
  assert.ok(out.svg.includes(">I</text>")); assert.ok(out.svg.includes(">II</text>"));
  assert.strictEqual(out.leadCount,2);
});
test("renderer escapes untrusted SVG label text", () => {
  const out=renderWaveformSvg({leads:[{label:"<lead&x>",samples:[0,1]}]});
  assert.ok(out.svg.includes("&lt;lead&amp;x&gt;")); assert.ok(!out.svg.includes("<lead&x>"));
});
test("nonfinite samples fail closed", () => {
  assert.throws(()=>renderWaveformSvg({leads:[{leadName:"I",samples:[0,NaN]}]}),/RENDER_NONFINITE_SAMPLE/);
});
test("render dimensions are explicitly bounded", () => {
  assert.throws(()=>renderWaveformSvg({leads,width:100}),/RENDER_WIDTH_INVALID/);
  assert.throws(()=>renderWaveformSvg({leads,rowHeight:20}),/RENDER_ROW_HEIGHT_INVALID/);
});
test("waveform path handles a flat lead deterministically", () => {
  const p=waveformPath([0,0,0],0,0,100,50);
  assert.strictEqual(p,"M0.00,25.00 L50.00,25.00 L100.00,25.00");
});
test("render governance remains nonclinical engineering only", () => {
  const out=renderWaveformSvg({leads});
  assert.strictEqual(RENDER_GOVERNANCE.runtimeAuthority,false);
  assert.strictEqual(out.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(out.projectGold,false);
  assert.strictEqual(out.metrics,"NOT_REPORTABLE");
  assert.strictEqual(out.activation,"NOT_ELIGIBLE");
  assert.strictEqual(out.diagnosticInterpretationIncluded,false);
});
test("escape helper rejects empty labels", () => {
  assert.throws(()=>escapeXml(""),/RENDER_LABEL_INVALID/);
});
if(process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-waveform-rendering-tests-v1",pass:true,passed,total:passed,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
