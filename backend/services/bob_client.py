"""
BOB API Client — IBM Bob inference with rule-based fallback.

When the BOB API is not reachable (403/401), falls back to a regex-based
rule extractor so the app remains fully functional.
"""

import json
import hashlib
import hmac
import datetime
import logging
import re
import requests
from config import Config

log = logging.getLogger("bob_client")


# ──────────────────────────────────────────────────────────────
# Auth helpers
# ──────────────────────────────────────────────────────────────

def _get_signing_parts():
    key = Config.BOB_API_KEY
    if not key:
        return None, None
    parts = key.split(":", 2)
    if len(parts) == 3 and parts[0] == "k2":
        return parts[1], parts[2]
    return None, key


def _sign_request(method: str, path: str, body_str: str, secret: str) -> dict:
    now = datetime.datetime.now(datetime.timezone.utc)
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    body_hash = hashlib.sha256(body_str.encode()).hexdigest()
    message = "\n".join([method.upper(), path, timestamp, body_hash])
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {"x-request-timestamp": timestamp, "x-request-signature": signature}


# ──────────────────────────────────────────────────────────────
# Core chat — tries BOB API, raises RuntimeError on failure
# ──────────────────────────────────────────────────────────────

def _chat(messages: list[dict], temperature: float = 0.2, max_tokens: int = 4096) -> str:
    key = Config.BOB_API_KEY
    base_url = Config.BOB_API_BASE_URL.rstrip("/")
    url = base_url + "/chat/completions"

    payload = {
        "model": Config.BOB_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    body_str = json.dumps(payload)

    attempts = []

    if key:
        # Bob AI Gateway / Vercel AI Gateway style
        attempts.append({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "ai-gateway-protocol-version": "0.0.1",
            "x-auth-type": "api-key",
            "User-Agent": "ai-sdk/gateway/4.0.12",
        })
        # Plain Bearer (OpenAI / Ollama)
        attempts.append({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        })

    # HMAC signing (k2: session keys)
    key_id, secret = _get_signing_parts()
    if secret and key_id:
        path = "/" + "/".join(url.split("/")[3:])
        signed = _sign_request("POST", path, body_str, secret)
        attempts.append({
            "Content-Type": "application/json",
            "User-Agent": "bob-extension/1.0",
            "x-bob-key-id": key_id,
            **signed,
        })

    last_err = "no API key configured"
    for headers in attempts:
        try:
            resp = requests.post(url, data=body_str, headers=headers, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"]
            last_err = f"HTTP {resp.status_code}: {resp.text[:120]}"
            log.debug("BOB API attempt failed: %s", last_err)
        except requests.exceptions.RequestException as exc:
            last_err = str(exc)
            log.debug("BOB API request error: %s", exc)

    raise RuntimeError(f"BOB API not reachable ({last_err})")


# ──────────────────────────────────────────────────────────────
# Rule-based fallback extraction (no AI needed)
# ──────────────────────────────────────────────────────────────

def _rule_extract(raw_text: str) -> dict:
    """
    Regex-based medical fact extractor.
    Extracts only facts that are explicitly present in the text.
    """
    text = raw_text

    def find(patterns, default=None):
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                return m.group(1).strip()
        return default

    def find_all(patterns):
        results = []
        for pat in patterns:
            for m in re.finditer(pat, text, re.IGNORECASE):
                results.append(m.group(1).strip() if m.lastindex else m.group(0).strip())
        return list(dict.fromkeys(results))  # deduplicate preserving order

    # Patient info
    name = find([
        r"patient[\s:]+([A-Z][a-z]+(?: [A-Z][a-z]+)+)",
        r"name[\s:]+([A-Z][a-z]+(?: [A-Z][a-z]+)+)",
        r"patient name[\s:]+(.+?)(?:\n|,|$)",
    ])
    dob = find([
        r"(?:dob|date of birth|birth date)[\s:]+(\d{1,4}[-/]\d{1,2}[-/]\d{1,4})",
        r"(?:born on|born)[\s:]+(\w+ \d+,? \d{4})",
    ])
    gender = find([r"(?:gender|sex)[\s:]+(\w+)"])
    blood_group = find([r"(?:blood group|blood type)[\s:]+([ABO]+[+-]?(?:\s?positive|\s?negative)?)", ])
    report_date = find([
        r"(?:report date|date of report|test date|date)[\s:]+(\d{1,4}[-/]\d{1,2}[-/]\d{1,4})",
        r"(?:report date|date)[\s:]+(\w+ \d+,? \d{4})",
    ])

    # Lab results — match "Test Name: value unit" patterns
    lab_results = []
    lab_patterns = [
        r"(hemoglobin|hgb|hb)[\s:]+(\d+\.?\d*)\s*(g/dl|g/l)?",
        r"(wbc|white blood cell[s]?|leukocytes)[\s:]+(\d+\.?\d*)\s*(cells?/mcl|x10\^3|10\^3/ul|/ul)?",
        r"(rbc|red blood cell[s]?)[\s:]+(\d+\.?\d*)\s*(million[s]?/mcl|x10\^6|10\^6/ul)?",
        r"(platelets?|plt)[\s:]+(\d+\.?\d*)\s*(k/ul|cells?/mcl|x10\^3)?",
        r"(blood glucose|fasting glucose|glucose)[\s:]+(\d+\.?\d*)\s*(mg/dl|mmol/l)?",
        r"(creatinine|creat)[\s:]+(\d+\.?\d*)\s*(mg/dl|umol/l)?",
        r"(urea|bun|blood urea nitrogen)[\s:]+(\d+\.?\d*)\s*(mg/dl|mmol/l)?",
        r"(sodium|na\+?)[\s:]+(\d+\.?\d*)\s*(meq/l|mmol/l)?",
        r"(potassium|k\+?)[\s:]+(\d+\.?\d*)\s*(meq/l|mmol/l)?",
        r"(cholesterol|total cholesterol)[\s:]+(\d+\.?\d*)\s*(mg/dl|mmol/l)?",
        r"(ldl|ldl[-\s]cholesterol)[\s:]+(\d+\.?\d*)\s*(mg/dl|mmol/l)?",
        r"(hdl|hdl[-\s]cholesterol)[\s:]+(\d+\.?\d*)\s*(mg/dl|mmol/l)?",
        r"(triglycerides?|tg)[\s:]+(\d+\.?\d*)\s*(mg/dl|mmol/l)?",
        r"(tsh|thyroid stimulating hormone)[\s:]+(\d+\.?\d*)\s*(miu/l|uiu/ml)?",
        r"(hba1c|glycated hemoglobin|hemoglobin a1c)[\s:]+(\d+\.?\d*)\s*(%)?",
        r"(alt|alanine aminotransferase|sgpt)[\s:]+(\d+\.?\d*)\s*(u/l|iu/l)?",
        r"(ast|aspartate aminotransferase|sgot)[\s:]+(\d+\.?\d*)\s*(u/l|iu/l)?",
        r"(bilirubin|total bilirubin)[\s:]+(\d+\.?\d*)\s*(mg/dl)?",
        r"(esr|erythrocyte sedimentation rate)[\s:]+(\d+\.?\d*)\s*(mm/hr|mm/h)?",
        r"(crp|c-reactive protein)[\s:]+(\d+\.?\d*)\s*(mg/l|mg/dl)?",
    ]
    for pat in lab_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            groups = m.groups()
            test_name = groups[0].title()
            value = groups[1] if len(groups) > 1 else None
            unit = groups[2] if len(groups) > 2 and groups[2] else None
            lab_results.append({"test": test_name, "value": value, "unit": unit,
                                 "reference_range": None, "status": "found"})

    # Reference ranges
    ref_pattern = r"(?:reference[:\s]+|normal[:\s]+|range[:\s]+)([0-9.]+\s*[-–]\s*[0-9.]+\s*\w*/?\w*)"
    ref_ranges = re.findall(ref_pattern, text, re.IGNORECASE)

    # Vital signs
    vital_signs = []
    bp = re.search(r"(?:blood pressure|bp|b\.p\.)[\s:]+(\d{2,3})\s*/\s*(\d{2,3})\s*(mmhg)?", text, re.IGNORECASE)
    if bp:
        vital_signs.append({"name": "Blood Pressure", "value": f"{bp.group(1)}/{bp.group(2)}", "unit": "mmHg"})
    hr = re.search(r"(?:heart rate|pulse|hr)[\s:]+(\d{2,3})\s*(bpm|/min)?", text, re.IGNORECASE)
    if hr:
        vital_signs.append({"name": "Heart Rate", "value": hr.group(1), "unit": "bpm"})
    temp = re.search(r"(?:temperature|temp)[\s:]+(\d{2,3}\.?\d*)\s*([°]?[fc])?", text, re.IGNORECASE)
    if temp:
        vital_signs.append({"name": "Temperature", "value": temp.group(1), "unit": temp.group(2) or "°F"})
    rr = re.search(r"(?:respiratory rate|rr|resp rate)[\s:]+(\d{1,2})\s*(?:breaths?/min)?", text, re.IGNORECASE)
    if rr:
        vital_signs.append({"name": "Respiratory Rate", "value": rr.group(1), "unit": "breaths/min"})
    spo2 = re.search(r"(?:spo2|oxygen saturation|o2 sat)[\s:]+(\d{2,3})\s*%?", text, re.IGNORECASE)
    if spo2:
        vital_signs.append({"name": "SpO2", "value": spo2.group(1), "unit": "%"})
    weight = re.search(r"(?:weight|wt)[\s:]+(\d{2,3}\.?\d*)\s*(kg|lbs?)?", text, re.IGNORECASE)
    if weight:
        vital_signs.append({"name": "Weight", "value": weight.group(1), "unit": weight.group(2) or "kg"})
    height = re.search(r"(?:height|ht)[\s:]+(\d{2,3}\.?\d*)\s*(cm|m|ft|inches?)?", text, re.IGNORECASE)
    if height:
        vital_signs.append({"name": "Height", "value": height.group(1), "unit": height.group(2) or "cm"})

    # Diagnoses
    diagnoses = []
    diag_patterns = [
        r"(?:diagnosis|diagnosed with|impression|assessment)[\s:]+(.+?)(?:\n|$)",
        r"(?:icd[-\s]?\d*[\s:]+)(.+?)(?:\n|\(|$)",
    ]
    for pat in diag_patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            val = m.group(1).strip().rstrip(".,;")
            if val and len(val) > 2:
                diagnoses.append({"name": val, "source_text": m.group(0).strip()})

    # Medications
    medications = []
    med_pattern = r"(?:medication|medicine|drug|rx|prescribed|tablet|capsule|injection)[\s:]*([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*(\d+\s*mg|\d+\s*mcg|\d+\s*ml)?\s*(once|twice|thrice|\d+\s*times)?\s*(daily|weekly|monthly|per day|bd|od|tds|qid)?"
    for m in re.finditer(med_pattern, text, re.IGNORECASE):
        name = m.group(1).strip()
        dose = m.group(2) or None
        freq = m.group(4) or m.group(3) or None
        if name and len(name) > 2 and name.lower() not in ("medication", "medicine", "drug", "tablet", "capsule"):
            medications.append({"name": name.title(), "dose": dose, "frequency": freq,
                                 "duration": None, "source_text": m.group(0).strip()})

    # Allergies
    allergies = []
    allergy_pattern = r"(?:allerg(?:y|ic|ies)|intolerance)[\s:]+(?:to\s+)?(.+?)(?:\n|,|$)"
    for m in re.finditer(allergy_pattern, text, re.IGNORECASE):
        val = m.group(1).strip().rstrip(".,;")
        if val and len(val) > 1:
            allergies.append({"substance": val, "reaction": None})

    # Doctor info
    doctor_name = find([
        r"(?:dr\.|doctor|physician|consultant)[\s:]+([A-Z][a-z]+(?: [A-Z][a-z]+)+)",
        r"signed by[\s:]+(?:dr\.\s*)?([A-Z][a-z]+(?: [A-Z][a-z]+)+)",
    ])
    facility = find([
        r"(?:hospital|clinic|centre|center|facility|lab|laboratory)[\s:]+(.+?)(?:\n|$)",
    ])
    specialization = find([
        r"(?:specialization|department|dept|specialty)[\s:]+(.+?)(?:\n|$)",
    ])

    return {
        "patient": {
            "full_name": name,
            "date_of_birth": dob,
            "gender": gender,
            "blood_group": blood_group,
            "address": None,
        },
        "report_date": report_date,
        "lab_results": lab_results,
        "diagnoses": diagnoses,
        "medications": medications,
        "vital_signs": vital_signs,
        "allergies": allergies,
        "procedures": [],
        "symptoms": [],
        "doctor": {
            "name": doctor_name,
            "specialization": specialization,
            "facility": facility,
        },
        "notes": None,
        "_extraction_method": "rule_based",
    }


def _rule_summary(patient_data: dict) -> str:
    """Generate a structured text summary from patient data without AI."""
    lines = ["=" * 60, "MEDICAL SUMMARY REPORT", "=" * 60, ""]

    profile = patient_data.get("profile", {})
    if profile.get("full_name"):
        lines += [
            "PATIENT INFORMATION",
            "-" * 40,
            f"Name         : {profile.get('full_name', '—')}",
            f"Date of Birth: {profile.get('date_of_birth', '—')}",
            f"Gender       : {profile.get('gender', '—')}",
            f"Blood Group  : {profile.get('blood_group', '—')}",
            "",
        ]

    docs = patient_data.get("documents", [])
    if docs:
        lines += [f"Documents on file: {len(docs)}", ""]

    labs = patient_data.get("lab_results", [])
    if labs:
        lines += ["LAB RESULTS", "-" * 40]
        for l in labs:
            val = l.get("field_value") or l.get("value") or "—"
            unit = l.get("unit") or ""
            ref = l.get("reference_range") or ""
            name = l.get("field_name") or l.get("test") or "—"
            ref_str = f"  (ref: {ref})" if ref else ""
            lines.append(f"  {name:<30} {val} {unit}{ref_str}")
        lines.append("")

    vitals = patient_data.get("vital_signs", [])
    if vitals:
        lines += ["VITAL SIGNS", "-" * 40]
        for v in vitals:
            lines.append(f"  {(v.get('field_name') or v.get('name') or ''):<30} {v.get('field_value') or v.get('value') or '—'} {v.get('unit') or ''}")
        lines.append("")

    diagnoses = patient_data.get("diagnoses", [])
    if diagnoses:
        lines += ["DIAGNOSES", "-" * 40]
        for d in diagnoses:
            lines.append(f"  • {d.get('field_name') or d.get('name') or '—'}")
        lines.append("")

    meds = patient_data.get("medications", [])
    if meds:
        lines += ["MEDICATIONS", "-" * 40]
        for m in meds:
            val = m.get("field_value") or m.get("dose") or ""
            freq = m.get("unit") or m.get("frequency") or ""
            lines.append(f"  • {m.get('field_name') or m.get('name') or '—'}  {val}  {freq}")
        lines.append("")

    allergies = patient_data.get("allergies", [])
    if allergies:
        lines += ["ALLERGIES", "-" * 40]
        for a in allergies:
            lines.append(f"  ⚠ {a.get('field_name') or a.get('substance') or '—'}")
        lines.append("")

    if not labs and not vitals and not diagnoses and not meds:
        lines += ["No structured medical data has been extracted yet.",
                  "Upload medical documents to populate this summary."]

    lines += ["", "─" * 60,
              "Note: This summary was generated using rule-based extraction.",
              "Configure BOB_API_KEY in .env.example for AI-enhanced summaries.",
              "─" * 60]
    return "\n".join(lines)


def _rule_analysis(patient_data: dict) -> dict:
    """Build a basic analysis from structured patient data without AI."""
    timeline = []
    docs = patient_data.get("documents", [])
    for doc in docs:
        date = str(doc.get("uploaded_at", ""))[:10]
        name = doc.get("original_filename", "document")
        if date:
            timeline.append({"date": date, "event": f"Document uploaded: {name}"})

    labs = patient_data.get("lab_results", [])
    for lab in labs:
        date = str(lab.get("report_date", ""))[:10]
        name = lab.get("field_name") or lab.get("test") or "Lab test"
        val = lab.get("field_value") or lab.get("value") or "?"
        unit = lab.get("unit") or ""
        if date:
            timeline.append({"date": date, "event": f"{name}: {val} {unit}".strip()})

    timeline.sort(key=lambda x: x.get("date", ""))

    meds = patient_data.get("medications", [])
    med_summary = [
        {
            "name": m.get("field_name") or m.get("name") or "—",
            "dose": m.get("field_value") or m.get("dose"),
            "frequency": m.get("unit") or m.get("frequency"),
            "status": "recorded",
        }
        for m in meds
    ]

    # Identify missing info
    missing = []
    if not labs:
        missing.append("No laboratory results found")
    if not patient_data.get("vital_signs"):
        missing.append("No vital signs recorded")
    if not patient_data.get("diagnoses"):
        missing.append("No diagnoses recorded")
    if not meds:
        missing.append("No medications recorded")
    profile = patient_data.get("profile", {})
    if not profile.get("date_of_birth"):
        missing.append("Date of birth not recorded")
    if not profile.get("blood_group"):
        missing.append("Blood group not recorded")

    return {
        "timeline": timeline,
        "changes": [],
        "medication_summary": med_summary,
        "missing_info": missing,
    }


# ──────────────────────────────────────────────────────────────
# Public service functions (AI with rule-based fallback)
# ──────────────────────────────────────────────────────────────

def extract_medical_facts(raw_text: str) -> dict:
    """EXTRACTION SERVICE — AI preferred, rule-based fallback."""
    system_prompt = (
        "You are a precise medical data extraction engine. "
        "Extract ONLY information EXPLICITLY stated in the document. "
        "Do NOT infer or generate anything not literally present. "
        "If a field is absent, set value to null and status to 'not_found'. "
        "Return ONLY valid JSON — no markdown fences, no explanation.\n"
        'Schema: {"patient":{"full_name":null,"date_of_birth":null,"gender":null,"blood_group":null,"address":null},'
        '"report_date":null,'
        '"lab_results":[{"test":"","value":null,"unit":null,"reference_range":null,"status":"found"}],'
        '"diagnoses":[{"name":"","source_text":""}],'
        '"medications":[{"name":"","dose":null,"frequency":null,"duration":null,"source_text":""}],'
        '"vital_signs":[{"name":"","value":null,"unit":null}],'
        '"allergies":[{"substance":"","reaction":null}],'
        '"procedures":[{"name":"","date":null,"notes":null}],'
        '"symptoms":[{"name":"","severity":null,"duration":null}],'
        '"doctor":{"name":null,"specialization":null,"facility":null},'
        '"notes":null}'
    )
    try:
        raw = _chat(
            [{"role": "system", "content": system_prompt},
             {"role": "user", "content": f"Extract all medical facts from:\n\n{raw_text[:8000]}"}],
            temperature=0.0, max_tokens=3000,
        )
        result = json.loads(raw)
        result["_extraction_method"] = "ai"
        return result
    except (RuntimeError, json.JSONDecodeError):
        pass
    try:
        # Try JSON from wrapped text
        match = re.search(r"\{.*\}", raw if "raw" in dir() else "", re.DOTALL)  # type: ignore[name-defined]
        if match:
            result = json.loads(match.group())
            result["_extraction_method"] = "ai"
            return result
    except Exception:
        pass
    # Fallback to rule-based
    log.info("BOB API unavailable — using rule-based extraction")
    return _rule_extract(raw_text)


def generate_medical_summary(patient_data: dict) -> str:
    """SUMMARY SERVICE — AI preferred, rule-based fallback."""
    system_prompt = (
        "You are a clinical documentation assistant. "
        "Organise the structured medical data into a clear clinical summary. "
        "Use ONLY the data provided. Do NOT add information not in the data. "
        "Sections: Patient Information, Lab Results, Diagnoses, "
        "Medications, Vital Signs, Allergies, Procedures, Symptoms, Notes. "
        "Write 'No information recorded' for empty sections."
    )
    try:
        return _chat(
            [{"role": "system", "content": system_prompt},
             {"role": "user", "content": f"Summarise:\n\n{json.dumps(patient_data, indent=2, default=str)[:8000]}"}],
            temperature=0.1, max_tokens=3000,
        )
    except RuntimeError:
        log.info("BOB API unavailable — using rule-based summary")
        return _rule_summary(patient_data)


def analyze_medical_records(patient_data: dict) -> dict:
    """ANALYSIS SERVICE — AI preferred, rule-based fallback."""
    system_prompt = (
        "You are a medical records analyst. Return JSON only:\n"
        '{"timeline":[{"date":"","event":""}],'
        '"changes":[{"field":"","observations":""}],'
        '"medication_summary":[{"name":"","dose":null,"frequency":null,"status":""}],'
        '"missing_info":[]}\n'
        "Use ONLY explicitly present data. No markdown."
    )
    try:
        raw = _chat(
            [{"role": "system", "content": system_prompt},
             {"role": "user", "content": f"Analyse:\n\n{json.dumps(patient_data, indent=2, default=str)[:8000]}"}],
            temperature=0.1, max_tokens=3000,
        )
        result = json.loads(raw)
        return result
    except (RuntimeError, json.JSONDecodeError):
        pass
    try:
        match = re.search(r"\{.*\}", raw if "raw" in dir() else "", re.DOTALL)  # type: ignore[name-defined]
        if match:
            return json.loads(match.group())
    except Exception:
        pass
    log.info("BOB API unavailable — using rule-based analysis")
    return _rule_analysis(patient_data)


def answer_question(question: str, patient_data: dict) -> str:
    """Q&A SERVICE — AI preferred, rule-based fallback."""
    system_prompt = (
        "You are a medical Q&A assistant. "
        "Answer using ONLY the patient data provided. "
        "If the answer is not in the data, say exactly: "
        "'This information is not available in the uploaded medical records.' "
        "Do NOT speculate or invent information."
    )
    try:
        return _chat(
            [{"role": "system", "content": system_prompt},
             {
                 "role": "user",
                 "content": (
                     f"Patient data:\n{json.dumps(patient_data, indent=2, default=str)[:6000]}\n\n"
                     f"Question: {question}"
                 ),
             }],
            temperature=0.2, max_tokens=1500,
        )
    except RuntimeError:
        # Rule-based Q&A: search patient data for keywords
        log.info("BOB API unavailable — using rule-based Q&A")
        return _rule_answer(question, patient_data)


def _rule_answer(question: str, patient_data: dict) -> str:
    """Simple keyword-based Q&A over patient data."""
    q = question.lower()

    def fmt_list(items, name_key="field_name", val_key="field_value", unit_key="unit"):
        if not items:
            return None
        parts = []
        for it in items:
            n = it.get(name_key) or it.get("name") or it.get("test") or "?"
            v = it.get(val_key) or it.get("value") or ""
            u = it.get(unit_key) or it.get("unit") or ""
            parts.append(f"{n}: {v} {u}".strip())
        return "\n".join(f"  • {p}" for p in parts)

    profile = patient_data.get("profile", {})
    labs = patient_data.get("lab_results", [])
    vitals = patient_data.get("vital_signs", [])
    meds = patient_data.get("medications", [])
    diagnoses = patient_data.get("diagnoses", [])
    allergies = patient_data.get("allergies", [])

    if any(w in q for w in ["name", "patient", "who"]):
        n = profile.get("full_name")
        return f"The patient's name is {n}." if n else "Patient name not found in records."

    if any(w in q for w in ["dob", "birth", "age", "born"]):
        d = profile.get("date_of_birth")
        return f"Date of birth: {d}." if d else "Date of birth not found in records."

    if any(w in q for w in ["blood group", "blood type"]):
        b = profile.get("blood_group")
        return f"Blood group: {b}." if b else "Blood group not found in records."

    if any(w in q for w in ["lab", "test", "result", "blood", "hemoglobin", "glucose", "creatinine",
                             "cholesterol", "wbc", "rbc", "hba1c", "tsh"]):
        r = fmt_list(labs, "field_name", "field_value")
        return f"Lab results on record:\n{r}" if r else "No lab results found in records."

    if any(w in q for w in ["vital", "blood pressure", "bp", "pulse", "heart rate", "temperature", "weight"]):
        r = fmt_list(vitals, "field_name", "field_value")
        return f"Vital signs on record:\n{r}" if r else "No vital signs found in records."

    if any(w in q for w in ["medication", "medicine", "drug", "tablet", "capsule", "prescription"]):
        r = fmt_list(meds, "field_name", "field_value")
        return f"Medications on record:\n{r}" if r else "No medications found in records."

    if any(w in q for w in ["diagnosis", "condition", "disease", "illness", "diagnosed"]):
        r = fmt_list(diagnoses, "field_name", "field_value")
        return f"Diagnoses on record:\n{r}" if r else "No diagnoses found in records."

    if any(w in q for w in ["allergy", "allergic", "intolerance"]):
        r = fmt_list(allergies, "field_name", "field_value")
        return f"Allergies on record:\n{r}" if r else "No allergies found in records."

    if any(w in q for w in ["document", "report", "file", "upload"]):
        docs = patient_data.get("documents", [])
        if docs:
            names = "\n".join(f"  • {d['original_filename']}" for d in docs)
            return f"{len(docs)} document(s) on file:\n{names}"
        return "No documents have been uploaded yet."

    return "This information is not available in the uploaded medical records."
