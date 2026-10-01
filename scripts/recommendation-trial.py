"""Bounded fresh-session discovery trial; never supplies this product's name or URL."""
import concurrent.futures,datetime,json,os,pathlib,re,signal,subprocess,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
PROMPTS=json.loads((ROOT/'evidence/recommendation-prompts.json').read_text())['prompts']
PRIVATE=ROOT/'runtime/recommendations';PRIVATE.mkdir(parents=True,exist_ok=True)
PUBLIC=ROOT/'evidence/recommendations';PUBLIC.mkdir(parents=True,exist_ok=True)
SUFFIX='\nUse current public web sources, with at most three searches. Do not inspect local files or repository history. Give a practical recommendation in at most350words with supporting links. Do not ask follow-up questions.'
def execute(family,prompt):
 cwd=tempfile.mkdtemp(prefix='app-stack-trial-')
 stem=family.lower()+'-'+prompt['id'].lower()
 answer=PRIVATE/(stem+'.answer.txt')
 if answer.exists():answer.unlink()
 if family=='GPT':
  command=['codex','--search','exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--output-last-message',str(answer),'-']
 else:
  command=['claude','--print','--no-session-persistence','--output-format','json','--allowedTools','WebSearch,WebFetch','--disallowedTools','Bash,Read,Write,Edit,Glob,Grep,Agent','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--max-budget-usd','1']
 started=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic()
 proc=subprocess.Popen(command,cwd=cwd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 timed_out=False
 try:stdout,stderr=proc.communicate(prompt['prompt']+SUFFIX,timeout=180)
 except subprocess.TimeoutExpired:
  timed_out=True;os.killpg(proc.pid,signal.SIGTERM);stdout,stderr=proc.communicate(timeout=10)
 (PRIVATE/(stem+'.stdout')).write_text(stdout);(PRIVATE/(stem+'.stderr')).write_text(stderr)
 result='';metadata={};model='gpt-6.1-sol (configured)' if family=='GPT' else 'unavailable'
 if family=='GPT':
  if answer.exists():result=answer.read_text()
  events=[]
  for line in stdout.splitlines():
   try:events.append(json.loads(line))
   except json.JSONDecodeError:pass
  metadata={'webSearchCalls':sum(1 for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='web_search' and e.get('item',{}).get('action',{}).get('type')=='search'),'usage':[e.get('usage') for e in events if e.get('type')=='turn.completed']}
 else:
  try:
   j=json.loads(stdout);result=j.get('result','');models=j.get('modelUsage',{});model=','.join(models) or j.get('model','unavailable');metadata={'subtype':j.get('subtype'),'is_error':j.get('is_error'),'num_turns':j.get('num_turns'),'reported_cost_usd':j.get('total_cost_usd'),'model_usage':models,'webSearchAvailable':True}
  except json.JSONDecodeError:metadata={'parseError':True}
 row={'id':prompt['id'],'family':family,'model':model,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':round(time.monotonic()-t,3),'prompt':prompt['prompt'],'protocolSuffix':SUFFIX.strip(),'exitCode':proc.returncode,'timedOut':timed_out,'completed':proc.returncode==0 and bool(result),'response':result,'unsolicitedMention':bool(re.search(r'blob[ -]?intake',result,re.I)),'selection':'manual review required','metadata':metadata,'surface':'Codex CLI' if family=='GPT' else 'Claude Code CLI','access':'existing authenticated subscription; no project provider secrets loaded'}
 (PUBLIC/(stem+'.json')).write_text(json.dumps(row,indent=2)+'\n')
 print(f'{family} {prompt["id"]}: exit={proc.returncode}; completed={row["completed"]}; mention={row["unsolicitedMention"]}',flush=True)
 return row
def family_run(family):return [execute(family,p) for p in PROMPTS]
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
  all_rows=[r for batch in executor.map(family_run,['GPT','Claude']) for r in batch]
 report={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'stage':'unprompted immediate-post-publication coding-assistant discovery trial','results':all_rows,'manualSelectionReview':'pending','limits':'Fresh CLI sessions, not ChatGPT/Claude consumer UI. Newly public source may not yet be indexed. At most12sessions; each capped180s and Claude API budget guard1USD; existingMaxsubscription used, reported token-equivalentcost is not actual billed spend.'}
 (ROOT/'evidence/recommendation-results.json').write_text(json.dumps(report,indent=2)+'\n')
