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
