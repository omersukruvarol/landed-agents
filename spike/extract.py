"""Extract agent file edits (Claude + Codex) into edits.jsonl with normalized added lines."""
import json, glob, os, re, hashlib, subprocess, sys
H=os.path.expanduser
WS=re.compile(r'\s+')
def norm(l): return WS.sub(' ', l.strip())
def significant(l):
    return len(l) >= 8 and re.search(r'[A-Za-z0-9]', l) is not None
def diff_lines(text):
    add,rem=[],[]
    for l in text.splitlines():
        if l.startswith('+++') or l.startswith('---'): continue
        if l.startswith('+'): add.append(l[1:])
        elif l.startswith('-'): rem.append(l[1:])
    return add,rem

repo_cache={}
def repo_root(path):
    d=os.path.dirname(path)
    chain=[]
    while d and d!='/':
        if d in repo_cache: r=repo_cache[d]; break
        chain.append(d)
        if os.path.isdir(os.path.join(d,'.git')) or os.path.isfile(os.path.join(d,'.git')): r=d; break
        d=os.path.dirname(d)
    else: r=None
    for c in chain: repo_cache[c]=r
    return r

out=[]
def emit(agent, session, ts, path, add, rem, kind):
    s=[norm(l) for l in add]; s=[l for l in s if significant(l)]
    r=[norm(l) for l in rem]; r=[l for l in r if significant(l)]
    # lines that were merely moved within the same hunk are not new
    rs=set(r); s=[l for l in s if l not in rs]
    out.append(dict(agent=agent, session=session, ts=ts, path=path, kind=kind,
                    repo=repo_root(path) if path.startswith('/') else None,
                    added=s, n_added_raw=len(add), n_removed_raw=len(rem)))

# ---- Claude
seen=set()
cfiles=glob.glob(H('~/.claude/projects/*/*.jsonl'))+glob.glob(H('~/.claude/projects/*/*/subagents/*.jsonl'))
for f in cfiles:
    with open(f, errors='ignore') as fh:
        for line in fh:
            if 'toolUseResult' not in line or 'structuredPatch' not in line: continue
            try: d=json.loads(line)
            except: continue
            r=d.get('toolUseResult')
            if not isinstance(r,dict) or 'filePath' not in r: continue
            tuid=None
            c=(d.get('message') or {}).get('content')
            if isinstance(c,list):
                for b in c:
                    if isinstance(b,dict) and b.get('type')=='tool_result': tuid=b.get('tool_use_id')
            key=tuid or (d.get('uuid'))
            if key in seen: continue
            seen.add(key)
            add,rem=[],[]
            sp=r.get('structuredPatch') or []
            for h in sp:
                for l in h.get('lines',[]):
                    if l.startswith('+'): add.append(l[1:])
                    elif l.startswith('-'): rem.append(l[1:])
            if not sp and r.get('type')=='create':
                add=(r.get('content') or '').splitlines()
            emit('claude', d.get('sessionId'), d.get('timestamp'), r['filePath'], add, rem, r.get('type') or 'edit')

# ---- Codex
xfiles=sorted(glob.glob(H('~/.codex/sessions/**/rollout-*.jsonl'), recursive=True))
for f in xfiles:
    sid=os.path.basename(f)[-41:-6]; cwd=None
    with open(f, errors='ignore') as fh:
        for line in fh:
            if '"session_meta"' in line or '"turn_context"' in line:
                try:
                    p=json.loads(line).get('payload') or {}
                    cwd=p.get('cwd') or cwd
                except: pass
                continue
            if 'FileChange' not in line and 'apply_patch' not in line: continue
            try: d=json.loads(line)
            except: continue
            p=d.get('payload') or {}; ts=d.get('timestamp')
            if p.get('type')=='item_completed' and (p.get('item') or {}).get('type')=='FileChange':
                it=p['item']
                if it.get('status') not in (None,'completed','Completed','success'): continue
                for path,c in (it.get('changes') or {}).items():
                    if not path.startswith('/') and cwd: path=os.path.join(cwd,path)
                    t=c.get('type')
                    if t=='add':
                        txt=c.get('content') or c.get('unified_diff') or ''
                        add=[l[1:] if l.startswith('+') else l for l in txt.splitlines()]; rem=[]
                    elif t=='update':
                        add,rem=diff_lines(c.get('unified_diff') or '')
                    else: continue
                    emit('codex', sid, ts, path, add, rem, t)
            elif p.get('type')=='custom_tool_call' and p.get('name')=='apply_patch':
                txt=p.get('input') or ''
                cur=None; add=[]; rem=[]; kind=None
                def flush():
                    if cur: emit('codex', sid, ts, cur, add, rem, kind or 'update')
                for l in txt.splitlines():
                    m=re.match(r'\*\*\* (Add|Update|Delete) File: (.*)', l)
                    if m:
                        flush(); kind=m.group(1).lower(); cur=m.group(2).strip(); add=[]; rem=[]
                        if not cur.startswith('/') and cwd: cur=os.path.join(cwd,cur)
                        if kind=='delete': cur=None
                        continue
                    if cur is None: continue
                    if l.startswith('+'): add.append(l[1:])
                    elif l.startswith('-'): rem.append(l[1:])
                flush()

# dedupe codex: apply_patch call + its FileChange item describe the same edit
uniq={}; 
for e in out:
    k=(e['agent'], e['session'], e['path'], hashlib.sha1('\n'.join(e['added']).encode()).hexdigest())
    if e['agent']=='codex' and k in uniq: continue
    uniq[k]=e
edits=list(uniq.values())
with open('edits.jsonl','w') as fo:
    for e in edits: fo.write(json.dumps(e)+'\n')
import collections
c=collections.Counter((e['agent'], 'repo' if e['repo'] else 'no-repo', 'sig' if e['added'] else 'nosig') for e in edits)
for k,v in sorted(c.items()): print(k,v)
repos=collections.Counter((e['agent'],e['repo']) for e in edits if e['repo'] and e['added'])
print(len(set(r for _,r in repos)),'repos'); 
for (a,r),v in repos.most_common(30): print(a, v, r)
