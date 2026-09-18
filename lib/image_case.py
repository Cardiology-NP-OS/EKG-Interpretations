"""Byte-preserving image/PDF intake and atomically published local cases."""
import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import warnings
from contextlib import closing

from PIL import Image, ImageOps, UnidentifiedImageError
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw

GOVERNANCE = {'runtimeAuthority':False,'projectGold':False,'diagnosticRuntime':'GOVERNED_INACTIVE','evidenceAdmission':'NOT_ADMITTED','metrics':'NOT_REPORTABLE','activation':'NOT_ELIGIBLE','clinicalValidityInferred':False}
LIMITS = {'maxInputBytes':32*1024*1024,'maxPages':8,'maxPagePixels':24_000_000,'maxTotalPixels':48_000_000,'maxDimension':10000}
MAX_ARTIFACT_BYTES = 160*1024*1024
CASE_RE = re.compile(r'case-[0-9a-f]{64}\Z')
HASH_RE = re.compile(r'[0-9a-f]{64}\Z')

class CaseError(ValueError): pass
def check(condition,code):
    if not condition: raise CaseError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def canonical(obj):
    try: return (json.dumps(obj,sort_keys=True,separators=(',',':'),allow_nan=False,ensure_ascii=True)+'\n').encode('ascii')
    except (ValueError,TypeError,RecursionError) as exc: raise CaseError('IMAGE_JSON_INVALID') from exc
