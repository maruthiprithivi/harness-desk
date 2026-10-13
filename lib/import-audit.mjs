import path from 'node:path';
import {safeText,redactDeep} from './analysis.mjs';
export function parseCsv(text) {
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(char==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(char===','&&!quoted){row.push(value);value='';}
    else if(char==='\n'&&!quoted){row.push(value.replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];value='';}
    else value+=char;
  }
  if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row);}
  if(quoted)throw new Error('Unclosed CSV field');
  const headers=rows.shift()||[];return rows.map(row=>Object.fromEntries(headers.map((key,i)=>[key,row[i]||''])));
}
export async function importAudit(directory) {
  const result={source:path.resolve(directory),importedAt:new Date().toISOString(),tables:{},warnings:[]};
  for(const name of ['inventory','sessions','repeated-tasks','mistakes','journal-lessons']) {
    try{result.tables[name]=redactDeep(parseCsv(await safeText(path.join(directory,name+'.csv'),['.csv'],8*1024*1024,true))).slice(0,10000);}
    catch(error){result.warnings.push(name+': '+error.message);}
  }
  if(!Object.keys(result.tables).length)throw new Error('No supported audit CSV reports found');
  return result;
}
