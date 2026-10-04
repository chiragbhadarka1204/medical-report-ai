"""
Full end-to-end test for Medical Report AI
"""
import sys, os, json, urllib.request, urllib.error, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

BASE = 'http://localhost:5000'
TOKEN = None
results = []

def check(label, condition, detail=''):
    sym = 'OK  ' if condition else 'FAIL'
    print(f'  [{sym}] {label}' + (f'  |  {detail}' if detail else ''))
    results.append(condition)
    return condition

def api(method, path, body=None, auth=False, raw=False):
    url = BASE + path
    data = json.dumps(body).encode() if body else None
    headers = {'Content-Type': 'application/json'}
    if auth and TOKEN:
        headers['Authorization'] = 'Bearer ' + TOKEN
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        r = urllib.request.urlopen(req, timeout=12)
        resp = r.read()
        return r.status, json.loads(resp) if not raw else resp
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}

print()
print('=' * 56)
print('  Medical Report AI — Full System Test')
print('=' * 56)

# ── Frontend ──────────────────────────────────────────────────
print('\n[Frontend]')
try:
    r = urllib.request.urlopen(BASE + '/', timeout=5)
    html = r.read().decode()
    check('GET /  loads HTML', 'Medical Report AI' in html)
    check('GET /  has login form', 'login-email' in html)
    check('GET /  has OTP screen', 'otp-inputs' in html)
    check('GET /  has dashboard', 'page-dashboard' in html)
    check('GET /  has Q&A page', 'page-qa' in html)
    check('GET /  CSS loads', '/css/styles.css' in html)
    check('GET /  JS loads', '/js/app.js' in html)
except Exception as e:
    check('Frontend reachable', False, str(e))

# ── Auth: Login ───────────────────────────────────────────────
print('\n[Auth — Login & OTP]')
status, data = api('POST', '/api/auth/login', {'email': 'syscheck@medical.ai', 'phone': '+919999999999'})
check('POST /api/auth/login  HTTP 200', status == 200, f'HTTP {status}')
check('POST /api/auth/login  returns dev_otp', 'dev_otp' in data, str(data.get('dev_otp','')))
check('POST /api/auth/login  returns user_id', 'user_id' in data)
otp = data.get('dev_otp', '')
uid = data.get('user_id', '')

# ── Auth: Verify OTP ──────────────────────────────────────────
status2, data2 = api('POST', '/api/auth/verify-otp', {'user_id': uid, 'otp': otp})
check('POST /api/auth/verify-otp  HTTP 200', status2 == 200, f'HTTP {status2}')
check('POST /api/auth/verify-otp  returns token', 'token' in data2)
check('POST /api/auth/verify-otp  returns user', 'user' in data2)
TOKEN = data2.get('token', '')

# ── Auth: Wrong OTP ───────────────────────────────────────────
status3, _ = api('POST', '/api/auth/verify-otp', {'user_id': uid, 'otp': '000000'})
check('POST /api/auth/verify-otp  rejects bad OTP', status3 == 401, f'HTTP {status3}')

# ── Auth: Protected without token ─────────────────────────────
status4, _ = api('GET', '/api/documents/')
check('GET /api/documents/  401 without token', status4 == 401, f'HTTP {status4}')

# ── Documents ─────────────────────────────────────────────────
print('\n[Documents]')
status5, data5 = api('GET', '/api/documents/', auth=True)
check('GET /api/documents/  HTTP 200', status5 == 200, f'HTTP {status5}')
check('GET /api/documents/  returns list', 'documents' in data5)

# Upload a real TXT medical document
print('\n[Document Upload — TXT]')
sample_doc = b"""PATIENT: John Doe
DATE OF BIRTH: 1985-03-15
GENDER: Male
REPORT DATE: 2024-01-10

LABORATORY RESULTS:
Hemoglobin: 10.2 g/dL (Reference: 13.5-17.5 g/dL)
WBC Count: 7800 cells/mcL
Blood Glucose (Fasting): 126 mg/dL
Creatinine: 0.9 mg/dL

VITAL SIGNS:
Blood Pressure: 138/88 mmHg
Heart Rate: 78 bpm
Temperature: 98.6 F

DIAGNOSIS: Type 2 Diabetes Mellitus (E11.9)
MEDICATION: Metformin 500mg twice daily

DOCTOR: Dr. Priya Sharma, Endocrinologist
FACILITY: City Medical Center
"""

# Upload via multipart
import io
boundary = b'--TestBoundary7896'
body = (
    boundary + b'\r\n'
    b'Content-Disposition: form-data; name="file"; filename="sample_report.txt"\r\n'
    b'Content-Type: text/plain\r\n\r\n' +
    sample_doc + b'\r\n' +
    boundary + b'--\r\n'
)
headers = {
    'Content-Type': 'multipart/form-data; boundary=TestBoundary7896',
    'Authorization': 'Bearer ' + TOKEN,
}
req_up = urllib.request.Request(BASE + '/api/documents/upload', data=body, headers=headers, method='POST')
try:
    r_up = urllib.request.urlopen(req_up, timeout=30)
    up_data = json.loads(r_up.read())
    check('POST /api/documents/upload  HTTP 201', r_up.status == 201, f'HTTP {r_up.status}')
    check('POST /api/documents/upload  returns doc_id', 'document_id' in up_data)
    doc_id = up_data.get('document_id', '')
    ai_ok = 'error' not in up_data.get('facts_preview', {})
    check('POST /api/documents/upload  AI extraction ran', 'facts_preview' in up_data,
          'BOB API: OK' if ai_ok else 'BOB API: error (see below)')
    if not ai_ok:
        print(f'           BOB API error: {up_data.get("facts_preview", {}).get("error","?")}')
except urllib.error.HTTPError as e:
    body_err = json.loads(e.read())
    check('POST /api/documents/upload  HTTP 201', False, f'HTTP {e.code}: {body_err.get("error","?")}')
    doc_id = ''

# ── Patient data / Summary ─────────────────────────────────────
print('\n[Summary & Patient Data]')
status6, data6 = api('GET', '/api/summary/patient-data', auth=True)
check('GET /api/summary/patient-data  HTTP 200', status6 == 200, f'HTTP {status6}')
check('GET /api/summary/patient-data  has lab_results key', 'lab_results' in data6)
check('GET /api/summary/patient-data  has medications key', 'medications' in data6)
check('GET /api/summary/patient-data  has documents key', 'documents' in data6)

status7, data7 = api('GET', '/api/summary/latest', auth=True)
check('GET /api/summary/latest  HTTP 200', status7 == 200, f'HTTP {status7}')

# ── Q&A ────────────────────────────────────────────────────────
print('\n[Q&A]')
status8, data8 = api('GET', '/api/qa/history', auth=True)
check('GET /api/qa/history  HTTP 200', status8 == 200, f'HTTP {status8}')
check('GET /api/qa/history  has history key', 'history' in data8)

# ── Logout ─────────────────────────────────────────────────────
print('\n[Auth — Logout]')
status9, data9 = api('POST', '/api/auth/logout', auth=True)
check('POST /api/auth/logout  HTTP 200', status9 == 200)
status10, _ = api('GET', '/api/documents/', auth=True)
check('GET /api/documents/  401 after logout', status10 == 401, f'HTTP {status10}')

# ── Summary ────────────────────────────────────────────────────
print()
print('=' * 56)
passed = sum(results)
total = len(results)
print(f'  Results: {passed}/{total} passed', '✓ ALL OK' if passed == total else '✗ SOME FAILED')
print('=' * 56)
sys.exit(0 if passed == total else 1)
