"""Deterministic ECG calculations and threshold helpers for EKG INTERPRETATIONS.

These functions never infer ECG morphology from an image. Callers must provide
validated measurements and acquisition scale explicitly. Returning ``None``
means the requested threshold is not safely assessable from the supplied inputs.
"""
from __future__ import annotations
import math
from typing import Mapping

STANDARD_LIMB_LEADS={"I","II","III","AVR","AVL","AVF"}
STANDARD_PRECORDIAL_LEADS={f"V{i}" for i in range(1,7)}


def _positive(value:float,name:str)->float:
    value=float(value)
    if not math.isfinite(value) or value<=0: raise ValueError(f"{name} must be finite and positive")
    return value


def ms_per_small_box(speed_mm_s:float)->float:
    return 1000.0/_positive(speed_mm_s,"speed_mm_s")


def ms_per_large_box(speed_mm_s:float)->float:
    return 5.0*ms_per_small_box(speed_mm_s)


def mv_per_mm(gain_mm_per_mv:float)->float:
    return 1.0/_positive(gain_mm_per_mv,"gain_mm_per_mv")


def standardize_vertical_mm(measured_mm:float,gain_mm_per_mv:float,reference_gain_mm_per_mv:float=10.0)->float:
    """Convert displayed paper-mm displacement to equivalent mm at a reference gain.

    Conventional ECG criteria are traditionally stated as paper-millimeter
    thresholds under standard calibration. If a tracing uses another gain, the
    same voltage occupies a different number of paper millimeters. This helper
    normalizes a measured display displacement through the explicit gain rather
    than silently assuming 10 mm/mV. The sign is preserved.
    """
    measured=float(measured_mm); gain=_positive(gain_mm_per_mv,"gain_mm_per_mv"); ref=_positive(reference_gain_mm_per_mv,"reference_gain_mm_per_mv")
    if not math.isfinite(measured): raise ValueError("measured_mm must be finite")
    return (measured/gain)*ref


def conventional_st_elevation_met_from_display_mm(measurements_mm:Mapping[str,float],*,gain_mm_per_mv:float,sex:str|None=None,age_years:float|None=None,bbb_or_lvh_confounded:bool=False)->bool|None:
    """Apply conventional thresholds after normalizing explicit display gain.

    This is an ECG feature threshold helper only; it is not an MI/occlusion
    classifier. ``measurements_mm`` are physical display/grid millimeters.
    """
    standardized={k:standardize_vertical_mm(v,gain_mm_per_mv) for k,v in measurements_mm.items()}
    return conventional_st_elevation_met(standardized,sex=sex,age_years=age_years,bbb_or_lvh_confounded=bbb_or_lvh_confounded)


def rate_from_rr_seconds(rr_s:float)->float:
    return 60.0/_positive(rr_s,"rr_s")


def rate_from_large_boxes(large_boxes:float,speed_mm_s:float)->float:
    rr_s=_positive(large_boxes,"large_boxes")*ms_per_large_box(speed_mm_s)/1000.0
    return rate_from_rr_seconds(rr_s)


def rate_from_small_boxes(small_boxes:float,speed_mm_s:float)->float:
    rr_s=_positive(small_boxes,"small_boxes")*ms_per_small_box(speed_mm_s)/1000.0
    return rate_from_rr_seconds(rr_s)


def average_rate_from_beats(beats:float,window_seconds:float)->float:
    """Average rate over an explicitly known time window.

    ``beats`` is the number of complete ventricular cycles counted in the window.
    This is intended for irregular rhythms where a longer sampling interval is
    more representative than one RR interval.
    """
    beats=_positive(beats,"beats"); window_seconds=_positive(window_seconds,"window_seconds")
    return beats*60.0/window_seconds


def qtc_bazett(qt_ms:float,rr_s:float)->float:
    return _positive(qt_ms,"qt_ms")/math.sqrt(_positive(rr_s,"rr_s"))


def qtc_fridericia(qt_ms:float,rr_s:float)->float:
    return _positive(qt_ms,"qt_ms")/(_positive(rr_s,"rr_s")**(1.0/3.0))


def qtc_framingham(qt_ms:float,rr_s:float)->float:
    qt=_positive(qt_ms,"qt_ms")/1000.0; rr=_positive(rr_s,"rr_s")
    return (qt+0.154*(1.0-rr))*1000.0


def qtc_hodges(qt_ms:float,heart_rate_bpm:float)->float:
    return _positive(qt_ms,"qt_ms")+1.75*(_positive(heart_rate_bpm,"heart_rate_bpm")-60.0)


def qtc_all(qt_ms:float,rr_s:float)->dict[str,float]:
    hr=rate_from_rr_seconds(rr_s)
    return {
      "bazett_ms":qtc_bazett(qt_ms,rr_s),
      "fridericia_ms":qtc_fridericia(qt_ms,rr_s),
      "framingham_ms":qtc_framingham(qt_ms,rr_s),
      "hodges_ms":qtc_hodges(qt_ms,hr),
    }


