import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const dependencies = {
  'codemirror':'6.0.2',
  '@codemirror/state':'6.7.6',
  '@codemirror/view':'6.43.14',
  '@codemirror/language':'6.13.1',
  '@codemirror/lang-markdown':'6.5.2',
  '@codemirror/lang-json':'6.0.2',
  '@codemirror/lang-javascript':'6.2.5',
  '@codemirror/lang-python':'6.2.1',
  '@codemirror/lang-css':'6.3.1',
  '@codemirror/legacy-modes':'6.5.5',
  'esbuild':'0.28.2'
};

export const editorSource = String.raw`
import {basicSetup} from 'codemirror';
import {Compartment, EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {StreamLanguage} from '@codemirror/language';
import {markdown} from '@codemirror/lang-markdown';
import {json} from '@codemirror/lang-json';
import {javascript} from '@codemirror/lang-javascript';
import {python} from '@codemirror/lang-python';
import {css} from '@codemirror/lang-css';
import {shell} from '@codemirror/legacy-modes/mode/shell';
import {yaml} from '@codemirror/legacy-modes/mode/yaml';
import {toml} from '@codemirror/legacy-modes/mode/toml';

function syntax(language) {
  switch (String(language || '').toLowerCase().replace(/^\./, '')) {
    case 'md': case 'markdown': return markdown();
    case 'json': return json();
    case 'js': case 'javascript': return javascript();
    case 'jsx': return javascript({jsx:true});
    case 'ts': case 'typescript': return javascript({typescript:true});
    case 'tsx': return javascript({typescript:true,jsx:true});
    case 'py': case 'python': return python();
    case 'css': return css();
    case 'sh': case 'bash': case 'zsh': case 'shell': return StreamLanguage.define(shell);
    case 'yaml': case 'yml': return StreamLanguage.define(yaml);
    case 'toml': return StreamLanguage.define(toml);
    default: return [];
  }
}

export function createEditor({parent,value='',language='',readOnly=false,onChange,nonce=''}={}) {
  if (!parent || typeof parent.appendChild !== 'function') throw new Error('An editor parent is required');
  if (typeof value !== 'string') throw new Error('Editor value must be text');
  const access = new Compartment();
  let locked = Boolean(readOnly), replacing = false, destroyed = false;
  const editable = () => [EditorState.readOnly.of(locked),EditorView.editable.of(!locked)];
  const extensions = [
    basicSetup, syntax(language), EditorView.lineWrapping,
    EditorView.cspNonce.of(String(nonce)), access.of(editable()),
    EditorView.contentAttributes.of({tabindex:'0','aria-label':'File contents'}),
    EditorView.updateListener.of(update => {
      if (update.docChanged && !replacing && typeof onChange === 'function') onChange(update.state.sliceDoc());
    })
  ];
  function state(doc) {
    const lineSeparator = doc.includes('\r\n') && !/(^|[^\r])\n/.test(doc) ? '\r\n' : '\n';
    return EditorState.create({doc,extensions:[extensions,EditorState.lineSeparator.of(lineSeparator)]});
  }
  const view = new EditorView({parent,state:state(value)});
  return {
    getValue:() => view.state.sliceDoc(),
    setValue(next) {
      if (typeof next !== 'string') throw new Error('Editor value must be text');
      replacing = true;
      try { view.setState(state(next)); } finally { replacing = false; }
    },
    setReadOnly(next) {
      locked = Boolean(next);
      view.dispatch({effects:access.reconfigure(editable())});
    },
    focus:() => view.focus(),
    destroy() { if (!destroyed) { destroyed = true; view.destroy(); } }
  };
}
`;

