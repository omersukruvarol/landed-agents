import json, glob, os, collections
files = glob.glob(os.path.expanduser('~/.claude/projects/*/*.jsonl')) + glob.glob(os.path.expanduser('~/.claude/projects/*/*/subagents/*.jsonl'))
tool_names = collections.Counter(); res_keys = collections.defaultdict(collections.Counter); inp_keys=collections.defaultdict(collections.Counter)
patch_sample=None
for f in files:
    with open(f, errors='ignore') as fh:
        for line in fh:
            if '"tool_use"' not in line and 'toolUseResult' not in line: continue
            try: d=json.loads(line)
            except: continue
            msg=d.get('message') or {}
            c=msg.get('content')
            if isinstance(c,list):
                for b in c:
                    if isinstance(b,dict) and b.get('type')=='tool_use':
                        tool_names[b.get('name')]+=1
                        if b.get('name') in ('Edit','Write','MultiEdit','NotebookEdit'):
                            inp_keys[b['name']].update((b.get('input') or {}).keys())
            r=d.get('toolUseResult')
            if isinstance(r,dict) and ('filePath' in r or 'structuredPatch' in r):
                res_keys[r.get('type','?')].update(r.keys())
                if patch_sample is None and r.get('structuredPatch'):
                    sp=r['structuredPatch'][0]; patch_sample={k:(type(v).__name__) for k,v in sp.items()}
print(len(files),'files'); print(tool_names.most_common(25)); print(dict(inp_keys)); print({k:dict(v) for k,v in res_keys.items()}); print(patch_sample)
