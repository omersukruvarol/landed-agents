import json, os, re, subprocess, collections, random, datetime
exec(open('match.py').read().split("results=[]; net_results=[]")[0])  # reuse helpers + edits/by_repo
random.seed(7)
ctrl=collections.Counter(); tot=collections.Counter(); fa_hist=collections.Counter(); surv=collections.Counter()
for repo, es in by_repo.items():
    rels=set(e['rel'] for e in es); since=min(e['t'] for e in es)-86400*60
    idx_all=index(repo, since, rels, ['--all'])
    rel_list=sorted(rels)
    for e in es:
        L=e['added']; n=len(L); t=e['t']
        # control A: same file, commits BEFORE the edit (pre-existing / coincidental lines)
        pre=sum(1 for l in L if any(t-86400*60 <= c[0] < t-120 for c in idx_all.get(e['rel'],{}).get(l,[])))/n
        # control B: different random file in same repo, commits after edit
        other=random.choice(rel_list)
        oth=sum(1 for l in L if any(c[0]>=t-120 for c in idx_all.get(other,{}).get(l,[])))/n if other!=e['rel'] else None
        post=sum(1 for l in L if any(c[0]>=t-120 for c in idx_all.get(e['rel'],{}).get(l,[])))/n
        a=e['agent']; tot[a]+=1
        if pre>=0.5: ctrl[(a,'A_pre>=.5')]+=1
        if oth is not None:
            tot[(a,'B')]+=1
            if oth>=0.5: ctrl[(a,'B_other>=.5')]+=1
        if post>=0.5:
            fa_hist[(a, 'fa=1.0' if post==1 else 'fa .5-.99')]+=1
            tl=tree_lines(e['path'])
            s=(sum(1 for l in L if l in tl)/n) if tl else 0
            surv[(a,'still in tree' if s>=0.5 else 'gone from tree')]+=1
for a in ('claude','codex'):
    print(a, 'n=',tot[a], ' controlA(pre-existing)=%.1f%%'%(100*ctrl[(a,'A_pre>=.5')]/tot[a]), ' controlB(other file)=%.1f%%'%(100*ctrl[(a,'B_other>=.5')]/max(1,tot[(a,'B')])),
          ' landed fa:', {k[1]:v for k,v in fa_hist.items() if k[0]==a}, ' survival:', {k[1]:v for k,v in surv.items() if k[0]==a})
