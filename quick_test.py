"""Quick upload test to diagnose 500 error."""
import urllib.request, urllib.error, json

BASE = 'http://localhost:5000'

# 1. Login
r = urllib.request.urlopen(
    urllib.request.Request(
        BASE + '/api/auth/login',
        data=json.dumps({'email': 'diag@test.com', 'phone': '+1000000000'}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST'
    ), timeout=8
)
d = json.loads(r.read())
otp = d['dev_otp']
uid = d['user_id']
print(f'[1] Login OK  OTP={otp}  uid={uid[:8]}...')

# 2. Verify OTP
r2 = urllib.request.urlopen(
    urllib.request.Request(
        BASE + '/api/auth/verify-otp',
        data=json.dumps({'user_id': uid, 'otp': otp}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST'
    ), timeout=8
)
d2 = json.loads(r2.read())
token = d2['token']
print(f'[2] OTP verified  token={token[:20]}...')

# 3. Upload a TXT file
sample = (
    b"PATIENT: Jane Smith\n"
    b"DATE OF BIRTH: 1990-05-20\n"
    b"GENDER: Female\n"
    b"Blood Pressure: 120/80 mmHg\n"
    b"Hemoglobin: 12.5 g/dL\n"
    b"DIAGNOSIS: Hypertension\n"
    b"MEDICATION: Amlodipine 5mg once daily\n"
)
boundary = 'QuickTestBoundary12345'
body = (
    ('--' + boundary + '\r\n').encode() +
    b'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n' +
    b'Content-Type: text/plain\r\n\r\n' +
    sample +
    ('\r\n--' + boundary + '--\r\n').encode()
)

try:
    req = urllib.request.Request(
        BASE + '/api/documents/upload',
        data=body,
        headers={
            'Content-Type': f'multipart/form-data; boundary={boundary}',
            'Authorization': f'Bearer {token}',
        },
        method='POST'
    )
    r3 = urllib.request.urlopen(req, timeout=30)
    d3 = json.loads(r3.read())
    print(f'[3] Upload HTTP {r3.status}  doc_id={d3.get("document_id","?")}')
    print(f'    facts_preview keys: {list(d3.get("facts_preview", {}).keys())}')
    fp = d3.get('facts_preview', {})
    for k in ('lab_results', 'vital_signs', 'diagnoses', 'medications'):
        items = fp.get(k, [])
        print(f'    {k}: {len(items)} items')
except urllib.error.HTTPError as e:
    body_err = e.read().decode()
    print(f'[3] Upload FAILED HTTP {e.code}')
    print(f'    Error: {body_err[:800]}')