def axis_category(degrees:float)->str:
    """Practical adult frontal-QRS-axis category; not for pediatric criteria."""
    d=float(degrees)
    if not math.isfinite(d) or d < -180 or d > 180: raise ValueError("degrees must be within -180..180")
    if -30 <= d <= 90: return "normal"
    if -90 <= d < -30: return "left_axis_deviation"
    if 90 < d <= 180: return "right_axis_deviation"
    return "extreme_axis"


def qrs_duration_category(qrs_ms:float)->str:
    """Adult duration category only; morphology is still required for BBB labels."""
    q=_positive(qrs_ms,"qrs_ms")
    if q < 110: return "not_prolonged_by_aha_2009_threshold"
    if q < 120: return "prolonged_110_119_ms"
    return "wide_120_ms_or_more"


def st_elevation_threshold_mm(lead:str,sex:str|None=None,age_years:float|None=None)->float|None:
    """2026 UDMI conventional working ST-elevation threshold per lead.

    Returns ``None`` when a V2/V3 threshold cannot be selected because required
    demographic information is absent. This helper does not diagnose MI or
    coronary occlusion and should not be used naively in BBB/LVH confounding.
    """
    lead=lead.upper()
    if lead not in {"V2","V3"}: return 1.0
    if sex is None: return None
    s=sex.strip().lower()
    if s in {"female","f","woman"}: return 1.5
    if s in {"male","m","man"}:
        if age_years is None:return None
        if age_years<0: raise ValueError("age_years must be non-negative")
        return 2.5 if age_years<40 else 2.0
    return None


CONTIGUOUS_ST_PAIRS=(
    ("II","III"),("II","AVF"),("III","AVF"),
    ("I","AVL"),("AVL","V5"),("V5","V6"),
    ("V1","V2"),("V2","V3"),("V3","V4"),("V4","V5"),("V5","V6"),
)


def conventional_st_elevation_met(measurements_mm:Mapping[str,float],*,sex:str|None=None,age_years:float|None=None,bbb_or_lvh_confounded:bool=False)->bool|None:
    """Threshold helper for J-point measurements standardized to 10 mm/mV.

    If values came from a tracing displayed at another gain, call
    ``conventional_st_elevation_met_from_display_mm`` instead.

    Returns ``None`` if the conventional threshold is not safely assessable due
    to missing V2/V3 demographic information or caller-declared BBB/LVH
    confounding. It is not an occlusion or MI classifier.
    """
    if bbb_or_lvh_confounded:return None
    norm={str(k).upper():float(v) for k,v in measurements_mm.items()}
    if any(not math.isfinite(v) for v in norm.values()): raise ValueError("ST measurements must be finite")
    indeterminate=False
    for a,b in CONTIGUOUS_ST_PAIRS:
        if a in norm and b in norm:
            ta=st_elevation_threshold_mm(a,sex,age_years); tb=st_elevation_threshold_mm(b,sex,age_years)
            if ta is None or tb is None:
                indeterminate=True; continue
            if norm[a]>=ta and norm[b]>=tb:return True
    return None if indeterminate else False


def ischemic_st_depression_threshold_met(measurements_mm:Mapping[str,float],morphology:Mapping[str,str])->bool:
    """Checks the 0.5 mm magnitude criterion in >=2 contiguous leads.

    Caller supplies signed/absolute depression magnitude and morphology. Only
    horizontal/downsloping morphology is counted. This is an ECG-feature helper,
    not a diagnosis of ischemia or MI.
    """
    norm={str(k).upper():abs(float(v)) for k,v in measurements_mm.items()}
    morph={str(k).upper():str(v).lower() for k,v in morphology.items()}
    eligible={k for k,v in norm.items() if v>=0.5 and morph.get(k) in {"horizontal","downsloping","down_sloping"}}
    return any(a in eligible and b in eligible for a,b in CONTIGUOUS_ST_PAIRS)


def classic_sgarbossa_components(*,concordant_ste_mm:float|None=None,concordant_std_v1_v3_mm:float|None=None,discordant_ste_mm:float|None=None)->dict[str,bool|None]:
    """Returns classic Sgarbossa component threshold flags only.

    The caller must first establish an LBBB or ventricular-paced QRS context.
    These component checks do not calculate a diagnostic score or establish MI.
    """
    def flag(value,threshold):
        if value is None:return None
        value=float(value)
        if not math.isfinite(value): raise ValueError("Sgarbossa measurement must be finite")
        return value>=threshold
    return {
      "concordant_st_elevation_ge_1mm":flag(concordant_ste_mm,1.0),
      "concordant_st_depression_v1_v3_ge_1mm":flag(concordant_std_v1_v3_mm,1.0),
      "discordant_st_elevation_ge_5mm":flag(discordant_ste_mm,5.0),
    }
