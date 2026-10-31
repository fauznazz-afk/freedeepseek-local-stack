// Tool definitions are rebuilt on every request. An agent opening many sessions
// sends the same blob each time, so the builder is memoized by schema identity.
const test = require('node:test');
const assert = require('node:assert/strict');

const s = require('../server.js').__test;

function tool(name, description = 'does a thing') {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties: { q: { type: 'string', description: 'query' } } },
    },
  };
}

test('the same tool set yields the same text and hits the cache', () => {
  s.toolDefinitionCache.clear();
  const tools = [tool('alpha'), tool('beta')];
  const first = s.formatToolDefinitions(tools);
  assert.ok(first.includes('alpha') && first.includes('beta'));
  assert.equal(s.toolDefinitionCache.size, 1);
  const second = s.formatToolDefinitions(tools);
  assert.equal(second, first);
  assert.equal(s.toolDefinitionCache.size, 1);
});

test('a changed tool set is a new entry, not a stale hit', () => {
  s.toolDefinitionCache.clear();
  const a = s.formatToolDefinitions([tool('alpha')]);
  const b = s.formatToolDefinitions([tool('alpha'), tool('beta')]);
  assert.notEqual(a, b);
  assert.equal(s.toolDefinitionCache.size, 2);
});

test('a changed description changes the text', () => {
  s.toolDefinitionCache.clear();
  const a = s.formatToolDefinitions([tool('alpha', 'first')]);
  const b = s.formatToolDefinitions([tool('alpha', 'second')]);
  assert.notEqual(a, b);
});

test('the cache is bounded', () => {
  s.toolDefinitionCache.clear();
  for (let i = 0; i < 40; i++) s.formatToolDefinitions([tool(`t${i}`)]);
  assert.ok(s.toolDefinitionCache.size <= 16, `cache grew to ${s.toolDefinitionCache.size}`);
});

test('no tools means no text and no cache entry', () => {
  s.toolDefinitionCache.clear();
  assert.equal(s.formatToolDefinitions([]), '');
  assert.equal(s.formatToolDefinitions(null), '');
  assert.equal(s.toolDefinitionCache.size, 0);
});

test('a mutating caller does not corrupt the cached text', () => {
  s.toolDefinitionCache.clear();
  const tools = [tool('alpha')];
  const first = s.formatToolDefinitions(tools);
  tools[0].function.name = 'renamed';
  const second = s.formatToolDefinitions(tools);
  assert.notEqual(first, second, 'a mutated schema must miss the cache');
  assert.ok(second.includes('renamed'));
});
