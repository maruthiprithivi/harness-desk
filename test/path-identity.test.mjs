import test from 'node:test';
import assert from 'node:assert/strict';
import {sameLocalPath} from '../lib/path-identity.mjs';

test('local path comparisons respect native separators and case without merging different folders',()=>{
  assert.equal(sameLocalPath('C:/Fixture/Project','c:\\Fixture\\Project','win32'),true);
  assert.equal(sameLocalPath('C:/Fixture/Project','C:/fixture/project','win32'),false);
  assert.equal(sameLocalPath('C:/Fixture/Project','D:/Fixture/Project','win32'),false);
  assert.equal(sameLocalPath('C:/Fixture/Project','C:/Fixture/Project-two','win32'),false);
  assert.equal(sameLocalPath('\\\\host\\Share\\Project','//host/Share/Project','win32'),true);
  assert.equal(sameLocalPath('/fixture/project','/fixture//project','linux'),true);
  assert.equal(sameLocalPath('/fixture/Project','/fixture/project','linux'),false);
  assert.equal(sameLocalPath(null,'/fixture/project'),false);
});
