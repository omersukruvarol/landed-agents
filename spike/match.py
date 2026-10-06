"""Match agent edits against git history -> landed / uncommitted / lost, per edit and per session-file net."""
import json, os, re, subprocess, collections, datetime, statistics, random
WS=re.compile(r'\s+')
def norm(l): return WS.sub(' ', l.strip())
def iso(ts): return datetime.datetime.fromisoformat(ts.replace('Z','+00:00')).timestamp()

edits=[json.loads(l) for l in open('edits.jsonl')]
edits=[e for e in edits if e['repo'] and e['added'] and os.path.isdir(e['repo'])]
for e in edits: e['t']=iso(e['ts']); e['rel']=os.path.relpath(e['path'], e['repo'])
by_repo=collections.defaultdict(list)
for e in edits: by_repo[e['repo']].append(e)

def index(repo, since, rels, rev):
    """map rel -> line -> [(commit_time, sha, subject)] for '+' lines in commits."""
    idx=collections.defaultdict(lambda: collections.defaultdict(list))
    cmd=['git','-C',repo,'log',*rev,'-p','--no-color','--no-ext-diff','-U0',f'--since={int(since)}','--format=@@C %H %ct %s']
    p=subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors='ignore')
    cur=None; f=None
    for line in p.stdout:
        if line.startswith('@@C '):
            parts=line[4:].rstrip('\n').split(' ',2); cur=(int(parts[1]), parts[0][:9], parts[2] if len(parts)>2 else ''); continue
        if line.startswith('+++ '):
            path=line[4:].strip(); f=path[2:] if path.startswith('b/') else None
            if f not in rels: f=None
            continue
        if f and cur and line.startswith('+') and not line.startswith('+++'):
            idx[f][norm(line[1:])].append(cur)
    p.wait()
    return idx

def tree_lines(path):
    try:
        with open(path, errors='ignore') as fh: return set(norm(l) for l in fh)
    except Exception: return None

def classify(lines, t, rel, path, idx_all, idx_head, slack=120):
    hit_all=[];hit_head=0
    for l in lines:
        cs=[c for c in idx_all.get(rel,{}).get(l,[]) if c[0]>=t-slack]
        if cs: hit_all.append(min(cs))
        if any(c[0]>=t-slack for c in idx_head.get(rel,{}).get(l,[])): hit_head+=1
    n=len(lines); fa=len(hit_all)/n; fh=hit_head/n
    tl=tree_lines(path); ft=(sum(1 for l in lines if l in tl)/n) if tl is not None else 0
    if fa>=0.5: cls='landed'
    elif ft>=0.5: cls='uncommitted'
    elif fa>0 or ft>0: cls='partial'
    else: cls='lost'
    lag=(min(hit_all)[0]-t) if hit_all else None
    commit=min(hit_all) if hit_all else None
    return dict(cls=cls, fa=fa, fh=fh, ft=ft, lag=lag, commit=commit)

results=[]; net_results=[]
for repo, es in by_repo.items():
    rels=set(e['rel'] for e in es); since=min(e['t'] for e in es)-86400
    idx_all=index(repo, since, rels, ['--all']); idx_head=index(repo, since, rels, ['HEAD'])
    for e in es:
        r=classify(e['added'], e['t'], e['rel'], e['path'], idx_all, idx_head); r.update(agent=e['agent'], repo=repo, rel=e['rel'], session=e['session'], ts=e['ts'], n=len(e['added']), sample=e['added'][:2])
        results.append(r)
    # session-file net: lines added by the session and not removed by a later edit in the same session
    groups=collections.defaultdict(list)
    for e in es: groups[(e['agent'],e['session'],e['rel'])].append(e)
    raw={ (json.loads(l)['agent'],json.loads(l)['session'],json.loads(l)['path']) for l in []}
    for (a,s,rel),g in groups.items():
        g.sort(key=lambda e:e['t'])
        final=collections.OrderedDict()
        for e in g:
            for l in e['added']: final[l]=e['t']
        lines=list(final.keys())
        if not lines: continue
        t=min(final.values())
        r=classify(lines, t, rel, g[-1]['path'], idx_all, idx_head); r.update(agent=a, repo=repo, rel=rel, session=s, n=len(lines), edits=len(g))
        net_results.append(r)

json.dump(dict(edits=results, net=net_results), open('results.json','w'), default=str)
def report(rs, title):
    print(f'\n== {title}')
    for agent in ('claude','codex','ALL'):
        sub=[r for r in rs if agent=='ALL' or r['agent']==agent]
        if not sub: continue
        c=collections.Counter(r['cls'] for r in sub); n=len(sub)
        w=sum(r['n'] for r in sub); wl=sum(r['n']*r['fa'] for r in sub)
        head=sum(1 for r in sub if r['fh']>=0.5)
        print(f"{agent:7} n={n:5}  " + '  '.join(f"{k}={c[k]/n:5.1%}" for k in ('landed','uncommitted','partial','lost')) + f"  | on HEAD={head/n:5.1%} | line-weighted landed={wl/w:5.1%}")
    lags=[r['lag']/3600 for r in rs if r['lag'] is not None]
    if lags: print(f"commit lag hours: median={statistics.median(lags):.1f} p90={sorted(lags)[int(len(lags)*.9)]:.1f}")
report(results,'PER EDIT')
report(net_results,'PER SESSION x FILE (net)')
print('\n== per repo (net, landed / uncommitted / lost)')
for repo in by_repo:
    for agent in ('claude','codex'):
        sub=[r for r in net_results if r['repo']==repo and r['agent']==agent]
        if len(sub)<5: continue
        c=collections.Counter(r['cls'] for r in sub); n=len(sub)
        print(f"{agent:6} {n:4} {c['landed']/n:5.0%} {c['uncommitted']/n:5.0%} {c['partial']/n:5.0%} {c['lost']/n:5.0%}  {repo.replace(os.path.expanduser('~'),'~')}")
