import sys

with open(r'E:\IBM\IBM Bob\resources\app\extensions\bob-code\dist\extension.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

import re
# Find inference-related JSON-RPC methods
section = content[9000000:9700000]
methods = re.findall(r'"([a-zA-Z]+/[a-zA-Z/]+)"', section)
unique = sorted(set(m for m in methods if any(x in m.lower() for x in ['inference','chat','generate','model','complete'])))
print('Methods:', unique[:20])

# Look for a local HTTP server port exposed by the extension
for port_str in ['7768', '11434', '8765', '3001', '3002']:
    idx = content.find(port_str)
    if idx > 0:
        s = content[max(0,idx-100):idx+150]
        print(f'\nPort {port_str} context:', repr(s[:200]))