def parse_json(raw):
    def fields(pairs):
        result={}
        for key,value in pairs:
            if key in result: raise ValueError('duplicate key')
            result[key]=value
        return result
    def number(text):
        value=float(text)
        if not math.isfinite(value): raise ValueError('nonfinite')
        return value
    try: return json.loads(raw,object_pairs_hook=fields,parse_float=number,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite')))
    except (ValueError,TypeError,RecursionError,UnicodeError) as exc: raise CaseError('IMAGE_JSON_INVALID') from exc
def exact(obj,keys,code): check(type(obj) is dict and set(obj)==set(keys),code)
def finite(value,minimum,maximum,code):
    check(type(value) in (int,float) and math.isfinite(value) and minimum<=value<=maximum,code)
    return value
def integer(value,minimum,maximum,code):
    check(type(value) is int and minimum<=value<=maximum,code)
    return value
def regular(path):
    info=path.lstat()
    check(stat.S_ISREG(info.st_mode) and not (getattr(info,'st_file_attributes',0)&0x400),'IMAGE_STORE_REGULAR_FILE_REQUIRED')
    return info
def read_regular(path,max_bytes):
    try:
        info=regular(path)
        check(info.st_size<=max_bytes,'IMAGE_INPUT_BYTES_LIMIT')
        with path.open('rb') as stream:
            opened=os.fstat(stream.fileno())
            check(stat.S_ISREG(opened.st_mode),'IMAGE_STORE_REGULAR_FILE_REQUIRED')
            identity=lambda item:(item.st_dev,item.st_ino,item.st_size,item.st_mtime_ns)
            check(identity(info)==identity(opened),'IMAGE_STORE_FILE_CHANGED')
            raw=stream.read(max_bytes+1)
            check(identity(opened)==identity(os.fstat(stream.fileno())),'IMAGE_STORE_FILE_CHANGED')
        check(len(raw)<=max_bytes,'IMAGE_INPUT_BYTES_LIMIT')
        return raw
    except CaseError: raise
    except OSError as exc: raise CaseError('IMAGE_STORE_READ_FAILED') from exc
def directory(path,create=False):
    try:
        if create: path.mkdir(parents=True,exist_ok=True)
        info=path.lstat()
        check(stat.S_ISDIR(info.st_mode) and not (getattr(info,'st_file_attributes',0)&0x400),'IMAGE_STORE_DIRECTORY_REQUIRED')
    except CaseError: raise
    except OSError as exc: raise CaseError('IMAGE_STORE_DIRECTORY_FAILED') from exc
def root_path(store,create=False):
    path=Path(store).absolute()
    directory(path,create)
    return path
def case_path(store,case_id):
    check(type(case_id) is str and CASE_RE.fullmatch(case_id),'IMAGE_CASE_ID')
    root=root_path(store)
    target=root/case_id
    directory(target)
    return target
def write_bytes(path,raw):
    with path.open('xb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
def save_png(path,image):
    clean=Image.new('RGB',image.size,'white'); clean.paste(image)
    stream=io.BytesIO(); clean.save(stream,format='PNG',compress_level=6)
    raw=stream.getvalue(); check(len(raw)<=MAX_ARTIFACT_BYTES,'IMAGE_OUTPUT_BYTES_LIMIT')
    write_bytes(path,raw)
    return sha(raw)
def sync_directory(path):
    # POSIX supports directory fsync; Windows publication relies on atomic rename
    # and flushed files. Hardware/power-loss guarantees are filesystem dependent.
    if os.name=='nt': return
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
    try: os.fsync(fd)
    finally: os.close(fd)
def clean_stage(stage,root):
    # Only remove regular files in the exact flat temporary directory we created.
    check(stage.parent.resolve()==root.resolve() and stage.name.startswith('.staging-'),'IMAGE_STAGE_SCOPE')
    try:
        directory(stage)
        for item in stage.iterdir():
            regular(item); item.unlink()
        stage.rmdir()
    except (OSError,CaseError): pass
def publish_stage(stage,destination):
    try:
        sync_directory(stage)
        os.rename(stage,destination)
        sync_directory(destination.parent)
    except OSError as exc: raise CaseError('IMAGE_STORE_WRITE_FAILED') from exc
def policy(dpi,limits):
    integer(dpi,72,600,'IMAGE_PDF_DPI')
    values=dict(LIMITS)
    if limits is not None:
        check(type(limits) is dict and set(limits)<=set(LIMITS),'IMAGE_LIMIT_POLICY')
        for key,value in limits.items(): values[key]=integer(value,1,LIMITS[key],'IMAGE_LIMIT_POLICY')
    return {'pdfDpi':dpi,'limits':values,'orientation':'EXIF_TRANSPOSE_AND_PDF_PAGE_ROTATION','raster':'RGB8_PNG_WHITE_ALPHA_BACKGROUND'}
def dimensions(width,height,limits,total=0):
    integer(width,1,limits['maxDimension'],'IMAGE_PIXELS_LIMIT')
    integer(height,1,limits['maxDimension'],'IMAGE_PIXELS_LIMIT')
    check(width*height<=limits['maxPagePixels'] and total+width*height<=limits['maxTotalPixels'],'IMAGE_PIXELS_LIMIT')
def decoded_pages(raw,settings):
    limits=settings['limits']
    if raw.startswith(b'%PDF-'):
        try:
            with pdfium.PdfDocument(raw) as document:
                check(pdfium_raw.FPDF_GetSecurityHandlerRevision(document)<0,'IMAGE_PDF_ENCRYPTED')
                check(document.get_formtype()==0,'IMAGE_PDF_FORMS_UNSUPPORTED')
                check(1<=len(document)<=limits['maxPages'],'IMAGE_PAGE_LIMIT')
                total=0
                for index in range(len(document)):
                    with closing(document[index]) as page:
                        width,height=page.get_size(); scale=settings['pdfDpi']/72
                        finite(width,1,100000,'IMAGE_PIXELS_LIMIT'); finite(height,1,100000,'IMAGE_PIXELS_LIMIT')
                        dimensions(math.ceil(width*scale),math.ceil(height*scale),limits,total)
                        with closing(page.render(scale=scale,draw_annots=True)) as bitmap:
                            image=bitmap.to_pil().convert('RGB')
                            dimensions(*image.size,limits,total)
                            total+=image.width*image.height
                            yield 'PDF',image,0
                            image.close()
        except CaseError: raise
        except Exception as exc: raise CaseError('IMAGE_PDF_INVALID') from exc
    else:
        check(raw.startswith(b'\x89PNG\r\n\x1a\n') or raw.startswith(b'\xff\xd8'),'IMAGE_FORMAT_UNSUPPORTED')
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error',Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(raw),formats=['PNG','JPEG']) as source:
                    dimensions(*source.size,limits)
                    check(getattr(source,'n_frames',1)==1,'IMAGE_ANIMATION_UNSUPPORTED')
                    orientation=source.getexif().get(274,1)
                    source.load()
                    oriented=ImageOps.exif_transpose(source)
                    rgba=oriented.convert('RGBA')
                    background=Image.new('RGBA',rgba.size,'white')
                    image=Image.alpha_composite(background,rgba).convert('RGB')
                    yield source.format,image,orientation
                    image.close(); background.close(); rgba.close(); oriented.close()
        except CaseError: raise
        except (Image.DecompressionBombWarning,Image.DecompressionBombError) as exc: raise CaseError('IMAGE_PIXELS_LIMIT') from exc
        except (OSError,ValueError,UnidentifiedImageError) as exc: raise CaseError('IMAGE_DECODE_FAILED') from exc

def ingest_file(source,store,dpi=200,limits=None):
    settings=policy(dpi,limits)
    raw=read_regular(Path(source),settings['limits']['maxInputBytes'])
    check(bool(raw),'IMAGE_INPUT_EMPTY')
    root=root_path(store,True)
    stage=Path(tempfile.mkdtemp(prefix='.staging-',dir=root))
    try:
        write_bytes(stage/'original.bin',raw)
        pages=[]; source_kind=None
        for index,(source_kind,image,orientation) in enumerate(decoded_pages(raw,settings)):
            name=f'page-{index+1:04d}.png'
            pages.append({'pageIndex':index,'file':name,'width':image.width,'height':image.height,'originalOrientation':orientation,'rasterSha256':save_png(stage/name,image)})
        check(bool(pages),'IMAGE_PAGE_LIMIT')
        payload={'schema':'ekg-image-case-v1','sourceKind':source_kind,'sourceSha256':sha(raw),'sourceBytes':len(raw),'policy':settings,'decoder':{'Pillow':importlib.metadata.version('Pillow'),'pypdfium2':str(pdfium.PYPDFIUM_INFO),'pdfium':str(pdfium.PDFIUM_INFO),'implementationSha256':sha(Path(__file__).read_bytes())},'pages':pages,**GOVERNANCE}
        case_id='case-'+sha(canonical(payload)); manifest={**payload,'caseId':case_id}
        write_bytes(stage/'manifest.json',canonical(manifest))
        destination=root/case_id
        if destination.exists():
            check(open_case(root,case_id)==manifest,'IMAGE_CASE_COLLISION')
            clean_stage(stage,root)
        else:
            try: publish_stage(stage,destination)
            except CaseError:
                if destination.exists() and open_case(root,case_id)==manifest: clean_stage(stage,root)
                else: raise
        return manifest
    except CaseError:
        if stage.exists(): clean_stage(stage,root)
        raise
    except OSError as exc:
        if stage.exists(): clean_stage(stage,root)
        raise CaseError('IMAGE_STORE_WRITE_FAILED') from exc

def open_case(store,case_id):
    target=case_path(store,case_id)
    raw=read_regular(target/'manifest.json',128*1024)
    manifest=parse_json(raw)
    check(type(manifest) is dict and manifest.get('caseId')==case_id and manifest.get('schema')=='ekg-image-case-v1','IMAGE_CASE_MANIFEST')
    check(canonical(manifest)==raw,'IMAGE_CASE_MANIFEST_BYTES')
    payload={k:v for k,v in manifest.items() if k!='caseId'}
    check('case-'+sha(canonical(payload))==case_id,'IMAGE_CASE_MANIFEST_IDENTITY')
    for key,value in GOVERNANCE.items(): check(type(manifest.get(key)) is type(value) and manifest[key]==value,'IMAGE_CASE_GOVERNANCE')
    settings=manifest['policy']; validated=policy(settings['pdfDpi'],settings['limits'])
    check(settings==validated,'IMAGE_CASE_POLICY')
    original=read_regular(target/'original.bin',settings['limits']['maxInputBytes'])
    check(sha(original)==manifest['sourceSha256'] and len(original)==manifest['sourceBytes'],'IMAGE_CASE_SOURCE_MISMATCH')
    check(type(manifest['pages']) is list and 1<=len(manifest['pages'])<=settings['limits']['maxPages'],'IMAGE_CASE_PAGES')
    total=0
    for index,page in enumerate(manifest['pages']):
        exact(page,['pageIndex','file','width','height','originalOrientation','rasterSha256'],'IMAGE_CASE_PAGE_FIELDS')
        check(page['pageIndex']==index and page['file']==f'page-{index+1:04d}.png','IMAGE_CASE_PAGE_PATH')
        dimensions(page['width'],page['height'],settings['limits'],total); total+=page['width']*page['height']
        raster=read_regular(target/page['file'],MAX_ARTIFACT_BYTES)
        check(sha(raster)==page['rasterSha256'],'IMAGE_CASE_RASTER_MISMATCH')
        try:
            with Image.open(io.BytesIO(raster),formats=['PNG']) as image:
                check(image.mode=='RGB' and image.size==(page['width'],page['height']),'IMAGE_CASE_RASTER_GEOMETRY')
                image.verify()
        except (OSError,ValueError) as exc: raise CaseError('IMAGE_CASE_RASTER_INVALID') from exc
    return manifest

def list_cases(store):
    if not Path(store).exists(): return []
    root=root_path(store); rows=[]
    for path in sorted(root.iterdir()):
        if not CASE_RE.fullmatch(path.name): continue
        try:
            manifest=open_case(root,path.name)
            rows.append({'caseId':path.name,'sourceKind':manifest['sourceKind'],'status':'COMPLETE'})
        except CaseError as exc: rows.append({'caseId':path.name,'status':'CORRUPT','reason':str(exc)})
    return rows
