"""Immutable image measurements tied to a verified local extraction."""
from pathlib import Path
import re
import tempfile
from image_case import GOVERNANCE,CaseError,canonical,case_path,check,clean_stage,directory,exact,parse_json,publish_stage,read_regular,sha,write_bytes
from image_trace_extraction import open_extraction

ANALYSIS_RE=re.compile(r'analysis-[0-9a-f]{64}\Z')

def inactive_tree(value,depth=0):
    check(depth<=64,'IMAGE_ANALYSIS_STRUCTURE')
    if type(value) is dict:
        for key,child in value.items():
            if key in GOVERNANCE: check(type(child) is type(GOVERNANCE[key]) and child==GOVERNANCE[key],'IMAGE_ANALYSIS_GOVERNANCE')
            inactive_tree(child,depth+1)
    elif type(value) is list:
        for child in value: inactive_tree(child,depth+1)

def validate_analysis(store,case_id,analysis):
    inactive_tree(analysis)
    fields=['schema','caseId','extractionId','sourceSha256','extractionSha256','status','attemptedLeadCount','completeTwelveLead','leadAnalyses','failures','thresholdAuthority','configuration','implementations','simultaneousLeadComparisonPerformed','diagnosticInterpretationIncluded',*GOVERNANCE]
    if type(analysis) is dict and 'analysisId' in analysis: fields.append('analysisId')
    exact(analysis,fields,'IMAGE_ANALYSIS_FIELDS')
    check(type(analysis) is dict and analysis.get('schema')=='ekg-image-signal-analysis-v1' and analysis.get('caseId')==case_id,'IMAGE_ANALYSIS_SCHEMA')
    extraction=open_extraction(store,case_id,analysis.get('extractionId'))
    raw=read_regular(case_path(store,case_id)/'extractions'/extraction['extractionId']/'extraction.json',32*1024*1024)
    check(analysis.get('extractionSha256')==sha(raw) and analysis.get('sourceSha256')==extraction['sourceSha256'],'IMAGE_ANALYSIS_SOURCE')
    for key,value in GOVERNANCE.items(): check(type(analysis.get(key)) is type(value) and analysis[key]==value,'IMAGE_ANALYSIS_GOVERNANCE')
    check(analysis.get('diagnosticInterpretationIncluded') is False and analysis.get('simultaneousLeadComparisonPerformed') is False,'IMAGE_ANALYSIS_GOVERNANCE')
    check(analysis.get('status') in ['COMPLETE','PARTIAL'] and type(analysis.get('leadAnalyses')) is list and len(analysis['leadAnalyses'])>0,'IMAGE_ANALYSIS_RESULT')
    check(type(analysis['failures']) is list and analysis['status']==('PARTIAL' if analysis['failures'] else 'COMPLETE'),'IMAGE_ANALYSIS_RESULT')
    check(type(analysis['attemptedLeadCount']) is int and analysis['attemptedLeadCount']==len(extraction['leads']),'IMAGE_ANALYSIS_LEADS')
    expected={lead['leadName']:lead for lead in extraction['leads']}; seen=set()
    for lead in analysis['leadAnalyses']:
        exact(lead,['leadName','startTimeSeconds','durationSeconds','sourceRegion','calibration','extractionQuality','measurement','features','candidatePhenotypes'],'IMAGE_ANALYSIS_LEAD_FIELDS')
        name=lead['leadName']; check(type(name) is str and name in expected and name not in seen,'IMAGE_ANALYSIS_LEADS'); seen.add(name)
        for key in ['startTimeSeconds','durationSeconds','sourceRegion','calibration']: check(lead[key]==expected[name][key],'IMAGE_ANALYSIS_LEAD_SOURCE')
        check(lead['extractionQuality']==expected[name]['quality'],'IMAGE_ANALYSIS_LEAD_SOURCE')
    for failure in analysis['failures']:
        exact(failure,['leadName','reason'],'IMAGE_ANALYSIS_FAILURE_FIELDS')
        name=failure['leadName']; check(type(name) is str and name in expected and name not in seen and type(failure['reason']) is str,'IMAGE_ANALYSIS_LEADS'); seen.add(name)
    check(seen==set(expected) and type(analysis['completeTwelveLead']) is bool and analysis['completeTwelveLead']==(len(analysis['leadAnalyses'])==12),'IMAGE_ANALYSIS_LEADS')

def save_analysis(store,case_id,analysis):
    check(type(analysis) is dict and 'analysisId' not in analysis,'IMAGE_ANALYSIS_FIELDS')
    validate_analysis(store,case_id,analysis)
    analysis_id='analysis-'+sha(canonical(analysis)); artifact={**analysis,'analysisId':analysis_id}
    raw=canonical(artifact); check(len(raw)<=32*1024*1024,'IMAGE_ANALYSIS_BYTES')
    parent=case_path(store,case_id)/'analyses'; directory(parent,True)
    stage=Path(tempfile.mkdtemp(prefix='.staging-',dir=parent))
    try:
        write_bytes(stage/'analysis.json',raw); destination=parent/analysis_id
        if destination.exists():
            check(open_analysis(store,case_id,analysis_id)==artifact,'IMAGE_ANALYSIS_COLLISION'); clean_stage(stage,parent)
        else:
            try: publish_stage(stage,destination)
            except CaseError:
                if destination.exists() and open_analysis(store,case_id,analysis_id)==artifact: clean_stage(stage,parent)
                else: raise
        return artifact
    except (CaseError,OSError) as exc:
        if stage.exists(): clean_stage(stage,parent)
        if isinstance(exc,CaseError): raise
        raise CaseError('IMAGE_STORE_WRITE_FAILED') from exc

def open_analysis(store,case_id,analysis_id):
    check(type(analysis_id) is str and ANALYSIS_RE.fullmatch(analysis_id),'IMAGE_ANALYSIS_ID')
    parent=case_path(store,case_id)/'analyses'; directory(parent)
    target=parent/analysis_id; directory(target)
    raw=read_regular(target/'analysis.json',32*1024*1024); artifact=parse_json(raw)
    check(type(artifact) is dict and artifact.get('analysisId')==analysis_id and canonical(artifact)==raw,'IMAGE_ANALYSIS_BYTES')
    check('analysis-'+sha(canonical({k:v for k,v in artifact.items() if k!='analysisId'}))==analysis_id,'IMAGE_ANALYSIS_IDENTITY')
    validate_analysis(store,case_id,artifact)
    return artifact
