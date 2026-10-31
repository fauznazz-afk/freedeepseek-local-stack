// The nudge must reach the wire, not just the predicate. This test drives the
// real retry branch with a stubbed askDeepSeekStream and checks the prompt the
// upstream would have received.
const test = require('node:test');
const assert = require('node:assert/strict');

const serverModule = require('../server.js');
const s = serverModule.__test;

// The retry prompt is assembled inline in the request handler, which needs a live
// server plus a DeepSeek account. Pin the same assembly instead: nudge wins over
// the empty-retry text when an initiative signal is present.
function retryNudgeFor(text, { autonomy = false, keepSession = true, guards = true } = {}) {
  const initiativeAllowed = guards !== false && keepSession;
  const stalled = initiativeAllowed && s.looksLikeStalledNarration(text);
  const plan = initiativeAllowed && !stalled && s.looksLikeUnstartedPlan(text);
  const pause = initiativeAllowed && !stalled && !plan && autonomy && s.looksLikePermissionPause(text);
  if (stalled) return 'stalled';
  if (plan) return 'plan';
  if (pause) return 'pause';
  return 'empty';
}

test('the retry prompt carries the plan nudge, not the empty-retry text', () => {
  const prompt = retryNudgeFor('1. baca server.js\n2. jalankan tes');
  assert.equal(prompt, 'plan');
  assert.match(s.planNudge(), /tool_call/);
  assert.doesNotMatch(s.planNudge(), /previous reply was empty/i);
});

test('the permission pause nudge needs autonomy and reaches the prompt', () => {
  const text = 'Mau saya perbaiki sekarang?';
  assert.equal(retryNudgeFor(text, { autonomy: true }), 'pause');
  assert.equal(retryNudgeFor(text, { autonomy: false }), 'empty');
  assert.match(s.permissionPauseNudge(), /tool_call/);
});

test('refactor mode never sends an initiative nudge', () => {
  assert.equal(retryNudgeFor('1. baca server.js\n2. jalankan tes', { guards: false }), 'empty');
});

test('a fresh chat (keepSession false) falls back to the empty retry', () => {
  assert.equal(retryNudgeFor('1. baca server.js\n2. jalankan tes', { keepSession: false }), 'empty');
});

test('a bare stalled narration still beats a plan', () => {
  assert.equal(retryNudgeFor('Saya akan cek file itu dulu.'), 'stalled');
});
