import test from 'node:test';
import assert from 'node:assert/strict';
import { devFirestoreTransportHost } from './devFirestoreTransport.js';

test('each DEV role uses a distinct loopback host across login and operational reload', () => {
  const hosts = new Set();
  for (const key of ['president', 'public', 'judge/1', 'judge/2', 'judge/3']) {
    const loginHost = devFirestoreTransportHost('127.0.0.1', '/__dev/' + key);
    assert.equal(loginHost, devFirestoreTransportHost('localhost', '/rooms/A/' + key));
    assert.equal(loginHost, 'patterns-' + key.replace('/', '-') + '.localhost');
    hosts.add(loginHost);
  }
  assert.equal(hosts.size, 5);
});

test('LAN settings and unrecognized routes are preserved', () => {
  assert.equal(devFirestoreTransportHost('192.168.0.146', '/rooms/A/president'), '192.168.0.146');
  for (const path of ['/rooms/A', '/', '/rooms/A/judge/4', '/rooms/A/judge/12', '/__dev/arbitrary']) {
    assert.equal(devFirestoreTransportHost('127.0.0.1', path), '127.0.0.1');
  }
});

test('clean role routes preserve separate loopback pools for President, Public and five Judges', () => {
  const roomId = 'demo-patterns-' + 'a'.repeat(24);
  const paths = ['/president/' + roomId, '/public/' + roomId, ...Array.from({ length: 5 }, (_, i) => '/judge/' + roomId + '/' + (i + 1))];
  const hosts = paths.map(path => devFirestoreTransportHost('127.0.0.1', path));
  assert.equal(new Set(hosts).size, 7);
  assert.deepEqual(hosts, ['patterns-president.localhost', 'patterns-public.localhost', ...Array.from({ length: 5 }, (_, i) => 'patterns-judge-' + (i + 1) + '.localhost')]);
  assert.equal(devFirestoreTransportHost('192.168.0.146', paths[0]), '192.168.0.146');
  for (const path of ['/president/' + roomId + '/extra', '/judge/' + roomId + '/6']) assert.equal(devFirestoreTransportHost('127.0.0.1', path), '127.0.0.1');
});
