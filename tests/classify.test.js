// lib/classify.js: one table decides what an upstream failure is and whether the
// request can survive by hopping to another login.
const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../lib/classify');

const RATE_TEXT = 'Слишком частые сообщения. Повторите попытку позже';

test('classify: rate-limit wording wins over everything else', () => {
  const verdict = C.classifyUpstreamFailure({ status: 400, body: RATE_TEXT });
  assert.equal(verdict.kind, 'rate_limit');
  assert.equal(verdict.status, 429);
  assert.equal(verdict.failover, true, 'a throttled login must let the request hop');
  assert.match(verdict.detail, /Слишком частые/);
});

test('classify: a 429 without wording is still a rate limit', () => {
  assert.equal(C.classifyUpstreamFailure({ status: 429, body: '' }).kind, 'rate_limit');
});

test('classify: overflow is retryable locally but never a failover', () => {
  const verdict = C.classifyUpstreamFailure({ status: 400, body: 'Maximum context length exceeded' });
  assert.equal(verdict.kind, 'overflow');
  assert.equal(verdict.status, 400);
  assert.equal(verdict.failover, false);
  assert.equal(C.classifyUpstreamFailure({ body: RATE_TEXT }).kind, 'rate_limit', 'a rate limit is not an overflow');
});

test('classify: a dead credential fails over, a PoW/WAF 401 does not', () => {
  const dead = C.classifyUpstreamFailure({ status: 401, body: 'Authorization Failed (invalid token)' });
  assert.equal(dead.kind, 'auth');
  assert.equal(dead.failover, true);

  const transient = C.classifyUpstreamFailure({ status: 401, body: 'pow challenge failed' });
  assert.equal(transient.kind, 'auth_transient');
  assert.equal(transient.failover, false, 'a challenge is not a dead login');
  assert.equal(transient.retryable, true);
});

test('classify: timeout and plain upstream errors keep their own kind', () => {
  const timeout = C.classifyUpstreamFailure({ status: 502, body: '', timedOut: true });
  assert.equal(timeout.kind, 'timeout');
  assert.equal(timeout.status, 504);

  const plain = C.classifyUpstreamFailure({ status: 400, body: 'invalid parent message id' });
  assert.equal(plain.kind, 'upstream');
  assert.equal(plain.status, 400);
  assert.equal(plain.failover, false);

  assert.equal(C.classifyUpstreamFailure({}).status, 502, 'no status -> 502, not 0');
});

// lib/context.js: decisions are the part a condensed turn loses first.
test('extractDecisions keeps the reason, not only the paths', () => {
  const context = require('../lib/context');
  const turn = [
    'User: pick a store',
    'Assistant: We chose SQLite because the repo has no dependencies.',
    'Assistant: Do not change the parser in server.js.',
    'Assistant: ' + 'x'.repeat(3000),
  ].join('\n');
  const decisions = context.extractDecisions(turn);
  assert.ok(decisions.some(d => /SQLite/.test(d)), `missing reason: ${JSON.stringify(decisions)}`);
  assert.ok(decisions.some(d => /Do not change/.test(d)), `missing prohibition: ${JSON.stringify(decisions)}`);

  const condensed = context.condenseTurn(turn, 900);
  assert.ok(condensed.length <= 900, `condenseTurn overshot: ${condensed.length}`);
  assert.match(condensed, /\[decisions\]/);
  assert.match(condensed, /SQLite/);
});

test('extractDecisions is empty for prose with no decision', () => {
  const context = require('../lib/context');
  assert.deepEqual(context.extractDecisions('ran the tests and they were slow'), []);
});
