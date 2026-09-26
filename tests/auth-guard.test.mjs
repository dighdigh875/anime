import test from 'node:test';
import assert from 'node:assert/strict';
import {isSessionExpired} from '../src/components/AuthGuard.tsx';
test('only a same-origin app API 401 redirects to login',()=>{
  const page='https://anime.example/korean/3440';
  assert.equal(isSessionExpired(401,'https://reanime.to/api/flix/207141/1',page),false);
  assert.equal(isSessionExpired(401,'/api/anissia/prepare',page),true);
  assert.equal(isSessionExpired(401,'/api/auth/login',page),false);
  assert.equal(isSessionExpired(502,'/api/anissia/reanime',page),false);
  assert.equal(isSessionExpired(401,'/api/anissia/prepare','https://anime.example/login'),false);
});
