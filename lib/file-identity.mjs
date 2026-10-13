const validPart=value=>typeof value==='number'?Number.isSafeInteger(value)&&value>=0:typeof value==='string'&&/^(?:0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=0xffffffffffffffffn;

export function validFileIdentity(value) {
  return !!value&&validPart(value.dev)&&validPart(value.ino);
}

export function identityFromStat(stat) {
  const encode=value=>{
    if(typeof value==='bigint'&&value>=0n&&value<=0xffffffffffffffffn)return String(value);
    if(validPart(value))return String(value);
    throw new Error('File identity cannot be represented exactly.');
  };
  return {dev:encode(stat.dev),ino:encode(stat.ino)};
}

export function sameFileIdentity(stat,expected) {
  if(!validFileIdentity(expected))return false;
  const actual=identityFromStat(stat);
  return actual.dev===String(expected.dev)&&actual.ino===String(expected.ino);
}
