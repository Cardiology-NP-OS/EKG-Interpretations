"use strict";

const { normalizeImage } = require("./image_robustness");
const { STANDARD_LEADS } = require("./paper_ecg_raster");

const LEAD_IDENTITY_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

const GLYPHS = Object.freeze({
  I:["11111","00100","00100","00100","00100","00100","11111"],
  V:["10001","10001","10001","10001","01010","01010","00100"],
  a:["00000","01110","00001","01111","10001","10011","01101"],
  R:["11110","10001","10001","11110","10100","10010","10001"],
  L:["10000","10000","10000","10000","10000","10000","11111"],
  F:["11111","10000","10000","11110","10000","10000","10000"],
  "1":["00100","01100","00100","00100","00100","00100","01110"],
  "2":["01110","10001","00001","00010","00100","01000","11111"],
  "3":["11110","00001","00001","01110","00001","00001","11110"],
  "4":["00010","00110","01010","10010","11111","00010","00010"],
  "5":["11111","10000","10000","11110","00001","00001","11110"],
  "6":["01110","10000","10000","11110","10001","10001","01110"],
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function labelPattern(label, spacing = 1) {
  requireCondition(typeof label === "string" && label.length >= 1 && label.length <= 3, "LEAD_LABEL_REQUIRED");
  const chars = [...label];
  requireCondition(chars.every(ch => GLYPHS[ch]), "LEAD_LABEL_GLYPH_UNSUPPORTED");
  const height = 7;
  const width = chars.length * 5 + (chars.length - 1) * spacing;
  const matrix = Array.from({ length: height }, () => Array(width).fill(0));
  chars.forEach((ch,index)=>{
    const glyph=GLYPHS[ch];
    const x0=index*(5+spacing);
    for(let y=0;y<height;y+=1){
      for(let x=0;x<5;x+=1) matrix[y][x0+x]=glyph[y][x]==="1"?1:0;
    }
  });
  return matrix;
}

function renderLeadLabel(image, label, x, y, options = {}) {
  const source = image;
  requireCondition(Array.isArray(source) && source.length>0 && Array.isArray(source[0]), "LEAD_LABEL_IMAGE");
  const scale = options.scale === undefined ? 2 : options.scale;
  const value = options.value === undefined ? 8 : options.value;
  requireCondition(Number.isInteger(scale) && scale>=1 && scale<=4, "LEAD_LABEL_SCALE");
  requireCondition(Number.isInteger(value) && value>=0 && value<=80, "LEAD_LABEL_VALUE");
  const pattern=labelPattern(label);
  for(let py=0;py<pattern.length;py+=1){
    for(let px=0;px<pattern[0].length;px+=1){
      if(!pattern[py][px]) continue;
      for(let dy=0;dy<scale;dy+=1){
        for(let dx=0;dx<scale;dx+=1){
          const tx=x+px*scale+dx, ty=y+py*scale+dy;
          if(ty>=0&&ty<source.length&&tx>=0&&tx<source[0].length){
            source[ty][tx]=Math.min(source[ty][tx],value);
          }
        }
      }
    }
  }
  return source;
}

function templateScore(image, pattern, x0, y0, scale, darkThreshold) {
  let expectedDark=0, matchedDark=0, unexpectedDark=0, backgroundCells=0;
  const h=pattern.length, w=pattern[0].length;
  for(let py=0;py<h;py+=1){
    for(let px=0;px<w;px+=1){
      let dark=false;
      for(let dy=0;dy<scale&&!dark;dy+=1){
        for(let dx=0;dx<scale;dx+=1){
          const x=x0+px*scale+dx, y=y0+py*scale+dy;
          if(y<0||y>=image.length||x<0||x>=image[0].length) return null;
          if(image[y][x]<=darkThreshold){dark=true;break;}
        }
      }
      if(pattern[py][px]){
        expectedDark+=1;
        if(dark) matchedDark+=1;
      } else {
        backgroundCells+=1;
        if(dark) unexpectedDark+=1;
      }
    }
  }
  const recall=expectedDark?matchedDark/expectedDark:0;
  const backgroundClean=backgroundCells?1-unexpectedDark/backgroundCells:1;
  return {score:0.8*recall+0.2*backgroundClean,recall,backgroundClean};
}

function verifyLeadLabelsFromRaster(input) {
  requireCondition(input&&typeof input==="object"&&!Array.isArray(input), "LEAD_IDENTITY_INPUT_REQUIRED");
  const image=normalizeImage(input.image);
  requireCondition(Array.isArray(input.rois)&&input.rois.length>=1&&input.rois.length<=64, "LEAD_IDENTITY_ROIS_REQUIRED");
  const scale=input.scale===undefined?2:input.scale;
  const darkThreshold=input.darkThreshold===undefined?80:input.darkThreshold;
  const searchRadius=input.searchRadius===undefined?6:input.searchRadius;
  const minScore=input.minScore===undefined?0.9:input.minScore;
  requireCondition(Number.isInteger(scale)&&scale>=1&&scale<=4, "LEAD_IDENTITY_SCALE");
  requireCondition(Number.isInteger(darkThreshold)&&darkThreshold>=0&&darkThreshold<=160, "LEAD_IDENTITY_THRESHOLD");
  requireCondition(Number.isInteger(searchRadius)&&searchRadius>=0&&searchRadius<=20, "LEAD_IDENTITY_SEARCH_RADIUS");
  requireCondition(typeof minScore==="number"&&Number.isFinite(minScore)&&minScore>=0.5&&minScore<=1, "LEAD_IDENTITY_MIN_SCORE");

  const results=input.rois.map((roi)=>{
    requireCondition(roi&&typeof roi==="object"&&typeof roi.lead==="string", "LEAD_IDENTITY_ROI");
    requireCondition(STANDARD_LEADS.includes(roi.lead), "LEAD_IDENTITY_STANDARD_LEAD");
    const pattern=labelPattern(roi.lead);
    const anchorX=roi.x+(input.offsetX===undefined?4:input.offsetX);
    const anchorY=roi.y+(input.offsetY===undefined?-18:input.offsetY);
    let best=null;
    for(let dy=-searchRadius;dy<=searchRadius;dy+=1){
      for(let dx=-searchRadius;dx<=searchRadius;dx+=1){
        const scored=templateScore(image,pattern,anchorX+dx,anchorY+dy,scale,darkThreshold);
        if(!scored) continue;
        const candidate={x:anchorX+dx,y:anchorY+dy,...scored};
        if(!best||candidate.score>best.score) best=candidate;
      }
    }
    requireCondition(best, "LEAD_IDENTITY_LABEL_SEARCH_BOUNDS");
    return {
      lead:roi.lead,
      row:roi.row,
      col:roi.col,
      rhythmStrip:roi.rhythmStrip===true,
      matched:best.score>=minScore,
      score:best.score,
      recall:best.recall,
      backgroundClean:best.backgroundClean,
      x:best.x,
      y:best.y,
    };
  });
  const failed=results.filter(r=>!r.matched);
  const panelLeads=new Set(results.filter(r=>!r.rhythmStrip&&r.matched).map(r=>r.lead));
  const missingStandardLeads=STANDARD_LEADS.filter(lead=>!panelLeads.has(lead));
  return {
    schema:"ekg-image-lead-identity-v1",
    method:"STRICT_BITMAP_LABEL_TEMPLATE_V1",
    verified:failed.length===0&&missingStandardLeads.length===0,
    verifiedLeadCount:results.filter(r=>r.matched).length,
    totalLeadCount:results.length,
    failedLabels:failed.map(r=>r.lead),
    missingStandardLeads,
    minScore,
    darkThreshold,
    scale,
    searchRadius,
    results,
    ...LEAD_IDENTITY_GOVERNANCE,
  };
}

module.exports={
  GLYPHS,
  LEAD_IDENTITY_GOVERNANCE,
  labelPattern,
  renderLeadLabel,
  templateScore,
  verifyLeadLabelsFromRaster,
};
