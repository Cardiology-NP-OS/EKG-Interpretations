"""Calibrated extraction of explicitly selected single-dark-trace regions."""
import io
from pathlib import Path
import re
import tempfile
from PIL import Image, ImageDraw
from image_case import (GOVERNANCE,MAX_ARTIFACT_BYTES,CaseError,canonical,case_path,check,clean_stage,directory,exact,finite,integer,open_case,parse_json,publish_stage,read_regular,save_png,sha,write_bytes)

LEADS={'I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'}
EXTRACTION_RE=re.compile(r'extract-[0-9a-f]{64}\Z')

def validate_plan(plan,manifest):
    exact(plan,['schema','leads'],'IMAGE_EXTRACTION_PLAN_FIELDS')
    check(plan['schema']=='ekg-image-extraction-plan-v1','IMAGE_EXTRACTION_PLAN_SCHEMA')
    check(type(plan['leads']) is list and 1<=len(plan['leads'])<=12,'IMAGE_EXTRACTION_LEADS')
    seen=set(); pixels=0; regions=[]
    for lead in plan['leads']:
        exact(lead,['leadName','pageIndex','roi','startTimeSeconds','calibration','trace'],'IMAGE_EXTRACTION_LEAD_FIELDS')
        check(type(lead['leadName']) is str and lead['leadName'] in LEADS and lead['leadName'] not in seen,'IMAGE_EXTRACTION_LEAD_ID')
        seen.add(lead['leadName'])
        index=integer(lead['pageIndex'],0,len(manifest['pages'])-1,'IMAGE_EXTRACTION_PAGE')
        finite(lead['startTimeSeconds'],0,86400,'IMAGE_EXTRACTION_TIMING')
        page=manifest['pages'][index]; roi=lead['roi']
        exact(roi,['x','y','width','height'],'IMAGE_EXTRACTION_ROI_FIELDS')
        integer(roi['x'],0,page['width']-1,'IMAGE_EXTRACTION_ROI'); integer(roi['y'],0,page['height']-1,'IMAGE_EXTRACTION_ROI')
        integer(roi['width'],3,page['width'],'IMAGE_EXTRACTION_ROI'); integer(roi['height'],3,page['height'],'IMAGE_EXTRACTION_ROI')
        check(roi['x']+roi['width']<=page['width'] and roi['y']+roi['height']<=page['height'],'IMAGE_EXTRACTION_ROI')
        for page_index,other in regions:
            overlap=index==page_index and roi['x']<other['x']+other['width'] and other['x']<roi['x']+roi['width'] and roi['y']<other['y']+other['height'] and other['y']<roi['y']+roi['height']
            check(not overlap,'IMAGE_EXTRACTION_OVERLAPPING_ROI')
        regions.append((index,roi))
        pixels+=roi['width']*roi['height']; check(pixels<=12_000_000,'IMAGE_EXTRACTION_PIXEL_BUDGET')
        calibration=lead['calibration']
        exact(calibration,['confirmed','pixelsPerSecond','pixelsPerMv','baselineYPx','positiveUp'],'IMAGE_EXTRACTION_CALIBRATION_FIELDS')
        check(calibration['confirmed'] is True and type(calibration['positiveUp']) is bool,'IMAGE_EXTRACTION_CALIBRATION_CONFIRMATION')
        finite(calibration['pixelsPerSecond'],1,100000,'IMAGE_EXTRACTION_CALIBRATION')
        finite(calibration['pixelsPerMv'],.01,100000,'IMAGE_EXTRACTION_CALIBRATION')
        finite(calibration['baselineYPx'],0,roi['height']-1,'IMAGE_EXTRACTION_CALIBRATION')
        exact(lead['trace'],['maxChannelValue','maxThicknessPx'],'IMAGE_EXTRACTION_TRACE_FIELDS')
        integer(lead['trace']['maxChannelValue'],0,200,'IMAGE_EXTRACTION_TRACE_THRESHOLD')
        integer(lead['trace']['maxThicknessPx'],1,min(100,roi['height']-2),'IMAGE_EXTRACTION_TRACE_THICKNESS')

def extract_region(image,spec):
    roi=spec['roi']; calibration=spec['calibration']; pixels=image.load()
    samples=[]; points=[]; thicknesses=[]
    for x in range(roi['width']):
        ys=[y for y in range(roi['height']) if max(pixels[roi['x']+x,roi['y']+y])<=spec['trace']['maxChannelValue']]
        check(bool(ys),'IMAGE_TRACE_MISSING')
        check(ys[0]>0 and ys[-1]<roi['height']-1,'IMAGE_TRACE_CLIPPED')
        check(all(b==a+1 for a,b in zip(ys,ys[1:])),'IMAGE_TRACE_AMBIGUOUS')
        check(len(ys)<=spec['trace']['maxThicknessPx'],'IMAGE_TRACE_THICKNESS')
        center=(ys[0]+ys[-1])/2
        value=(calibration['baselineYPx']-center)/calibration['pixelsPerMv']
        if not calibration['positiveUp']: value=-value
        samples.append(value); points.append([roi['x']+x,roi['y']+center]); thicknesses.append(len(ys))
    return {'leadName':spec['leadName'],'pageIndex':spec['pageIndex'],'sampleRateHz':calibration['pixelsPerSecond'],'unit':'mV','startTimeSeconds':spec['startTimeSeconds'],'durationSeconds':len(samples)/calibration['pixelsPerSecond'],'samples':samples,'sourceRegion':roi,'calibration':calibration,'tracePoints':points,'quality':{'scope':'SINGLE_DARK_TRACE_IN_USER_SELECTED_CALIBRATED_ROI','coverage':1,'interpolatedColumns':0,'maxStrokeThicknessPx':max(thicknesses),'maxAmplitudeUncertaintyMv':max(thicknesses)/2/calibration['pixelsPerMv'],'timePixelUncertaintyMs':500/calibration['pixelsPerSecond'],'calibrationUncertaintyQuantified':False}}

