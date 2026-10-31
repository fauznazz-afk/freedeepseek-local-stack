// Initiative signals the proxy can see: a plan that was never executed, a
// blocked question that files could answer, and the same tool called again
// with identical arguments. Each has to fire on the real shape and stay quiet
// on a finished answer.
const test = require('node:test');
const assert = require('node:assert/strict');

const s = require('../server.js').__test;

const TOOL_RESULT = [{ role: 'user', content: 'x' }, { role: 'tool', content: 'ok' }];

const FINISHED = [
  'Selesai. Tes lulus 324/324.',
  'Fixed the parser and re-ran the tests.',
  'Risiko: build CI memakai Flutter 3.47.5.',
  'Setelah `npm run auth`, jendela Chrome terbuka.',
];

const PLANS = [
  '1. baca file server.js\n2. jalankan tes',
  'Rencana: baca dulu, lalu patch.',
  'Steps: read the parser, then fix it.',
];

const BLOCKED_QUESTIONS = [
  'Mau saya perbaiki sekarang?',
  'Saya sudah baca file itu. Mau saya lanjut?',
  'Should I run the tests?',
  'Saya lanjutkan ya?',
  'Want me to continue?',
];

test('a plan that was never executed is an initiative gap', () => {
  for (const text of PLANS) {
    assert.equal(s.looksLikeUnstartedPlan(text), true, `missed plan: ${text}`);
  }
  for (const text of FINISHED) {
    assert.equal(s.looksLikeUnstartedPlan(text), false, `false positive: ${text}`);
  }
});

test('a question after visible work is a permission pause, not a real blocker', () => {
  for (const text of BLOCKED_QUESTIONS) {
    assert.equal(s.looksLikePermissionPause(text), true, `missed: ${text}`);
  }
  // Real blockers name something the agent cannot get.
  const blockers = [
    'Mau saya pakai akun mana, akun1 atau akun2?',
    'Which credential should I use?',
    'Hapus data/sessions.json? Itu tidak bisa dibatalkan.',
  ];
  for (const text of blockers) {
    assert.equal(s.looksLikePermissionPause(text), false, `false positive: ${text}`);
  }
});

test('a repeated identical tool call is a loop, a different one is not', () => {
  const calls = [
    { name: 'shell', args: { command: 'npm test' } },
    { name: 'shell', args: { command: 'npm test' } },
    { name: 'shell', args: { command: 'npm test' } },
  ];
  // The key is the exact payload, so identical objects must produce the same key.
  assert.equal(s.detectRepeatedToolCall(calls), 'shell: {"command":"npm test"}');
  assert.equal(s.detectRepeatedToolCall([calls[0], { name: 'shell', args: { command: 'git status' } }]), null);
  assert.equal(s.detectRepeatedToolCall([calls[0]]), null);
  assert.equal(s.detectRepeatedToolCall([]), null);
});

test('the repeat threshold is three, so two tries are still a legitimate retry', () => {
  const twice = [
    { name: 'read', args: { path: 'a.js' } },
    { name: 'read', args: { path: 'a.js' } },
  ];
  assert.equal(s.detectRepeatedToolCall(twice), null);
});

test('the loop history is read from the session, not from the inbound messages', () => {
  const session = { history: [{ tool_calls: [{ function: { name: 'shell', arguments: '{"command":"npm test"}' } }] }] };
  assert.deepEqual(s.recentToolCalls(session, 5), [{ name: 'shell', args: { command: 'npm test' } }]);
  // A history entry without tool_calls is not a call.
  assert.deepEqual(s.recentToolCalls({ history: [{ user: 'hi', assistant: 'ok' }] }, 5), []);
});

test('the nudges say what to do and do not leave the nudge round open', () => {
  const plan = s.planNudge();
  assert.match(plan, /tool_call/);
  assert.match(plan, /plan|rencana|first step/i);
  const pause = s.permissionPauseNudge();
  assert.match(pause, /tool_call/);
  assert.match(pause, /blocker|tidak bisa/i);
  const loop = s.toolLoopNudge('shell: npm test');
  assert.match(loop, /npm test/);
  assert.match(loop, /change approach|blocker/i);
});

// The stalled narration still wins over a plan: it is the narrower signal.
test('narration and plan detection stay separate', () => {
  assert.equal(s.looksLikeStalledNarration('Saya akan cek file itu dulu.'), true);
  assert.equal(s.looksLikeStalledNarration('1. baca file\n2. jalankan tes'), false);
  assert.equal(s.looksLikeUnstartedPlan('Saya akan cek file itu dulu.'), false);
});
