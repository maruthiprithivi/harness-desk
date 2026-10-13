import test from 'node:test';
import assert from 'node:assert/strict';
import {identityFromStat,sameFileIdentity,validFileIdentity} from '../lib/file-identity.mjs';

test('file identities preserve large adjacent IDs and accept safe legacy records',()=>{
  const stat={dev:23n,ino:9007199254740993n},identity=identityFromStat(stat);
  assert.deepEqual(JSON.parse(JSON.stringify(identity)),{dev:'23',ino:'9007199254740993'});
  assert.equal(sameFileIdentity(stat,identity),true);
  assert.equal(sameFileIdentity({dev:23n,ino:9007199254740992n},identity),false);
  assert.equal(sameFileIdentity({dev:24n,ino:stat.ino},identity),false);
  assert.equal(sameFileIdentity({dev:23n,ino:12n},{dev:23,ino:12}),true);
  for(const value of [null,{dev:23,ino:Number(stat.ino)},{dev:'23',ino:'01'},{dev:'23',ino:'-1'},{dev:'23',ino:'18446744073709551616'}])assert.equal(validFileIdentity(value),false);
  assert.throws(()=>identityFromStat({dev:23,ino:Number(stat.ino)}),/exactly/);
});
