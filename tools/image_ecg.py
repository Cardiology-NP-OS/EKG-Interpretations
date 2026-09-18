"""Local photo/PDF case intake and calibrated extraction operator CLI."""
import argparse
import json
import multiprocessing
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'lib'))
from image_case import CaseError,canonical,case_path,list_cases,open_case,ingest_file,read_regular,parse_json,sha
from image_trace_extraction import extract_case,open_extraction
from image_case_analysis import save_analysis,open_analysis

def execute(args):
    if args.action=='save-analysis': return {'analysis':save_analysis(args.store,args.case_id,parse_json(args.analysis_bytes))}
    if args.action=='show-analysis': return {'analysis':open_analysis(args.store,args.case_id,args.analysis_id)}
    if args.action=='ingest': return {'manifest':ingest_file(args.input,args.store,dpi=args.dpi)}
    if args.action=='show': return {'manifest':open_case(args.store,args.case_id)}
    if args.action=='list': return {'cases':list_cases(args.store)}
    if args.action=='extract': return {'extraction':extract_case(args.store,args.case_id,parse_json(read_regular(Path(args.plan),256*1024)))}
    if args.action=='show-extraction':
        artifact=open_extraction(args.store,args.case_id,args.extraction_id)
        raw=read_regular(case_path(args.store,args.case_id)/'extractions'/args.extraction_id/'extraction.json',32*1024*1024)
        return {'extraction':artifact,'extractionSha256':sha(raw)}
    raise CaseError('IMAGE_CLI_ACTION')

def worker(args,connection):
    try:
        result=execute(args)
        connection.send_bytes(canonical({'schema':'ekg-image-operator-result-v1','pass':True,**result}))
    except CaseError as exc: connection.send_bytes(canonical({'schema':'ekg-image-operator-result-v1','pass':False,'reason':str(exc)}))
    except Exception: connection.send_bytes(canonical({'schema':'ekg-image-operator-result-v1','pass':False,'reason':'IMAGE_OPERATION_FAILED'}))
    finally: connection.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='action',required=True)
    for action in ['ingest','show','list','extract','show-extraction','save-analysis','show-analysis']:
        command=commands.add_parser(action); command.add_argument('--store',required=True)
        if action not in ['ingest','list']: command.add_argument('--case-id',required=True)
        if action=='ingest': command.add_argument('--input',required=True); command.add_argument('--dpi',type=int,default=200)
        if action=='extract': command.add_argument('--plan',required=True)
        if action=='show-extraction': command.add_argument('--extraction-id',required=True)
        if action=='show-analysis': command.add_argument('--analysis-id',required=True)
    args=parser.parse_args()
    if args.action=='save-analysis':
        args.analysis_bytes=sys.stdin.buffer.read(32*1024*1024+1)
        if len(args.analysis_bytes)>32*1024*1024:
            print(canonical({'pass':False,'reason':'IMAGE_ANALYSIS_BYTES'}).decode('ascii'),end=''); return 1
    context=multiprocessing.get_context('spawn'); receive,send=context.Pipe(duplex=False)
    process=context.Process(target=worker,args=(args,send)); process.start(); send.close()
    try:
        if not receive.poll(60):
            process.terminate(); process.join(5)
            if process.is_alive(): process.kill(); process.join()
            result={'schema':'ekg-image-operator-result-v1','pass':False,'reason':'IMAGE_OPERATION_TIMEOUT'}
        else:
            try: result=parse_json(receive.recv_bytes(40*1024*1024))
            except (EOFError,OSError,CaseError): result={'schema':'ekg-image-operator-result-v1','pass':False,'reason':'IMAGE_WORKER_FAILED'}
        process.join(5)
        if process.is_alive(): process.terminate(); process.join()
        print(canonical(result).decode('ascii'),end='')
        return 0 if result['pass'] else 1
    finally: receive.close()

if __name__=='__main__': sys.exit(main())
