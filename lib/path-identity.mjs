import path from 'node:path';

export function sameLocalPath(left,right,platform=process.platform) {
  if(typeof left!=='string'||typeof right!=='string')return false;
  const implementation=platform==='win32'?path.win32:path.posix;
  const normalize=value=>{
    const result=implementation.normalize(value);
    return platform==='win32'?result.replace(/^[a-z]:/i,drive=>drive.toLowerCase()):result;
  };
  return normalize(left)===normalize(right);
}
