/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deleteApp } from 'firebase-admin/app';
import { localAdmin } from './localAdmin.js';
import { provisionPresident, validateProvisionInput, parseProvisionArgs } from './provisionPresident.js';
import { initialRoomDocuments } from './roomDefaults.js';
import { provisionLocalRoom } from './provisionLocal.js';

async function inspect(action) {
  const { app, auth, db } = localAdmin();
  try { return await action(auth, db); }
  finally { await db.terminate(); await deleteApp(app); }
}
const input = name => ({ roomId: 'test-' + name, email: name + '@patterns.test' });
test('strict explicit inputs and Admin environment fail before connecting', async () => {
  for (const value of [{}, {roomId:'../A',email:'a@b.test'}, {roomId:'A',email:' a@b.test'}, {roomId:'A',email:'a..b@c.test'}, {roomId:'A',email:'a@b.test',role:'judge'}]) assert.throws(() => validateProvisionInput(value));
  assert.throws(() => parseProvisionArgs([]));
  const previous=process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT='production';
  try { await assert.rejects(provisionPresident(input('unsafe')), /Only demo-patterns-gups/); }
  finally { process.env.GCLOUD_PROJECT=previous; }
});
test('new provisioning creates only President and three Room documents', async () => {
  const result=await provisionPresident(input('new'));
  assert.equal(result.created,true);
  await inspect(async (auth,db) => {
    const user=await auth.getUser(result.uid);
    assert.deepEqual(user.customClaims,{roomId:'test-new',role:'president'});
    assert.equal(user.passwordHash,undefined);
    const docs=await db.getAll(...['control','meta','publicState'].map(n=>db.doc('rooms/test-new/'+n+'/current')));
    assert.deepEqual(docs.map(d=>d.data()),initialRoomDocuments());
  });
});
test('reexecution reuses UID and is idempotent', async () => {
  const first=await provisionPresident(input('repeat'));
  const second=await provisionPresident(input('repeat'));
  assert.equal(first.uid,second.uid);
  assert.equal(second.created,false);
});
test('existing evaluation remains unchanged', async () => {
  await provisionPresident(input('evaluation'));
  await inspect(async (_auth,db)=> { await db.doc('rooms/test-evaluation/control/current').update({evaluationId:9,status:'running'}); });
  assert.equal((await provisionPresident(input('evaluation'))).created,false);
  await inspect(async (_auth,db)=> { assert.equal((await db.doc('rooms/test-evaluation/control/current').get()).data().evaluationId,9); });
});
test('Room conflict does not reassign claims or create target Room', async () => {
  const first=await provisionPresident(input('conflict'));
  await assert.rejects(provisionPresident({...input('conflict'),roomId:'other'}),/PRESIDENT_ASSIGNMENT_CONFLICT/);
  await inspect(async (auth,db)=> {
    assert.deepEqual((await auth.getUser(first.uid)).customClaims,first.claims);
    assert.equal((await db.doc('rooms/other/control/current').get()).exists,false);
  });
});
test('role conflict preserves existing identity and leaves Room untouched', async () => {
  await inspect(async (auth)=> { const user=await auth.createUser({email:'role@patterns.test'}); await auth.setCustomUserClaims(user.uid,{roomId:'test-role',role:'judge',judgeId:1}); });
  await assert.rejects(provisionPresident(input('role')),/PRESIDENT_ASSIGNMENT_CONFLICT/);
  await inspect(async (auth,db)=> {
    assert.equal((await auth.getUserByEmail('role@patterns.test')).customClaims.role,'judge');
    assert.equal((await db.doc('rooms/test-role/control/current').get()).exists,false);
  });
});
test('safe retry recovers journaled partial state, refuses unknown or advanced partials', async () => {
  await inspect(async (auth,db)=> {
    const user=await auth.createUser({email:'partial@patterns.test'});
    const batch=db.batch();
    batch.create(db.doc('_localPresidentAssignments/'+createHash('sha256').update(user.uid).digest('hex')),{roomId:'test-partial',role:'president'});
    batch.create(db.doc('_localRoomProvisioning/test-partial'),{uid:user.uid,version:1,status:'pending'});
    batch.create(db.doc('rooms/test-partial/control/current'),initialRoomDocuments()[0]);
    await batch.commit();
    await db.doc('rooms/test-unknown/control/current').set(initialRoomDocuments()[0]);
  });
  await provisionPresident(input('partial'));
  assert.equal((await provisionPresident(input('partial'))).created,false);
  await assert.rejects(provisionPresident(input('unknown')),/UNSAFE_PARTIAL_ROOM/);
  await inspect(async (_auth,db)=> {
    await db.doc('rooms/test-partial/meta/current').delete();
    await db.doc('rooms/test-partial/control/current').update({evaluationId:2});
  });
  await assert.rejects(provisionPresident(input('partial')),/UNSAFE_PARTIAL_ROOM/);
});
test('Auth assignment interruption is recovered without resetting Room; Room reservation blocks another UID', async () => {
  const first=await provisionPresident(input('retry'));
  await inspect(async (auth)=> { await auth.setCustomUserClaims(first.uid,{}); });
  const retry=await provisionPresident(input('retry'));
  assert.equal(retry.created,false);
  assert.deepEqual(retry.claims,first.claims);
  await assert.rejects(provisionPresident({roomId:'test-retry',email:'another@patterns.test'}),/ROOM_PRESIDENT_CONFLICT/);
});
test('legacy Room A provisioning preserves DEV compatibility', async () => {
  const first=await provisionLocalRoom(),second=await provisionLocalRoom();
  assert.equal(second.created,false);
  assert.equal(first.uid,'dev-president-room-A');
  await inspect(async auth=> { assert.deepEqual((await auth.getUser(first.uid)).customClaims,{roomId:'A',role:'president'}); });
});
