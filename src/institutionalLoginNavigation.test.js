import test from 'node:test';
import assert from 'node:assert/strict';
import { institutionalLoginAction } from './institutionalLoginNavigation.js';
import { parseAppRoute, roomAccessLinks } from './roomRoutes.js';
import { authorizeRoomRoute, identityFromClaims } from './roomAccess.js';
import { productionRolePathFromClaims } from './productionRoleSession.js';

const identities = ['president', 'public', ...[1, 2, 3, 4, 5].map(judgeId => 'judge/' + judgeId)]
  .map(key => ({ roomId: 'A', role: key.split('/')[0], ...(key.startsWith('judge/') ? { judgeId: Number(key.slice(6)) } : {}) }));
const action = (route, overrides = {}) => institutionalLoginAction({ environment: 'production', route,
  identity: null, hasSession: false, loading: false, error: null, ...overrides });
const paths = ['/rooms/A', '/room/A', ...roomAccessLinks('A', 5).filter(access => access.role !== 'president')
  .flatMap(access => [access.path, '/rooms/A/' + access.key, '/room/A/' + access.key])];

test('institutional HOME and existing Public/Judge QR aliases send anonymous users to login', () => {
  for (const path of paths) {
    const route = parseAppRoute(path);
    assert.equal(action(route), 'redirect');
    assert.equal(authorizeRoomRoute(null, route).allowed, false);
  }
});

test('waits for Firebase session resolution and offers login on invalid sessions without granting access', () => {
  for (const path of paths) {
    const route = parseAppRoute(path);
    assert.equal(action(route, { loading: true }), null);
    assert.equal(action(route, { hasSession: true }), 'switch');
    assert.equal(action(route, { hasSession: true, error: 'AUTH_ERROR' }), 'switch');
    assert.equal(authorizeRoomRoute(null, route).allowed, false);
  }
});

test('matching roles keep their screens; wrong roles, judge numbers or rooms only get a switch-account offer', () => {
  for (const claims of identities) {
    const identity = identityFromClaims({ uid: 'synthetic-user' }, claims);
    for (const path of paths) {
      const route = parseAppRoute(path);
      const allowed = authorizeRoomRoute(identity, route).allowed;
      assert.equal(action(route, { identity, hasSession: true }), allowed ? null : 'switch');
      const foreign = { ...identity, roomId: 'B' };
      assert.equal(action(route, { identity: foreign, hasSession: true }), 'switch');
      assert.equal(authorizeRoomRoute(foreign, route).allowed, false);
    }
  }
});

test('post-login destination remains claims-derived regardless of the requested QR screen', () => {
  for (const claims of identities) {
    const destination = productionRolePathFromClaims(claims, 5);
    const identity = identityFromClaims({ uid: 'synthetic-user' }, claims);
    assert.equal(authorizeRoomRoute(identity, parseAppRoute(destination)).allowed, true);
    for (const path of paths) {
      action(parseAppRoute(path), { identity, hasSession: true });
      assert.equal(productionRolePathFromClaims(claims, 5), destination);
    }
  }
  for (const judgeId of [4, 5]) assert.throws(() => productionRolePathFromClaims({ roomId: 'A', role: 'judge', judgeId }, 3));
});

test('President access, other rooms, DEMO, development and invalid routes remain unchanged', () => {
  for (const path of ['/president/A', '/rooms/A/president', '/room/A/president', '/public/B', '/rooms/B',
    '/', '/login', '/logout', '/judge/A/6', '/judge/A/01', '/public/demo-patterns-' + 'a'.repeat(24)]) {
    assert.equal(action(parseAppRoute(path)), null);
  }
  for (const environment of ['development', undefined, 'unknown']) {
    for (const path of paths) assert.equal(action(parseAppRoute(path), { environment }), null);
  }
});
