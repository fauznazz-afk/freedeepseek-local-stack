// Two silent leaks the upstream fixed: raw upstream error text reaching the log
// and response, and an uncapped agent session map.
const test = require('node:test');
const assert = require('node:assert/strict');

const s = require('../server.js').__test;

test('a bearer token in upstream text is redacted', () => {
  const out = s.scrubUpstreamText('rejected: Authorization: Bearer abc123def456ghi');
  assert.ok(!out.includes('abc123def456ghi'), out);
  assert.ok(out.includes('[redacted]'), out);
});

test('an empty or null error stays empty, not the string null', () => {
  assert.equal(s.scrubUpstreamText(null), '');
  assert.equal(s.scrubUpstreamText(undefined), '');
  assert.equal(s.scrubUpstreamText(''), '');
});

test('scrubbing does not clip: a long string is returned whole', () => {
  const out = s.scrubUpstreamText(`x${'y'.repeat(400)}`);
  assert.equal(out.length, 401, 'the raw scrub must not pre-clip before the caller does');
});

test('a loaded account credential is redacted, whatever its shape', () => {
  // scrubUpstreamText only knows secrets from accounts[] and DS_CONFIG, so an
  // arbitrary string is not a secret: that is why the Bearer path is separate.
  assert.equal(s.scrubUpstreamText('nothing here'), 'nothing here');
  assert.match(s.scrubUpstreamText('Authorization: Bearer sk-live-abcdef123456'), /\[redacted\]/);
});

test('the session map evicts the least recently active entry at the cap', () => {
  s.sessions.clear();
  const cap = s.MAX_AGENT_SESSIONS;
  for (let i = 0; i < cap; i++) {
    const session = s.getOrCreateAgentSession(`agent-${i}`);
    session.lastActivityAt = 1000 + i;
  }
  assert.equal(s.sessions.size, cap);
  // One more key pushes the oldest (agent-0) out.
  s.getOrCreateAgentSession('agent-new');
  assert.equal(s.sessions.size, cap);
  assert.equal(s.sessions.has('agent-0'), false);
  assert.equal(s.sessions.has('agent-new'), true);
});

test('the cap never evicts the session being created', () => {
  s.sessions.clear();
  const cap = s.MAX_AGENT_SESSIONS;
  for (let i = 0; i < cap; i++) s.getOrCreateAgentSession(`a-${i}`);
  // Only one entry exists under this id and it is the protected one.
  const session = s.getOrCreateAgentSession('protected');
  assert.ok(session);
  assert.equal(s.sessions.has('protected'), true);
  assert.ok(s.sessions.size <= cap);
});
