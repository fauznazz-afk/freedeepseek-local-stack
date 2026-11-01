// The repair path (after a tool result) and the initiative nudge both send a
// strict retry. Only one may fire, or a single turn burns two attempts. These
// cases pin the split by re-running the same predicates the server uses.
const test = require('node:test');
const assert = require('node:assert/strict');

const s = require('../server.js').__test;

const AFTER_TOOL = [{ role: 'user', content: 'do it' }, { role: 'tool', content: 'ok' }];

// Mirror of the server's decision, so a change to either predicate shows here.
function classify(text, { messages = AFTER_TOOL, autonomy = false, noTools = false } = {}) {
  if (noTools) return 'no-tools';
  const initiative = s.looksLikeUnstartedPlan(text)
    || (autonomy && s.looksLikePermissionPause(text));
  const abandoned = !initiative && s.looksLikeAbandonedToolLoop(text, messages);
  return initiative ? 'initiative' : (abandoned ? 'abandoned' : 'none');
}

test('a plan after a tool result takes the initiative path, not both', () => {
  const text = '1. baca server.js\n2. jalankan tes';
  assert.equal(s.looksLikeUnstartedPlan(text), true);
  // looksLikeAbandonedToolLoop now rejects a final answer, and a numbered plan
  // with sentence punctuation reads as one. classify must still pick initiative.
  assert.equal(s.looksLikeAbandonedToolLoop(text, AFTER_TOOL), false);
  assert.equal(classify(text), 'initiative');
});

test('a permission pause after a tool result is initiative only with autonomy on', () => {
  const text = 'Mau saya perbaiki sekarang?';
  assert.equal(classify(text, { autonomy: true }), 'initiative');
  // Without autonomy the pause is not an initiative signal, and a question is
  // not a final answer either, so no repair fires at all.
  assert.equal(classify(text, { autonomy: false }), 'none');
});

test('a bare stop after a tool result stays on the abandoned path', () => {
  assert.equal(classify('ok'), 'abandoned');
});

test('a finished answer triggers neither repair', () => {
  assert.equal(classify('Selesai. Tes lulus 332/13 baseline.'), 'none');
});

test('the initiative prompt is the nudge, not the generic continue line', () => {
  assert.match(s.planNudge(), /plan/);
  assert.match(s.permissionPauseNudge(), /permission/);
  assert.notEqual(s.planNudge(), s.permissionPauseNudge());
});
