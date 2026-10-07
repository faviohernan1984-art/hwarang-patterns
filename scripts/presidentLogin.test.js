/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth, connectAuthEmulator, inMemoryPersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, terminate } from 'firebase/firestore';
import { localAdmin } from './localAdmin.js';
import { provisionPresident } from './provisionPresident.js';
import { initializePresidentPassword } from './initializePresidentPassword.js';
import { loginPresident, logoutPresident, presidentPathFromClaims } from '../src/presidentSession.js';
import { authorizeRoomRoute, identityFromClaims } from '../src/roomAccess.js';

async function admin(action) {
  const {app,auth,db}=localAdmin();
  try { return await action(auth,db); }
  finally { await db.terminate(); await deleteAdminApp(app); }
}
test('redirect accepts only President claims with strictly valid Room',()=>{
  assert.equal(presidentPathFromClaims({roomId:'B',role:'president'}),'/rooms/B/president');
  for(const claims of [{},{roomId:'B',role:'public'},{roomId:'B',role:'judge',judgeId:1},{roomId:'../A',role:'president'},{roomId:'B',role:'president',judgeId:1}]) assert.throws(()=>presidentPathFromClaims(claims));
});
test('login and logout refuse non-emulator Auth before any operation',async()=>{
  const app=initializeApp({projectId:'demo-patterns-gups',apiKey:'demo-key'},'no-emulator');
  try {
    await assert.rejects(loginPresident(getAuth(app),'a@b.test','unused'),/EMULATOR_REQUIRED/);
    await assert.rejects(logoutPresident(getAuth(app)),/EMULATOR_REQUIRED/);
  } finally { await deleteApp(app); }
});
test('standard President login, initialization, Rules isolation and logout in disposable emulators',async t=>{
  const password=randomBytes(24).toString('base64url');
  const result=await provisionPresident({roomId:'B',email:'president-b@patterns.test'});
  await provisionPresident({roomId:'A',email:'president-a@patterns.test'});
  await initializePresidentPassword('president-b@patterns.test',password);
  const app=initializeApp({projectId:'demo-patterns-gups',apiKey:'demo-patterns-gups-key'},'login-tests');
  const auth=getAuth(app);
  connectAuthEmulator(auth,'http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const db=getFirestore(app);
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db,host,Number(port));
  const ref=room=>doc(db,'rooms/'+room+'/control/current');
  try {
    await t.test('without authentication neither route nor Firestore can be accessed',async()=>{
      assert.equal(authorizeRoomRoute(null,{valid:true,roomId:'B',role:'president'}).reason,'AUTH_REQUIRED');
      await assert.rejects(getDoc(ref('B')),e=>e.code==='permission-denied');
    });
    await t.test('correct credentials return claims-derived B path and permit President operations',async()=>{
      assert.equal(await loginPresident(auth,'president-b@patterns.test',password,inMemoryPersistence),'/rooms/B/president');
      assert.equal(auth.currentUser.uid,result.uid);
      assert.equal((await getDoc(ref('B'))).exists(),true);
      await updateDoc(ref('B'),{status:'running',phaseStartedAt:Date.now()});
      assert.equal((await getDoc(ref('B'))).data().status,'running');
    });
    await t.test('President B cannot read or operate Room A',async()=>{
      const claims=(await auth.currentUser.getIdTokenResult()).claims;
      assert.equal(authorizeRoomRoute(identityFromClaims(auth.currentUser,claims),{valid:true,roomId:'A',role:'president'}).reason,'ROOM_FORBIDDEN');
      await assert.rejects(getDoc(ref('A')),e=>e.code==='permission-denied');
      await assert.rejects(updateDoc(ref('A'),{status:'running'}),e=>e.code==='permission-denied');
    });
    await t.test('logout removes session and Room access',async()=>{
      await logoutPresident(auth);
      assert.equal(auth.currentUser,null);
      await assert.rejects(getDoc(ref('B')),e=>e.code==='permission-denied');
    });
    await t.test('incorrect credentials leave no authenticated session',async()=>{
      await assert.rejects(loginPresident(auth,'president-b@patterns.test',password+'wrong',inMemoryPersistence));
      assert.equal(auth.currentUser,null);
    });
    await t.test('incompatible claims reject login and sign out',async()=>{
      await admin(async adminAuth=>{ await adminAuth.setCustomUserClaims(result.uid,{roomId:'B',role:'public'}); });
      await assert.rejects(loginPresident(auth,'president-b@patterns.test',password,inMemoryPersistence),/PRESIDENT_CLAIMS_REQUIRED/);
      assert.equal(auth.currentUser,null);
    });
    await t.test('initialization rejects incompatible claims and already initialized accounts',async()=>{
      await assert.rejects(initializePresidentPassword('president-b@patterns.test',password),/INVALID_PRESIDENT_ASSIGNMENT/);
      await admin(async adminAuth=>{ await adminAuth.setCustomUserClaims(result.uid,result.claims); });
      await assert.rejects(initializePresidentPassword('president-b@patterns.test',password),/CREDENTIAL_ALREADY_INITIALIZED/);
    });
  } finally { await terminate(db); await deleteApp(app); }
});
