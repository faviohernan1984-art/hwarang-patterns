import test from "node:test";
import assert from "node:assert/strict";
import { isCurrentSendOperation, sendStatusLabel } from "./sendRecovery.js";

test("a delayed send stays pending instead of becoming an error", () => {
  assert.equal(sendStatusLabel({ sent: false, sending: true, delayed: true, error: false }), "CONNECTION DELAYED");
});

test("an authoritative sent snapshot wins over delayed and error state", () => {
  assert.equal(sendStatusLabel({ sent: true, sending: true, delayed: true, error: true }), "SENT");
});

test("controlled retry is only exposed after a confirmed error", () => {
  assert.equal(sendStatusLabel({ sent: false, sending: false, delayed: false, error: true }), "SEND ERROR · RETRY");
  assert.equal(sendStatusLabel({ sent: false, sending: true, delayed: false, error: true }), "SENDING");
});

test("a response from an older operation token is ignored", () => {
  assert.equal(isCurrentSendOperation(4, 3), false);
  assert.equal(isCurrentSendOperation(4, 4), true);
});
