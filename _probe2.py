import sys, re

with open(r'E:\IBM\IBM Bob\resources\app\extensions\bob-code\dist\extension.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Find the auth mode handler - look for apikey auth mode
# The key bob_prod_bob-apikey_ - look for how authMode=api-key is handled
for term in ['api-key', 'apikey', 'api_key', 'authMode', 'auth-method']:
    idx = content.find(f'"{term}"')
    if idx < 0:
        idx = content.find(f"'{term}'")
    count = 0
    while idx > 0 and count < 5:
        s = content[max(0,idx-100):idx+300]
        if any(x in s for x in ['token', 'exchange', 'bearer', 'jwt', 'fetch', 'inference']):
            print(f'[{term}] at {idx}:')
            print(repr(s[:350]))
            print('---')
            break
        idx = content.find(f'"{term}"', idx+1)
        count += 1

# The key likely goes directly as Bearer after the token endpoint call
# Search for where the BobShell auth flow processes 'bob_prod_' keys
# Look at what happens to BOBSHELL_API_KEY
for env_var in ['BOBSHELL_API_KEY', 'BOB_API_KEY', 'bob_apikey']:
    idx = content.find(env_var)
    if idx > 0:
        print(f'\n{env_var} at {idx}:')
        print(repr(content[max(0,idx-200):idx+300]))
