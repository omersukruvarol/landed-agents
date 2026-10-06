import json, glob, os, collections
files = sorted(glob.glob(os.path.expanduser('~/.codex/sessions/**/rollout-*.jsonl'), recursive=True))
print(len(files),'files', files[0][-60:], files[-1][-60:])
item_types=collections.Counter(); fc_shape=None; tool_calls=collections.Counter(); ch_types=collections.Counter()
n=0
for f in files[-400:]:
    with open(f, errors='ignore') as fh:
        for line in fh:
            if 'FileChange' not in line and 'apply_patch' not in line and 'item_completed' not in line and 'function_call' not in line: continue
            try: d=json.loads(line)
            except: continue
            p=d.get('payload') or {}
            if p.get('type')=='item_completed':
                it=p.get('item') or {}; item_types[it.get('type')]+=1
                if it.get('type')=='FileChange':
                    ch=it.get('changes')
                    if fc_shape is None:
                        if isinstance(ch,list) and ch: fc_shape=('list',{k:type(v).__name__ for k,v in ch[0].items()}, {k:(type(v).__name__, (list(v.keys()) if isinstance(v,dict) else None)) for k,v in ch[0].items()})
                        elif isinstance(ch,dict): k0=next(iter(ch)); fc_shape=('dict', type(ch[k0]).__name__, list(ch[k0].keys()) if isinstance(ch[k0],dict) else None)
                        print('FileChange item keys', list(it.keys()))
                    if isinstance(ch,list):
                        for c in ch:
                            k=c.get('kind'); ch_types[json.dumps(k)[:60]]+=1
            if p.get('type') in ('function_call','custom_tool_call'):
                tool_calls[p.get('name')]+=1
print(item_types); print(fc_shape); print(ch_types.most_common(10)); print(tool_calls.most_common(15))
