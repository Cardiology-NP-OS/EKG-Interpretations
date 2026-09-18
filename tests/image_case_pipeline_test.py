"""Real decoder, persistence, extraction, and failure tests; generated fixtures only."""
import copy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw
REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO/'lib'))

def waveform():
    peaks = [150, 350, 550, 750]
    return [sum(1.2*math.exp(-((i-r)/4)**2/2) + .23*math.exp(-((i-(r-40))/9)**2/2) + .35*math.exp(-((i-(r+50))/14)**2/2) for r in peaks) for i in range(1000)]

def fixture_image():
    image = Image.new('RGB', (1020, 280), 'white')
    draw = ImageDraw.Draw(image)
    for x in range(10,1010,10): draw.line((x,10,x,269),fill=(245,205,205))
    for y in range(10,270,10): draw.line((10,y,1009,y),fill=(245,205,205))
    samples = waveform()
    draw.line([(10+i,140-round(v*80)) for i,v in enumerate(samples)],fill=(0,0,0),width=3)
    return image, samples

def extraction_plan():
    return {'schema':'ekg-image-extraction-plan-v1','leads':[{'leadName':'II','pageIndex':0,'roi':{'x':10,'y':10,'width':1000,'height':260},'startTimeSeconds':0,'calibration':{'confirmed':True,'pixelsPerSecond':250,'pixelsPerMv':80,'baselineYPx':130,'positiveUp':True},'trace':{'maxChannelValue':120,'maxThicknessPx':60}}]}

class ImageCaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)/'cases'
        self.png = Path(self.temp.name)/'input.png'
        self.image, self.truth = fixture_image()
        self.image.save(self.png)

    def tearDown(self): self.temp.cleanup()

    def cli(self,*args,input_text=None):
        return subprocess.run([sys.executable,str(REPO/'tools/image_ecg.py'),*args],input=input_text,text=True,capture_output=True,timeout=75)

    def ingest(self,source=None,**kwargs):
        from image_case import ingest_file
        return ingest_file(source or self.png,self.root,**kwargs)

    def extract(self,case=None,plan=None):
        from image_trace_extraction import extract_case
        return extract_case(self.root,(case or self.ingest())['caseId'],plan or extraction_plan())

    def test_cli_real_png_intake_and_reopen_in_new_process(self):
        first=self.cli('ingest','--input',str(self.png),'--store',str(self.root))
        self.assertEqual(first.returncode,0,first.stderr)
        manifest=json.loads(first.stdout)['manifest']
        second=self.cli('show','--case-id',manifest['caseId'],'--store',str(self.root))
        self.assertEqual(second.returncode,0,second.stderr)
        self.assertEqual(json.loads(second.stdout)['manifest'],manifest)
        self.assertEqual((self.root/manifest['caseId']/'original.bin').read_bytes(),self.png.read_bytes())
        self.assertFalse(manifest['runtimeAuthority'])

    def test_duplicate_intake_is_idempotent_and_names_are_not_embedded(self):
        a,b=self.ingest(),self.ingest()
        self.assertEqual(a,b)
        self.assertEqual(len(list(self.root.glob('case-*'))),1)
        self.assertNotIn(str(self.png),json.dumps(a))
        self.assertNotIn('input.png',json.dumps(a))

    def test_jpeg_exif_orientation_is_normalized_without_changing_original(self):
        path=Path(self.temp.name)/'rotated.jpg'
        image=Image.new('RGB',(40,20),'white'); ImageDraw.Draw(image).rectangle((0,0,9,9),fill='black')
        exif=Image.Exif(); exif[274]=6
        image.save(path,exif=exif)
        manifest=self.ingest(path)
        self.assertEqual((manifest['pages'][0]['width'],manifest['pages'][0]['height']),(20,40))
        with Image.open(self.root/manifest['caseId']/manifest['pages'][0]['file']) as out:
            self.assertFalse(out.getexif()); self.assertEqual(out.mode,'RGB')
            self.assertLess(max(out.getpixel((15,5))),50); self.assertGreater(min(out.getpixel((5,35))),200)
        self.assertEqual((self.root/manifest['caseId']/'original.bin').read_bytes(),path.read_bytes())

    def test_transparency_is_flattened_on_white(self):
        image=Image.new('RGBA',(10,10),(0,0,0,0)); image.putpixel((5,5),(0,0,0,255))
        path=Path(self.temp.name)/'transparent.png'; image.save(path)
        manifest=self.ingest(path)
        with Image.open(self.root/manifest['caseId']/manifest['pages'][0]['file']) as out:
            self.assertEqual(out.getpixel((0,0)),(255,255,255)); self.assertEqual(out.getpixel((5,5)),(0,0,0))

    def test_real_pdf_pages_are_rasterized_and_preserved(self):
        path=Path(self.temp.name)/'two-pages.pdf'
        self.image.save(path,'PDF',resolution=72,save_all=True,append_images=[Image.new('RGB',(100,60),'white')])
        manifest=self.ingest(path,dpi=72)
        self.assertEqual(manifest['sourceKind'],'PDF')
        self.assertEqual([(p['width'],p['height']) for p in manifest['pages']],[(1020,280),(100,60)])
        self.assertEqual((self.root/manifest['caseId']/'original.bin').read_bytes(),path.read_bytes())

    def test_input_and_pdf_page_pixel_budgets_fail_before_publication(self):
        from image_case import CaseError
        with self.assertRaisesRegex(CaseError,'IMAGE_INPUT_BYTES_LIMIT'): self.ingest(limits={'maxInputBytes':100})
        with self.assertRaisesRegex(CaseError,'IMAGE_PIXELS_LIMIT'): self.ingest(limits={'maxPagePixels':100})
        path=Path(self.temp.name)/'large.pdf'; self.image.save(path,'PDF',resolution=72)
        with self.assertRaisesRegex(CaseError,'IMAGE_PIXELS_LIMIT'): self.ingest(path,dpi=72,limits={'maxPagePixels':100})
        self.assertEqual(list(self.root.glob('case-*')),[])

    def test_pdf_page_count_limit(self):
        from image_case import CaseError
        path=Path(self.temp.name)/'two.pdf'; self.image.save(path,'PDF',save_all=True,append_images=[self.image])
        with self.assertRaisesRegex(CaseError,'IMAGE_PAGE_LIMIT'): self.ingest(path,limits={'maxPages':1})

    def test_corrupt_and_unsupported_inputs_fail_explicitly(self):
        from image_case import CaseError
        path=Path(self.temp.name)/'fake.png'; path.write_bytes(b'not an image')
        with self.assertRaises(CaseError): self.ingest(path)
        path.write_bytes(b'%PDF-1.7\ncorrupt')
        with self.assertRaisesRegex(CaseError,'IMAGE_PDF_INVALID'): self.ingest(path)
        self.image.save(path,'GIF')
        with self.assertRaisesRegex(CaseError,'IMAGE_FORMAT_UNSUPPORTED'): self.ingest(path)

    def test_atomic_publication_survives_write_failure_and_ignores_abandoned_staging(self):
        from image_case import CaseError, list_cases
        from unittest.mock import patch
        with patch('image_case.os.rename',side_effect=OSError('injected storage failure')):
            with self.assertRaisesRegex(CaseError,'IMAGE_STORE_WRITE_FAILED'): self.ingest()
        self.assertEqual(list_cases(self.root),[])
        stale=self.root/'.staging-abandoned'; stale.mkdir(); (stale/'original.bin').write_bytes(b'partial')
        manifest=self.ingest()
        self.assertEqual([x['caseId'] for x in list_cases(self.root)],[manifest['caseId']])

    def test_reopen_rejects_source_raster_and_manifest_substitution(self):
        from image_case import open_case, CaseError
        for name in ['original.bin','page-0001.png','manifest.json']:
            manifest=self.ingest(); path=self.root/manifest['caseId']/name; original=path.read_bytes()
            path.write_bytes(original+b'changed')
            with self.assertRaises(CaseError): open_case(self.root,manifest['caseId'])
            path.write_bytes(original)

    def test_case_id_traversal_rejected(self):
        from image_case import open_case,CaseError
        for ident in ['../outside','case-../foo','C:/outside','case-'+ 'a'*63]:
            with self.assertRaisesRegex(CaseError,'IMAGE_CASE_ID'): open_case(self.root,ident)

    def test_recovered_calibrated_trace_matches_known_signal_with_pixel_uncertainty(self):
        artifact=self.extract(); lead=artifact['leads'][0]
        self.assertEqual(lead['sampleRateHz'],250)
        self.assertEqual(len(lead['samples']),1000)
        errors=[abs(a-b) for a,b in zip(lead['samples'],self.truth)]
        self.assertLess(max(errors),.13)
        self.assertLess(math.sqrt(sum(e*e for e in errors)/len(errors)),.02)
        self.assertEqual(lead['sourceRegion'],extraction_plan()['leads'][0]['roi'])
        self.assertTrue(artifact['calibrationUserConfirmed'])
        self.assertFalse(artifact['automaticLeadIdentification']); self.assertFalse(artifact['runtimeAuthority'])
        self.assertEqual(lead['quality']['coverage'],1)
        self.assertEqual(lead['quality']['interpolatedColumns'],0)
        self.assertGreater(lead['quality']['maxAmplitudeUncertaintyMv'],0)

    def test_extraction_is_immutable_reopens_and_has_source_overlay(self):
        from image_trace_extraction import open_extraction
        manifest=self.ingest(); artifact=self.extract(manifest)
        self.assertEqual(self.extract(manifest),artifact)
        self.assertEqual(open_extraction(self.root,manifest['caseId'],artifact['extractionId']),artifact)
        overlay=self.root/manifest['caseId']/'extractions'/artifact['extractionId']/artifact['overlays'][0]['file']
        with Image.open(overlay) as image: self.assertEqual(image.size,self.image.size)

    def test_missing_or_unconfirmed_calibration_rejected(self):
        from image_case import CaseError
        for mutate in [lambda p:p['leads'][0].pop('calibration'),lambda p:p['leads'][0]['calibration'].update(confirmed=False),lambda p:p['leads'][0]['calibration'].update(pixelsPerSecond=0),lambda p:p['leads'][0]['calibration'].update(pixelsPerMv=float('nan'))]:
            plan=extraction_plan(); mutate(plan)
            with self.assertRaises(CaseError): self.extract(plan=plan)

    def test_regions_leads_pages_and_authority_overrides_rejected(self):
        from image_case import CaseError
        for mutate in [lambda p:p['leads'].append(copy.deepcopy(p['leads'][0])),lambda p:p['leads'][0].update(leadName='unknown'),lambda p:p['leads'][0].update(pageIndex=1),lambda p:p['leads'][0]['roi'].update(x=-1),lambda p:p.update(runtimeAuthority=True),lambda p:p['leads'][0].update(projectGold=True)]:
            plan=extraction_plan(); mutate(plan)
            with self.assertRaises(CaseError): self.extract(plan=plan)

    def test_missing_ambiguous_and_clipped_traces_are_not_filled_or_invented(self):
        from image_case import CaseError
        for mode,code in [('missing','IMAGE_TRACE_MISSING'),('ambiguous','IMAGE_TRACE_AMBIGUOUS'),('clipped','IMAGE_TRACE_CLIPPED')]:
            image=self.image.copy(); draw=ImageDraw.Draw(image)
            if mode=='missing': draw.rectangle((500,10,500,269),fill='white')
            elif mode=='ambiguous': draw.line((10,250,1009,250),fill='black',width=2)
            else: draw.line((500,10,500,30),fill='black',width=2)
            image.save(self.png); manifest=self.ingest()
            with self.assertRaisesRegex(CaseError,code): self.extract(manifest)
            self.assertFalse((self.root/manifest['caseId']/'extractions').exists())

    def test_extraction_tampering_is_detected_on_reopen(self):
        from image_case import CaseError
        from image_trace_extraction import open_extraction
        manifest=self.ingest(); artifact=self.extract(manifest)
        directory=self.root/manifest['caseId']/'extractions'/artifact['extractionId']
        p=directory/'extraction.json'; original=p.read_bytes(); changed=json.loads(original); changed['leads'][0]['samples'][0]=100
        p.write_text(json.dumps(changed),encoding='utf-8')
        with self.assertRaises(CaseError): open_extraction(self.root,manifest['caseId'],artifact['extractionId'])

        p.write_bytes(original)
        overlay=directory/artifact['overlays'][0]['file']; overlay.write_bytes(b'substituted')
        with self.assertRaises(CaseError): open_extraction(self.root,manifest['caseId'],artifact['extractionId'])

    def test_trace_thickness_is_an_explicit_quality_gate(self):
        from image_case import CaseError
        plan=extraction_plan(); plan['leads'][0]['trace']['maxThicknessPx']=1
        with self.assertRaisesRegex(CaseError,'IMAGE_TRACE_THICKNESS'): self.extract(plan=plan)

    def test_same_pixels_cannot_be_assigned_to_two_distinct_leads(self):
        from image_case import CaseError
        plan=extraction_plan(); duplicate=copy.deepcopy(plan['leads'][0]); duplicate['leadName']='I'; plan['leads'].append(duplicate)
        with self.assertRaisesRegex(CaseError,'IMAGE_EXTRACTION_OVERLAPPING_ROI'): self.extract(plan=plan)

    def test_pdf_picture_connects_to_calibrated_extraction(self):
        path=Path(self.temp.name)/'signal.pdf'; self.image.save(path,'PDF',resolution=72)
        manifest=self.ingest(path,dpi=72); artifact=self.extract(manifest)
        errors=[abs(a-b) for a,b in zip(artifact['leads'][0]['samples'],self.truth)]
        self.assertLess(max(errors),.13); self.assertLess(math.sqrt(sum(e*e for e in errors)/len(errors)),.02)

    def test_file_replacement_between_check_and_open_is_rejected(self):
        from image_case import CaseError,read_regular
        from unittest.mock import patch
        other=Path(self.temp.name)/'other.bin'; other.write_bytes(b'substituted')
        original_open=Path.open
        def swapped(path,*args,**kwargs): return original_open(other if path==self.png else path,*args,**kwargs)
        with patch.object(Path,'open',swapped):
            with self.assertRaisesRegex(CaseError,'IMAGE_STORE_FILE_CHANGED'): read_regular(self.png,32*1024*1024)

    def test_duplicate_json_keys_do_not_silently_replace_calibration(self):
        from image_case import CaseError,parse_json
        with self.assertRaisesRegex(CaseError,'IMAGE_JSON_INVALID'): parse_json(b'{"pixelsPerSecond":250,"pixelsPerSecond":500}')

    def test_animated_png_is_not_silently_reduced_to_first_frame(self):
        from image_case import CaseError
        path=Path(self.temp.name)/'animated.png'; self.image.save(path,'PNG',save_all=True,append_images=[Image.new('RGB',self.image.size,'white')],duration=100,loop=0)
        with self.assertRaisesRegex(CaseError,'IMAGE_ANIMATION_UNSUPPORTED'): self.ingest(path)

if __name__=='__main__': unittest.main(verbosity=2)
