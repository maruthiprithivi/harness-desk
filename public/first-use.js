(() => {
  'use strict';
  const views = new WeakMap();
  const list = value => Array.isArray(value) ? value : [];
  const number = value => new Intl.NumberFormat().format(value);
  const pathName = value => String(value || '').replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || 'Global setup';
  const stamp = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(); };
  const scopeKey = props => JSON.stringify([props.agent, props.repo || '', props.loading?.launchDirectory || '']);
  const validTokens = value => Number.isFinite(value) && value >= 0;
  function prioritizeInsights(records, files, repo) {
    const byId = new Map(list(files).map(file => [file.id,file]));
    const normalize = value => String(value || '').replaceAll('\\','/');
    const paths = new Set(list(files).map(file=>normalize(file.path)));
    const cached = file => /(?:^|\/)plugins\/cache\//i.test(normalize(file?.path));
    const priority = record => {
      const file = byId.get(record.itemId);
      if (file?.type === 'instruction' && file.status === 'applies') return repo && file.repo===repo ? 0 : 1;
      if (repo && file?.repo === repo && !cached(file)) return 2;
      if (record.confidence === 'user supplied measurement') return 3;
      return cached(file) ? 5 : 4;
    };
    // Cached versions remain inspectable in Files; an identical copy is not a startup saving.
    return list(records).filter(record => {
      const file=byId.get(record.itemId);
      return !(record.confidence==='exact content match' && (cached(file) || file?.duplicateOf && !paths.has(normalize(file.duplicateOf))));
    })
      .slice().sort((a,b) => priority(a) - priority(b));
  }
  function sources(loading) {
    const seen = new Set();
    return list(loading?.groups).flatMap(group => list(group.files)).filter(file => {
      if (file.type !== 'instruction' || file.status !== 'applies' || seen.has(file.id || file.path)) return false;
      seen.add(file.id || file.path); return true;
    }).map(file => ({...file, origin: !file.repo ? file.role==='ancestor instruction'||file.scope==='path'?'Folder':'Global' : ['subdir','path-rule'].includes(file.scope) ? 'Folder' : 'Project'}));
  }
  const percentageReading = record => record?.method === 'kiro-reported-context-percentage' && Number.isFinite(record.contextPercentage) && record.contextPercentage >= 0 && record.contextPercentage <= 100;
  function measurements(records, agent, repo, launchDirectory) {
    return list(records).filter(record => record.agent === agent && (record.repo || '') === (repo || '') &&
      (!repo || (record.launchDirectory || '') === (launchDirectory || '')) && (validTokens(record.inputTokens) || percentageReading(record)))
      .sort((a,b) => String(b.measuredAt || '').localeCompare(String(a.measuredAt || '')));
  }
  function occupancy(record) {
    if (percentageReading(record)) return record.contextPercentage;
    return validTokens(record?.inputTokens) && Number.isFinite(record?.capacity) && record.capacity > 0
      ? record.inputTokens / record.capacity * 100 : null;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text); return node;
  }
  function button(label, action, primary = false) {
    const node = element('button', 'button ' + (primary ? 'primary' : 'secondary'), label);
    node.type = 'button'; node.addEventListener('click', action); return node;
  }
  function details(label, text) {
    const node = element('details', 'first-use-details'); node.append(element('summary', '', label), element('p', '', text)); return node;
  }
  function render(root, props) {
    const focused = root.contains(document.activeElement) ? document.activeElement?.dataset?.firstUseFocus : null;
    const selection=focused?{start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
    const key = scopeKey(props);
    let view = views.get(root);
    if (!view || view.key !== key) {
      view = {key, props, collecting:false, files:null, path:'', preview:null, before:'', after:'', comparison:null, busy:'', error:'', notice:'', captured:[], localRuns:[], acknowledge:false, newBaseline:false,
        draft:{prompt:'Briefly explain the instructions you will follow for this project. Do not run tools or change files.',expectedText:'',model:'',launchDirectory:props.loading?.launchDirectory || props.repo || ''}};
      views.set(root, view);
    }
    view.props = props;
    const current = () => views.get(root) === view;
    const paint = () => { if (current()) render(root, view.props); };
    const run = async (name, action) => {
      if (view.busy || !current()) return;
      view.busy = name; view.lastAction=name; view.error = ''; view.notice = ''; paint();
      try { await action(); } catch (error) { if (current()) view.error = error.message || 'This action could not finish. Try again.'; }
      finally { if (current()) { view.busy = ''; paint(); } }
    };
    const invoke = callback => (...args) => { if (current()) callback?.(...args); };
    const records = measurements([...list(props.state?.contextEvidence), ...view.captured],props.agent,props.repo,props.loading?.launchDirectory)
      .filter((record,index,all) => all.findIndex(item => item.id === record.id) === index);
    const supported = ['claude','codex'].includes(props.agent);
    const agentName = list(props.state?.agents).find(agent=>agent.id===props.agent)?.name || ({claude:'Claude Code',codex:'Codex',opencode:'OpenCode',omp:'Oh My Pi',pi:'Pi',kiro:'Kiro',kimi:'Kimi Code'}[props.agent]) || props.agent || 'Your agent';
    const capability = props.state?.agentSupport?.[props.agent];
    const automaticSupported = capability ? capability.verification === 'automatic' : supported;
    const allRuns=[...list(props.state?.verificationRuns),...view.localRuns].filter((record,index,all)=>all.findIndex(item=>item.id===record.id)===index);
    const runs=allRuns
      .filter(record=>record.agent===props.agent && (record.repo || '')===(props.repo || '') && (!props.repo || record.launchDirectory===(props.loading?.launchDirectory || props.repo)))
      .sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const page = element('div','first-use');
    const head = element('header','first-use-heading');
    head.append(element('p','first-use-scope',agentName + ' in ' + (props.repo ? pathName(props.repo) : 'Global setup')));
    head.append(element('p','first-use-meta',automaticSupported ? 'Automatic measurement and response checks available' : 'Configuration discovery · automatic measurement not available yet'));
    if(capability?.detail)head.append(element('p','first-use-muted',capability.detail));
    if(props.state?.agentSupport) {
      const support=element('details','first-use-details'); support.append(element('summary','','Compare agent support'));
      const table=element('table','first-use-support'),caption=element('caption','','Installed does not mean fully supported. Loading predictions are separate from observed session tokens.');table.append(caption);
      const thead=element('thead'),tr=element('tr');for(const title of ['Agent','Configuration','Measurement / check'])tr.append(element('th','',title));thead.append(tr);table.append(thead);
      const tbody=element('tbody');
      for(const item of list(props.state.agents)) {
        const cap=props.state.agentSupport[item.id];if(!cap)continue;
        const row=element('tr');row.append(element('th','',item.name),element('td','',cap.loading==='predicted'?'Discovery + predicted loading':'Discovery only'),element('td','',cap.verification==='automatic'?(cap.measurement==='context-percentage'?'After-response % · no token comparison':cap.validation==='live-tested'?'Automatic · real session checked on macOS':'Automatic · synthetic tests only'):'Not available yet'));tbody.append(row);
      }
      table.append(tbody);support.append(table);head.append(support);
    }
    page.append(head);
    if (!list(props.state?.inventory?.repos).length && !props.repo) {
      const welcome=element('section','first-use-section first-use-welcome');
      welcome.append(element('h2','','Start with a project you already use'),element('p','first-use-muted','Add its folder to see the project instructions alongside your agent’s global setup. Your files stay on this machine.'),button('Add your first project',invoke(props.onAddProject),true));
      if(!props.state?.inventory?.scannedAt)welcome.append(button('Discover global setup',()=>run('Discovering setup',async()=>{await view.props.api('/api/scan',{});await view.props.onRefresh?.();})));
      page.append(welcome);
    }
    const foreignActive=allRuns.find(record=>record.status==='running' && !runs.some(local=>local.id===record.id));
    if(foreignActive) {
      const runningName=list(props.state?.agents).find(agent=>agent.id===foreignActive.agent)?.name || foreignActive.agent;
      const banner=element('section','first-use-active');banner.setAttribute('aria-label','Active verification');
      banner.append(element('h2','','A verification is already running'),element('p','',runningName+' · '+(foreignActive.repo?pathName(foreignActive.repo):'Global setup')),element('p','first-use-path','Launch folder: '+foreignActive.launchDirectory),element('p','first-use-muted','Wait for this check to finish before starting another. Its results belong to that project and agent.'));
      const actions=element('div','first-use-actions');
      actions.append(button('View running check',invoke(()=>props.onViewRun?.(foreignActive))),button('Cancel running check',()=>run('Cancelling verification',async()=>{await view.props.api('/api/verification',{action:'cancel',id:foreignActive.id});await view.props.onRefresh?.();})));
      banner.append(actions);page.append(banner);
    }
    const journey = element('ol','first-use-journey'); journey.setAttribute('aria-label','Your next steps');
    for (const [title,description] of [['Understand','See sources and measure a session'],['Improve','Review one worthwhile change'],['Verify','Compare and check behavior']]) {
      const step = element('li'); step.append(element('strong','',title),element('span','',description)); journey.append(step);
    }
    page.append(journey);
    const sourceSection = element('section','first-use-section'); sourceSection.setAttribute('aria-label','Instruction sources');
    const sourceHead = element('div','first-use-section-heading'); sourceHead.append(element('h2','','Where your instructions come from'),button('Explore setup',invoke(props.onFiles)));
    sourceSection.append(sourceHead);
    const loadingMatches = props.loading?.agent === props.agent && (props.loading?.repo || '') === (props.repo || '');
    const sourceFiles = loadingMatches ? sources(props.loading) : [];
    if (!loadingMatches) sourceSection.append(element('p','first-use-muted','Select a project and agent to load their instruction hierarchy.'));
    else if(capability?.loading==='unverified') sourceSection.append(element('p','first-use-muted','Configuration files can be inspected, but this agent’s loading order has not been verified. Explore setup to see the discovered sources.'));
    else if (!sourceFiles.length) sourceSection.append(element('p','first-use-muted',props.state?.inventory?.scannedAt?'No applicable instruction files were found in this scan. Explore setup to review discovery coverage.':'Your files have not been scanned yet. Add a project or discover global setup to see your sources.'));
    else {
      sourceSection.append(element('p','first-use-muted','Predicted from your files. Session counters do not confirm which individual files were read.'));
      const rows = element('ul','first-use-sources');
      for (const file of sourceFiles) {
        const row = element('li'); row.append(element('span','first-use-origin',file.origin));
        const label = element('span','first-use-source-name'); label.append(element('strong','',file.name || pathName(file.path)),element('span','first-use-path',file.path || ''));
        row.append(label,button('Open file',invoke(() => props.onEdit?.(file.id)))); rows.append(row);
      }
      sourceSection.append(rows);
    }
    page.append(sourceSection);
    if(records.length) {
      const evidence=element('section','first-use-section');
      evidence.append(element('h2','','What was actually measured'),observed(records[0],percentageReading(records[0])?'Latest context reading':'Latest first request'),element('p','first-use-muted','This is an observed session total. System prompt, tool, MCP and skill costs are not separately reported by this capture. The source list above remains a prediction.'));
      page.append(evidence);
    }
    const automatic=element('section','first-use-section first-use-automatic');automatic.append(element('h2','','Measure a fresh session'));
    if(!automaticSupported)automatic.append(element('p','first-use-muted','Automatic measurement is not available for '+agentName+' yet. You can inspect discovered configuration with Explore setup. No token saving is claimed for this integration.'));
    else {
      const latest=runs[0], active=runs.find(record=>record.status==='running');
      if(latest) {
        const result=element('div','first-use-run');
        result.append(element('h3','',latest.status==='running'?'Verification is running':latest.status==='completed'?'Latest verification run':'Verification '+latest.status));
        result.append(element('p','first-use-meta',stamp(latest.createdAt)),element('p','first-use-path','Launch folder: '+latest.launchDirectory));
        if(latest.status==='running')result.append(element('p','',agentName+' is starting a fresh session and running your task. Results will appear here.'));
        if(latest.error)result.append(element('p','first-use-warning',latest.error));
        if(latest.status==='cancelled'||latest.status==='interrupted')result.append(element('p','first-use-muted','This run did not finish. Review its state before starting a new check.'));
        const check=latest.check;
        if(check) {
          const outcome=typeof check==='string'?check:check.status || (check.passed===true?'passed':check.passed===false?'failed':'inconclusive');
          result.append(element('p','first-use-check','Response text check: '+(outcome==='not-configured'?'not requested':outcome)));
          if(check.description || check.message)result.append(element('p','first-use-muted',check.description || check.message));
        } else if(latest.status==='completed')result.append(element('p','first-use-muted','No response text check was requested. Completion alone does not verify instruction loading.'));
        const measured=records.find(record=>record.id===latest.measurementId);
        if(measured && !(latest.comparison?.comparable && latest.comparison.before && latest.comparison.after))result.append(observed(measured,percentageReading(measured)?'Context after response':'Observed first request'));
        if(!measured && latest.status==='completed')result.append(element('p','first-use-muted','No eligible first-request measurement was captured. Review the run’s evidence before claiming a saving.'));
        if(latest.comparison) {
          const comparison=latest.comparison,saved=comparison.reductionTokens ?? comparison.savedTokens;
          if(comparison.comparable && validTokens(comparison.before?.inputTokens) && validTokens(comparison.after?.inputTokens)) {
            const pair=element('div','first-use-pair');pair.append(observed(comparison.before,'Before'),observed(comparison.after,'After'));result.append(pair);
          }
          result.append(element('p','first-use-result',comparison.comparable && Number.isFinite(saved)?saved>0?number(saved)+' fewer input tokens observed':saved<0?number(-saved)+' more input tokens observed':'No change in reported input tokens':'These runs are not directly comparable.'));
          if(Number.isFinite(comparison.reductionPercentagePoints))result.append(element('p','first-use-meta',Math.abs(comparison.reductionPercentagePoints).toFixed(2)+' percentage points '+(comparison.reductionPercentagePoints>=0?'lower':'higher')+' against the same reported capacity'));
          for(const issue of list(comparison.issues || comparison.reasons))result.append(element('p','first-use-muted',issue));
          result.append(element('p','first-use-meta','Input change and the response text check are separate findings. Neither proves that every instruction was followed.'));
        }
        if(latest.answer)result.append(details('Agent response',latest.answer));
        if(latest.launch)result.append(element('p','first-use-meta',props.agent==='claude'?'Launch profile: permission prompts denied · one turn · current global and project configuration':props.agent==='codex'?'Launch profile: read-only shell sandbox · approvals denied · current global and project configuration':props.agent==='kiro'?'Launch profile: fresh session · no tools trusted · no sandbox':props.agent==='kimi'?'Launch profile: fresh session · headless agent permissions · no sandbox':props.agent==='opencode'?'Launch profile: fresh session · sharing disabled · no sandbox':'Launch profile: fresh ephemeral session · current global and project configuration · no sandbox'));
        result.append(details('Task used for this run',latest.prompt || 'Task unavailable'));automatic.append(result);
      }
      if(active)automatic.append(button('Cancel verification',()=>run('Cancelling verification',async()=>{
        const result=await view.props.api('/api/verification',{action:'cancel',id:active.id});
        if(!current())return;view.localRuns=view.localRuns.filter(record=>record.id!==active.id);if(result?.id)view.localRuns.push(result);
        await view.props.onRefresh?.();
      })));
      else {
        const baseline=!view.newBaseline && runs.find(record=>record.status==='completed' && !record.baselineId);
        const draft=baseline || view.draft;
        const form=element('div','first-use-run-form');
        form.append(element('h3','',baseline?'Check the setup after your change':'Start with a baseline'));
        form.append(element('p','first-use-muted',baseline?'Repeat the same task, model and launch folder so the results can be compared.':'Use a short task that exercises the instructions you want to improve. A literal response check is useful evidence, not proof that a file loaded.'));
        if(baseline) {
          form.append(details('Review the repeated task',baseline.prompt),element('p','first-use-meta','Model: '+(baseline.model || 'Agent default')+' · Expected response text: '+(baseline.expectedText || 'No literal check')));
          form.append(button('Set up a different baseline',()=>{if(view.busy)return;view.newBaseline=true;view.acknowledge=false;paint();}));
        } else {
          const fields=[['prompt','Representative task','textarea'],['expectedText','Literal response text check (optional)','input'],['model','Model (optional; uses the agent default)','input']];
          if(!props.repo)fields.unshift(['launchDirectory','Launch folder (absolute path)','input']);
          for(const [name,labelText,tag] of fields) {
            const label=element('label','first-use-field',labelText),input=element(tag);input.name='verification-'+name;input.id='first-use-'+name;input.value=view.draft[name];input.dataset.firstUseFocus='draft-'+name;
            if(tag==='textarea')input.rows=3;else input.type='text';
            input.addEventListener('input',()=>{if(!current()||view.busy)return;view.draft[name]=input.value;});label.append(input);form.append(label);
          }
        }
        const disclosure=element('p','first-use-disclosure','Starts real '+agentName+' with this global and project setup and uses account tokens. Configured hooks, extensions and MCP servers may run. '+(props.agent==='claude'?'Permission prompts are denied; previously allowed tools can still run. This is not a sandbox.':props.agent==='codex'?'The read-only shell sandbox does not prevent every possible side effect.':'The task asks the agent not to use tools. Tool execution is not sandboxed; your existing extensions and permissions still apply.'));
        form.append(disclosure);
        const consent=element('label','first-use-consent'),checkbox=element('input');checkbox.name='verification-consent';checkbox.id='first-use-consent';checkbox.type='checkbox';checkbox.checked=view.acknowledge;checkbox.dataset.firstUseFocus='verification-consent';
        checkbox.addEventListener('change',()=>{if(!current()||view.busy)return;view.acknowledge=checkbox.checked;paint();});consent.append(checkbox,element('span','','Allow this verification run'));form.append(consent);
        const start=button(baseline?'Run again after a change':'Run baseline check',()=>run('Starting verification',async()=>{
          const data={action:'start',agent:props.agent,repo:props.repo || '',launchDirectory:draft.launchDirectory,prompt:draft.prompt,expectedText:draft.expectedText || '',acknowledge:true};
          if(!data.prompt.trim())throw new Error('Add a representative task before starting the check.');
          if(!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(data.launchDirectory || ''))throw new Error('Enter an absolute launch-folder path before starting the check.');
          if(draft.model)data.model=draft.model;if(baseline)data.baselineId=baseline.id;
          view.acknowledge=false;
          const result=await view.props.api('/api/verification',data);
          if(!current())return;if(result?.id)view.localRuns.push(result);view.newBaseline=false;await view.props.onRefresh?.();
        }),true);
        const installation=list(props.state?.agents).find(agent=>agent.id===props.agent);
        const unavailable=installation && (!installation.installed || installation.auth==='signed-out');
        if(unavailable)form.append(element('p','first-use-warning',!installation.installed?'Install '+agentName+' and refresh agent discovery to run this check.':'Sign in to '+agentName+' and refresh agent discovery to run this check.'));
        start.disabled=!view.acknowledge || !!view.busy || !!unavailable || !!foreignActive;form.append(start);automatic.append(form);
      }
    }
    page.append(automatic);
    const manual=element('details','first-use-manual');manual.open=view.collecting;
    manual.append(element('summary','','Read an existing local session instead'));
    manual.addEventListener('toggle',()=>{if(current())view.manualOpen=manual.open;});if(view.manualOpen)manual.open=true;
    const context = element('section','first-use-section first-use-context'); context.setAttribute('aria-label','Observed context');
    const contextHead = element('div','first-use-section-heading'); contextHead.append(element('h2','','What your session reports'));
    if (supported) contextHead.append(button(view.collecting ? 'Close session reader' : 'Read a local session',() => {
      if (view.busy) return; view.collecting = !view.collecting; paint();
      if (view.collecting && view.files === null) findFiles();
    }, !records.length));
    context.append(contextHead);
    function observed(record, label) {
      const block = element('div','first-use-observed'); block.append(element('h3','',label));
      const percent = occupancy(record), percentageOnly = percentageReading(record);
      block.append(element('p','first-use-measurement',percentageOnly ? percent.toFixed(2) + '% context after response' : number(record.inputTokens) + ' input tokens' + (percent === null ? '' : ' · ' + percent.toFixed(1) + '% of reported capacity')));
      if (percent !== null) {
        const meter = element('div','first-use-meter'); meter.setAttribute('role','img'); meter.setAttribute('aria-label',percentageOnly ? percent.toFixed(2) + '% context after response' : number(record.inputTokens) + ' input tokens of ' + number(record.capacity) + ' reported capacity');
        const fill = element('span'); fill.style.width = Math.min(percent,100) + '%'; meter.append(fill); block.append(meter);
      } else block.append(element('p','first-use-meta','Context capacity was not reported. We can compare input tokens, but cannot calculate a percentage of the window.'));
      block.append(element('p','first-use-muted',percentageOnly ? 'Harness-reported percentage after the response. Startup tokens and category costs are unavailable.' : 'First request · includes your prompt'),element('p','first-use-meta',(record.model || 'Model not reported') + ' · ' + stamp(record.measuredAt)));
      block.append(element('p','first-use-path','Launch folder: ' + (record.launchDirectory || 'Not reported')));
      return block;
    }
    if (records.length) context.append(element('p','first-use-meta','Latest saved reading is shown above under What was actually measured.'));
    else context.append(element('p','first-use-empty',supported ? 'Read one session to see its first-request input total. You choose the file, preview the result, then save it.' : 'Local session measurements currently support Claude Code and Codex. You can still explore this agent’s setup.'));
    context.append(details('What can we measure?','Local session logs can report input tokens for the first request, including your prompt. They do not provide a reliable split into system instructions, tools, MCPs and skills, or prove individual file loading. Capacity is shown only when reported. Reading a log makes no request to an AI provider.'));
    async function findFiles() {
      await run('Finding local sessions',async () => {
        const result = await view.props.api('/api/session-files',{agent:props.agent,repo:props.repo || ''});
        if (current()) { view.files = list(result.files); view.coverage = result.coverage; }
      });
    }
    if (view.collecting) {
      const collect = element('div','first-use-collection'); collect.append(element('h3','','Choose a session to read'),element('p','first-use-muted','These are file names and modification dates only. The project and launch folder are validated when you preview a session.'));
      collect.append(element('p','first-use-muted','For a before-and-after check, start a fresh ' + agentName + ' session in this project and use the same short prompt each time. Keep the model and launch settings the same.'));
      if (view.files?.length) {
        const choices = element('fieldset','first-use-session-list'); choices.append(element('legend','sr-only','Local session files'));
        for (const file of view.files) {
          const label = element('label','first-use-session-choice'); const input = element('input'); input.type='radio'; input.name='first-use-session'; input.value=file.path;
          input.checked=view.path===file.path; input.disabled=!!view.busy || file.importable !== true;
          input.addEventListener('change',() => { if (!current() || view.busy) return; view.path=file.path; view.preview=null; view.error=''; paint(); });
          const text = element('span'); text.append(element('strong','',file.label || pathName(file.path)),element('span','first-use-meta','Modified ' + stamp(file.modifiedAt) + (file.importable === true ? '' : ' · Cannot import this file')));
          label.append(input,text); choices.append(label);
        }
        collect.append(choices);
      } else if (view.files) collect.append(element('p','','No session files found. Start a session in the selected project, then find sessions again.'));
      if (view.coverage?.partial) collect.append(element('p','first-use-muted','Discovery was partial. Some local sessions may not appear.'));
      const actions=element('div','first-use-actions');
      actions.append(button('Find sessions again',findFiles));
      const previewButton=button('Preview selected session',() => run('Reading session locally',async () => {
        const result=await view.props.api('/api/context-evidence',{action:'preview',agent:props.agent,repo:props.repo || '',path:view.path});
        if (current()) view.preview=result;
      })); previewButton.disabled=!view.path || !!view.busy; actions.append(previewButton); collect.append(actions);
      if (view.preview) {
        const result=view.preview;
        const matchesLaunch=result.measurement && measurements([result.measurement],props.agent,props.repo,props.loading?.launchDirectory).length === 1;
        if (result.measurement && validTokens(result.measurement.inputTokens)) collect.append(observed(result.measurement,'Preview · not saved'));
        for (const issue of list(result.issues)) collect.append(element('p','first-use-warning',typeof issue === 'string' ? issue : issue.message || 'This reading has incomplete evidence.'));
        if (result.applicable && result.measurement && !matchesLaunch) collect.append(element('p','first-use-warning','This session started in a different folder. Select that launch folder in Files or choose a session from the current folder.'));
        if (result.applicable && matchesLaunch) collect.append(button('Save this reading',() => run('Saving reading',async () => {
          const saved=await view.props.api('/api/context-evidence',{action:'capture',agent:props.agent,repo:props.repo || '',path:view.path,sourceDigest:view.preview.sourceDigest});
          if (!current()) return;
          const record=saved.measurement || saved.record || saved;
          if (record?.id) view.captured.push(record);
          view.preview=null;view.collecting=false;view.notice='Reading saved. After a change, read a new session to compare.';
          await view.props.onRefresh?.();
        }),true));
        else collect.append(element('p','first-use-warning','This session cannot be saved for the selected scope. Choose another session.'));
      }
      context.append(collect);
    }
    manual.append(context);if(supported)page.append(manual);
    const improve=element('section','first-use-section'); improve.append(element('h2','','Choose one thing to improve'));
    const insightFiles=[...list(props.loading?.groups).flatMap(group=>list(group.files)),...list(props.loading?.configuration?.files),...list(props.loading?.components?.items)];
    const ranked=prioritizeInsights(props.insights,insightFiles,props.repo), insights=ranked.slice(0,3);
    if(ranked.length<list(props.insights).length)improve.append(element('p','first-use-meta','Cache copies and duplicates outside this setup stay in Files for inspection. Matching copies alone do not establish an improvement.'));
    if (!insights.length) {
      improve.append(element('p','first-use-muted','No current suggestions for this setup. Explore your sources or ask your chosen agent what could be clearer or lighter.'),button('Ask about this setup',invoke(() => props.onAsk?.(null))));
    } else {
      const rows=element('ol','first-use-insights');
      for (const record of insights) {
        const row=element('li'); const body=element('div'); body.append(element('h3','',record.title || 'Review this instruction'));
        if(record.evidence) body.append(element('p','first-use-muted',record.evidence.length > 190 ? record.evidence.slice(0,187)+'…' : record.evidence));
        if(record.action || record.evidence?.length > 190) body.append(details('Why this matters', [record.evidence,record.action].filter(Boolean).join(' ')));
        const actions=element('div','first-use-actions'); actions.append(button('Work on this',invoke(() => props.onAsk?.(record))));
        if(record.itemId) actions.append(button('Open source',invoke(() => props.onEdit?.(record.itemId))));
        body.append(actions);row.append(body);rows.append(row);
      }
      improve.append(rows);
    }
    page.append(improve);
    const verify=element('section','first-use-section'); verify.append(element('h2','','See what changed'),element('p','first-use-muted','Compare first requests made with the same prompt and conditions. Then check that the setup still handles the task correctly.'));
    if(props.agent==='kiro') verify.append(element('p','first-use-muted','Kiro reports context after the response. Model identity, capacity and first-request tokens are unavailable, so we cannot verify a startup saving. Repeat the response check to test behavior.'));
    else if(records.length < 2) verify.append(element('p','first-use-empty',records.length ? 'Your baseline is saved. Make one reviewed change, start a fresh session with the same prompt, then read its result here.' : 'Save a baseline reading before changing your setup. A second reading will make the comparison available.'));
    else {
      const fields=element('div','first-use-comparison-fields');
      for(const [field,labelText] of [['before','Before'],['after','After']]) {
        const label=element('label','',labelText),select=element('select'); select.name='comparison-'+field;select.id='first-use-'+field;select.setAttribute('aria-label',labelText+' reading');
        const empty=element('option','','Choose a reading');empty.value='';select.append(empty);
        for(const record of records) {const option=element('option','',stamp(record.measuredAt)+' · '+number(record.inputTokens)+' tokens · '+(record.model || 'Model unknown')+(!props.repo?' · '+(record.launchDirectory || 'Folder unknown'):''));option.value=record.id;select.append(option);}
        select.value=records.some(record=>record.id===view[field])?view[field]:'';
        select.addEventListener('change',()=> {if(!current() || view.busy)return;view[field]=select.value;view.comparison=null;paint();}); label.append(select);fields.append(label);
      }
      const compare=button('Compare readings',()=>run('Comparing readings',async()=> {
        const result=await view.props.api('/api/context-evidence',{action:'compare',beforeId:view.before,afterId:view.after});
        if(current())view.comparison=result;
      }));compare.disabled=!view.before || !view.after || view.before===view.after || !!view.busy; fields.append(compare);verify.append(fields);
      if(view.comparison) {
        const comparison=view.comparison;
        if(comparison.comparable) {
          const before=records.find(record=>record.id===view.before),after=records.find(record=>record.id===view.after);
          const pair=element('div','first-use-pair');pair.append(observed(before,'Before'),observed(after,'After'));verify.append(pair);
          const saved=comparison.savedTokens ?? comparison.reductionTokens;
          verify.append(element('p','first-use-result',saved>0?number(saved)+' fewer input tokens observed':saved<0?number(-saved)+' more input tokens observed':'No change in reported input tokens'));
          const points=comparison.percentPoints ?? comparison.reductionPercentagePoints;
          if(Number.isFinite(points))verify.append(element('p','first-use-meta',Math.abs(points).toFixed(2)+' percentage points '+(points>=0?'lower':'higher')+' against the same reported capacity'));
          verify.append(element('p','first-use-muted','This compares input totals. It does not attribute the difference to individual files or establish that behavior improved.'));
        } else verify.append(element('p','first-use-warning','These readings are not directly comparable.'));
        for(const reason of list(comparison.reasons || comparison.issues))verify.append(element('p','first-use-muted',reason));
      }
    }
    verify.append(button('Plan a representative check',invoke(() => props.onImprove?.(null))),element('p','first-use-meta','Prepare a more detailed task and quality checks to run in your agent.'));
    page.append(verify);
    const statusParent=/verification/i.test(view.lastAction || '')?automatic:page;
    const status=element('p','first-use-status',view.busy ? view.busy+'…' : view.notice);status.setAttribute('role','status');status.setAttribute('aria-live','polite');statusParent.append(status);
    if(view.error) {const error=element('p','first-use-error',view.error);error.setAttribute('role','alert');statusParent.append(error);}
    if(view.busy)for(const control of page.querySelectorAll('button,select,input,textarea'))control.disabled=true;
    let focusIndex = 0;
    for (const control of page.querySelectorAll('button,select,input,textarea,summary')) if(!control.dataset.firstUseFocus)control.dataset.firstUseFocus = String(focusIndex++);
    root.replaceChildren(page);
    if (focused != null) {
      const control=root.querySelector('[data-first-use-focus="'+focused+'"]');control?.focus({preventScroll:true});
      if(Number.isInteger(selection?.start))control?.setSelectionRange?.(selection.start,selection.end);
    }
  }
  window.HarnessFirstUse={render,sources,measurements,occupancy,prioritizeInsights};
})();