function command(name,args,cwd) {
  const result=spawnSync(name,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(result.status!==0)throw new Error(name+' failed: '+(result.stderr||result.error?.message||result.stdout));
  return result.stdout.trim();
}

async function build(args) {
  await fs.access('/.dockerenv').catch(()=>{throw new Error('Run this build inside a Linux Docker container');});
  const option=name=>{const index=args.indexOf(name);return index<0?'':args[index+1]||'';};
  const workDir=option('--work-dir'),outputDir=option('--output-dir'),provenance=option('--provenance');
  if(!workDir||!outputDir)throw new Error('Use --work-dir and --output-dir with isolated build directories');
  await fs.mkdir(workDir,{recursive:true});await fs.mkdir(outputDir,{recursive:true});
  const manifest={name:'harness-editor-vendor',version:'1.0.0',private:true,type:'module',dependencies};
  await fs.writeFile(path.join(workDir,'package.json'),JSON.stringify(manifest,null,2)+'\n');
  if(provenance) {
    const source=await fs.readFile(provenance,'utf8');
    const match=source.match(/<!-- npm-lock:start -->\n```json\n([\s\S]*?)\n```\n<!-- npm-lock:end -->/);
    if(!match)throw new Error('Provenance must include the pinned npm lock');
    const lock=JSON.parse(match[1]);
    const pinned=lock.packages?.['']?.dependencies;
    if(!pinned||Object.keys(pinned).length!==Object.keys(dependencies).length||Object.entries(dependencies).some(([name,version])=>pinned[name]!==version))throw new Error('Lock dependencies differ from the reviewed pins');
    await fs.writeFile(path.join(workDir,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
  } else {
    if(!args.includes('--resolve'))throw new Error('Use --provenance to reproduce, or --resolve to record a new dependency lock');
    command('npm',['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],workDir);
  }
  command('npm',['ci','--ignore-scripts','--no-audit','--no-fund',...(args.includes('--offline')?['--offline']:[])],workDir);
  await fs.writeFile(path.join(workDir,'editor-entry.mjs'),editorSource);
  const {build:bundle}=await import(path.join(workDir,'node_modules/esbuild/lib/main.js'));
  const output=path.join(outputDir,'editor.js');
  await bundle({entryPoints:[path.join(workDir,'editor-entry.mjs')],outfile:output,bundle:true,minify:true,format:'iife',globalName:'HarnessEditor',target:['es2022'],legalComments:'inline',charset:'utf8',banner:{js:'/*! HarnessEditor: CodeMirror 6. Public third-party licenses and pinned npm integrity values: license/provenance.md. */'}});
  const bytes=await fs.readFile(output);
  if(bytes.length>=1024*1024)throw new Error('Editor bundle exceeds the 1 MiB public artifact limit');
  const lock=JSON.parse(await fs.readFile(path.join(workDir,'package-lock.json'),'utf8'));
  const licenses=[];
  for(const location of Object.keys(lock.packages).filter(Boolean).sort()) {
    const directory=path.join(workDir,location);
    const names=await fs.readdir(directory).catch(()=>[]);
    for(const name of names.filter(name=>/^(?:license|copying)(?:\.|$)/i.test(name)).sort()) {
      if(!(await fs.stat(path.join(directory,name))).isFile())continue;
      licenses.push('## '+location+' / '+name+'\n\n~~~text\n'+(await fs.readFile(path.join(directory,name),'utf8')).trim()+'\n~~~');
    }
  }
  const hash=createHash('sha256').update(bytes).digest('hex');
  const instructions=[
    '# Vendored editor provenance and licenses','',
    'CodeMirror 6 browser adapter, built from scripts/vendor-editor.mjs. The browser uses this local bundle; it makes no CDN or package-registry request.',
    '', 'Bundle: editor.js; '+bytes.length+' bytes; SHA-256: `'+hash+'`.',
    'Build runtime: Node '+process.version+'; npm '+command('npm',['--version'],workDir)+'; esbuild '+dependencies.esbuild+'.',
    '', '## Reproduce', '',
    'Copy scripts/vendor-editor.mjs and this provenance file into an isolated temporary directory. Mount only that directory into a Node 22 Linux Docker container, then run:',
    '', '~~~sh', 'node /work/vendor-editor.mjs --work-dir /work/build --output-dir /work/output --provenance /work/provenance.md', '~~~',
    '', 'Use --offline with an existing npm cache to avoid network access. npm ci verifies every package against the lock integrity below and runs no lifecycle scripts. --resolve deliberately creates a new lock from the exact direct pins; review the new lock, licenses and bundle before adopting it.',
    '', '## Pinned package lock and integrity', '', '<!-- npm-lock:start -->', '```json', JSON.stringify(lock,null,2), '```', '<!-- npm-lock:end -->', '',
    '## Licenses', '', 'The following are public third-party notices retained from installed npm packages. Copyright-holder contact details are upstream attribution.', '', licenses.join('\n\n')
  ];
  await fs.mkdir(path.join(outputDir,'license'),{recursive:true});
  await fs.writeFile(path.join(outputDir,'license/provenance.md'),instructions.join('\n')+'\n');
  console.log(JSON.stringify({bytes:bytes.length,sha256:hash,dependencies},null,2));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build(process.argv.slice(2));
