with open(r'E:\IBM\IBM Bob\resources\app\extensions\bob-code\dist\extension.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

import re

# The gateway URL is bob.gateway.example.com in docs but let's find the real one
# The Bob extension uses VITE_GATEWAY_BASE_URL env var OR falls back to api.us-east.bob.ibm.com
# Let's look at what URL the Vercel AI SDK pGn is called with in Bob's code
# pGn returns the gateway - search for where it's called with Bob config

# Find where vzt (the gateway instance) is used or configured with Bob URL
idx = content.find('vzt')
count = 0
while idx > 0 and count < 10:
    s = content[max(0,idx-100):idx+200]
    if any(x in s for x in ['baseURL', 'bob.ibm', 'gateway', 'chat', 'model', 'pGn']):
        print(f'vzt at {idx}:', repr(s[:250]))
        print()
    idx = content.find('vzt', idx+1)
    count += 1

# Also look for where the BQn provider uses the gateway
# BQn.provider = bHt({name: 'bob', baseURL: 'https://placeholder.invalid'...})
# The baseURL placeholder suggests it gets overridden at runtime
# Find where the provider baseURL is actually set for inference
idx = content.find('placeholder.invalid')
if idx > 0:
    s = content[max(0,idx-50):idx+400]
    print('placeholder.invalid context:')
    print(repr(s[:400]))