def extract_case(store,case_id,plan):
    manifest=open_case(store,case_id); validate_plan(plan,manifest)
    target=case_path(store,case_id); images={}; leads=[]
    try:
        for spec in plan['leads']:
            index=spec['pageIndex']
            if index not in images:
                images[index]=Image.open(io.BytesIO(read_regular(target/manifest['pages'][index]['file'],MAX_ARTIFACT_BYTES))).convert('RGB')
            leads.append(extract_region(images[index],spec))
        # Publish only after every requested region has a complete usable path.
        parent=target/'extractions'; directory(parent,True)
        stage=Path(tempfile.mkdtemp(prefix='.staging-',dir=parent))
        try:
            overlays=[]
            for index,image in sorted(images.items()):
                draw=ImageDraw.Draw(image)
                for lead in leads:
                    if lead['pageIndex']!=index: continue
                    roi=lead['sourceRegion']
                    draw.rectangle((roi['x'],roi['y'],roi['x']+roi['width']-1,roi['y']+roi['height']-1),outline=(0,80,255),width=2)
                    draw.line([tuple(point) for point in lead['tracePoints']],fill=(255,0,0),width=2)
                name=f'overlay-page-{index+1:04d}.png'
                overlays.append({'pageIndex':index,'file':name,'sha256':save_png(stage/name,image)})
            payload={'schema':'ekg-image-extraction-v1','caseId':case_id,'sourceSha256':manifest['sourceSha256'],'sourceRasterHashes':[page['rasterSha256'] for page in manifest['pages']],'plan':plan,'planSha256':sha(canonical(plan)),'implementationSha256':sha(Path(__file__).read_bytes()),'calibrationUserConfirmed':True,'automaticLeadIdentification':False,'automaticCalibration':False,'perspectiveCorrectionPerformed':False,'simultaneousLeadComparisonPerformed':False,'leads':leads,'overlays':overlays,**GOVERNANCE}
            extraction_id='extract-'+sha(canonical(payload)); artifact={**payload,'extractionId':extraction_id}
            write_bytes(stage/'extraction.json',canonical(artifact))
            destination=parent/extraction_id
            if destination.exists():
                check(open_extraction(store,case_id,extraction_id)==artifact,'IMAGE_EXTRACTION_COLLISION'); clean_stage(stage,parent)
            else:
                try: publish_stage(stage,destination)
                except CaseError:
                    if destination.exists() and open_extraction(store,case_id,extraction_id)==artifact: clean_stage(stage,parent)
                    else: raise
            return artifact
        except (CaseError,OSError) as exc:
            if stage.exists(): clean_stage(stage,parent)
            if isinstance(exc,CaseError): raise
            raise CaseError('IMAGE_STORE_WRITE_FAILED') from exc
    finally:
        for image in images.values(): image.close()

def open_extraction(store,case_id,extraction_id):
    check(type(extraction_id) is str and EXTRACTION_RE.fullmatch(extraction_id),'IMAGE_EXTRACTION_ID')
    manifest=open_case(store,case_id); parent=case_path(store,case_id)/'extractions'; directory(parent)
    target=parent/extraction_id; directory(target)
    raw=read_regular(target/'extraction.json',32*1024*1024); artifact=parse_json(raw)
    check(type(artifact) is dict and artifact.get('schema')=='ekg-image-extraction-v1' and artifact.get('caseId')==case_id and artifact.get('extractionId')==extraction_id,'IMAGE_EXTRACTION_MANIFEST')
    check(canonical(artifact)==raw,'IMAGE_EXTRACTION_MANIFEST_BYTES')
    check('extract-'+sha(canonical({k:v for k,v in artifact.items() if k!='extractionId'}))==extraction_id,'IMAGE_EXTRACTION_IDENTITY')
    check(artifact['sourceSha256']==manifest['sourceSha256'] and artifact['sourceRasterHashes']==[p['rasterSha256'] for p in manifest['pages']],'IMAGE_EXTRACTION_SOURCE')
    check(artifact['planSha256']==sha(canonical(artifact['plan'])),'IMAGE_EXTRACTION_PLAN_IDENTITY')
    validate_plan(artifact['plan'],manifest)
    for key,value in GOVERNANCE.items(): check(type(artifact.get(key)) is type(value) and artifact[key]==value,'IMAGE_EXTRACTION_GOVERNANCE')
    for overlay in artifact['overlays']:
        index=integer(overlay['pageIndex'],0,len(manifest['pages'])-1,'IMAGE_EXTRACTION_PAGE')
        check(overlay['file']==f'overlay-page-{index+1:04d}.png','IMAGE_EXTRACTION_OVERLAY_PATH')
        check(sha(read_regular(target/overlay['file'],MAX_ARTIFACT_BYTES))==overlay['sha256'],'IMAGE_EXTRACTION_OVERLAY_MISMATCH')
    return artifact
