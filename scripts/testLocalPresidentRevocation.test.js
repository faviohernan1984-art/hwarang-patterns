import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPresidentRevocation, parseRevocationArgs } from './testLocalPresidentRevocation.js';

const roomId = 'demo-patterns-' + 'a'.repeat(24);
const env = { PATTERNS_DEV_PRESIDENT: 'true', GCLOUD_PROJECT: 'demo-patterns-gups', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
function fixture() {
  const keys = ['president', 'public', 'judge/1', 'judge/2', 'judge/3'];
  let revoked = false;
  let revocations = 0;
  const state = {
    authorization: { version: 1, roomAccessVersion: 3, roles: Object.fromEntries(keys.map(key => [key, { active: true, accessVersion: 4, hash: 'b'.repeat(64) }])) },
    documents: {
      ['rooms/' + roomId + '/control/current']: { config: { patternJudges: 3 }, pausedRemaining: 10 },
      ['rooms/' + roomId + '/meta/current']: { demoSessionId: 'session-1' },
      ['rooms/' + roomId + '/demoSessions/session-1']: { consumedEvaluationIds: [1], confirmedCount: 1 },
      ['rooms/' + roomId + '/submissions/1']: { vote: 'hong' },
    }, journal: { status: 'complete' }, users: { president: { customClaims: { role: 'president' } } },
  };
  const permissionDenied = () => { throw Object.assign(new Error('secret details'), { code: 'permission-denied' }); };
  const adapter = {
    snapshot: async () => structuredClone(state),
    login: async key => ({ roomId, role: key.startsWith('judge/') ? 'judge' : key,
      ...(key.startsWith('judge/') ? { judgeId: Number(key.slice(6)) } : {}), roomAccessVersion: 3, accessVersion: 4 }),
    read: async (key, path) => { if ((revoked && key === 'president') || (key === 'public' && path === 'meta/current')) permissionDenied(); },
    writeControl: async () => permissionDenied(),
    checkStalePresident: async () => {},
    async revoke(before) {
      assert.deepEqual(before, state);
      revocations++; revoked = true;
      state.authorization.roles.president.active = false;
      state.authorization.roles.president.accessVersion++;
    },
    presidentStillAuthenticated: async () => true,
    checkPresidentTokenDenied: async () => {},
  };
  return { state, adapter, get revocations() { return revocations; }, run: execute => checkPresidentRevocation({ roomId, env, execute, adapter }) };
}

test('explicit room and execute switch are strict; default never revokes', async () => {
  assert.deepEqual(parseRevocationArgs(['--room', roomId]), { roomId, execute: false });
  assert.deepEqual(parseRevocationArgs(['--room', roomId, '--execute']), { roomId, execute: true });
  for (const args of [[], ['--room', 'A'], ['--room', roomId, '--force'], ['--room', roomId, '--execute', 'extra']]) assert.throws(() => parseRevocationArgs(args), /REVOCATION_CHECK_FAILED/);
  const f = fixture();
  assert.deepEqual(await f.run(false), { status: 'PREFLIGHT_OK_NO_REVOCATION' });
  assert.equal(f.revocations, 0);
});

test('simulated execution revokes only President and verifies preservation', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(true), { status: 'PRESIDENT_ONLY_REVOCATION_VERIFIED' });
  assert.equal(f.revocations, 1);
  assert.equal(f.state.authorization.roles.public.active, true);
  assert.equal(f.state.authorization.roomAccessVersion, 3);
});

test('unsafe environment, invalid room, versions, grants and claims abort before revocation', async () => {
  for (const mutate of [
    f => { f.state.authorization.roles.president.active = false; },
    f => { f.state.authorization.roles.public.accessVersion = 0; },
    f => { f.state.authorization.roomAccessVersion = '3'; },
    f => { f.state.authorization.roles.president.accessVersion = Number.MAX_SAFE_INTEGER; },
    f => { delete f.state.authorization.roles['judge/1']; },
    f => { f.state.authorization.roles.public.hash = 'secret'; },
    f => { f.adapter.login = async () => ({ roomId: 'A' }); },
    f => { f.adapter.checkStalePresident = async () => { throw new Error('secret'); }; },
    f => { f.adapter.writeControl = async () => {}; },
    f => { f.adapter.read = async () => { throw Object.assign(new Error('secret'), { code: 'unavailable' }); }; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.run(true)); assert.equal(f.revocations, 0);
  }
  for (const options of [{ roomId: 'A' }, { env: { ...env, GCLOUD_PROJECT: 'production' } }, { env: { ...env, FIRESTORE_EMULATOR_HOST: 'remote:8080' } }]) {
    const f = fixture();
    await assert.rejects(checkPresidentRevocation({ roomId, env, execute: true, adapter: f.adapter, ...options }));
    assert.equal(f.revocations, 0);
  }
});

test('concurrent changes abort preflight; unexpected post-revocation access or data changes fail', async () => {
  const concurrent = fixture(); let snapshots = 0;
  const snapshot = concurrent.adapter.snapshot;
  concurrent.adapter.snapshot = async () => { const value = await snapshot(); if (++snapshots > 1) value.journal.status = 'changed'; return value; };
  await assert.rejects(concurrent.run(true)); assert.equal(concurrent.revocations, 0);
  for (const mutate of [
    f => { f.adapter.presidentStillAuthenticated = async () => false; },
    f => { f.adapter.checkPresidentTokenDenied = async () => { throw new Error('secret'); }; },
    f => { const revoke = f.adapter.revoke; f.adapter.revoke = async before => { await revoke(before); f.state.documents['rooms/' + roomId + '/demoSessions/session-1'].confirmedCount++; }; },
    f => { const revoke = f.adapter.revoke; f.adapter.revoke = async before => { await revoke(before); f.state.authorization.roles.public.active = false; }; },
    f => { const read = f.adapter.read; f.adapter.read = async (key, path) => f.revocations && key === 'president' ? undefined : read(key, path); },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.run(true)); assert.equal(f.revocations, 1);
  }
});
