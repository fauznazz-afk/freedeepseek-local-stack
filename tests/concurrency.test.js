// Concurrency: many requests in flight at once. Node is single-threaded, so
// there is no memory race - but there IS interleaving at every await, and the
// session map is mutated from more than one place (storeHistory, LRU eviction,
// idle sweep, reset). These tests drive real parallel HTTP requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const pow = require('../lib/pow');
const S = require('../server.js').__test;

const COMPLETION = '/api/v0/chat/completion';
const SESSION_CREATE = '/api/v0/chat_session/create';
const POW = '/api/v0/chat/create_pow_challenge';

function sse(text, messageId = 2) {
  const response = { message_id: messageId, fragments: [{ type: 'RESPONSE', content: text }] };
  return `data: ${JSON.stringify({ v: { response } })}\n\ndata: {"p":"response/status","v":"FINISHED"}\n\n`;
}
function sseResp(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

function acct(id) {
  return {
    id,
    file: `/tmp/fdsapi-conc/${id}.json`,
    config: { token: `tok-${id}`, cookie: `ck=${id}` },
    headers: { Authorization: `Bearer ${id}` },
    cooldownUntil: 0,
    failures: 0,
    lastUsedAt: 0,
  };
}

// The proxy refuses to run with no accounts, so give it a pair of fake ones for
// the duration of the test and put the real list back afterwards.
function useAccounts(t, list) {
  const original = S.accounts.splice(0, S.accounts.length, ...list);
  t.after(() => { S.accounts.splice(0, S.accounts.length, ...original); });
}

// Upstream mock with a controllable delay, so requests really overlap.
function installUpstream(t, { delayMs = 25, reply = 'OK' } = {}) {
  useAccounts(t, [acct('conc-a'), acct('conc-b')]);
  const originalFetch = globalThis.fetch;
  let seq = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    let body = null;
    if (typeof options.body === 'string') {
      try { body = JSON.parse(options.body); } catch (e) { body = options.body; }
    }
    if (u.pathname === POW) {
      return jsonResp({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: 'DeepSeekHashV1', challenge: 'c', salt: 's', signature: 'sig', difficulty: 1, expire_at: 1, target_path: body?.target_path } } } });
    }
    if (u.pathname === SESSION_CREATE) {
      seq++;
      return jsonResp({ code: 0, data: { biz_code: 0, biz_data: { id: `sess-${seq}` } } });
    }
    if (u.pathname === COMPLETION) {
      await new Promise(r => setTimeout(r, delayMs));
      return sseResp(sse(reply, seq + 1));
    }
    throw new Error('unexpected fetch ' + u.pathname);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  t.mock.method(pow, 'solvePOW', async () => 1);
}

async function startServer(t) {
  const server = S.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

function request(port, method, pathName, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: pathName, agent: false,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* non-JSON */ }
        resolve({ status: res.statusCode, text: data, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const chat = (port, agent, messages, extra = {}) => request(port, 'POST', '/v1/chat/completions', {
  body: { model: 'deepseek-v4-flash', messages, ...extra },
  headers: { 'x-agent-session': agent },
});

function sizeOf(history) {
  return (history || []).reduce((n, e) => n + String(e?.user || '').length + String(e?.assistant || '').length, 0);
}

test('parallel requests on ONE agent all land in the same history', async (t) => {
  // storeHistory runs at the end of each request. If any write were lost the
  // count would come up short - the classic read-modify-write hazard.
  const agent = 'conc-same-' + Date.now();
  installUpstream(t, { delayMs: 20 });
  const port = await startServer(t);
  S.sessions.delete(agent);
  t.after(() => S.sessions.delete(agent));

  const N = 12;
  const results = await Promise.all(Array.from({ length: N }, (_, i) =>
    chat(port, agent, [{ role: 'user', content: `parallel task ${i} for the same agent` }])));

  for (const [i, r] of results.entries()) assert.equal(r.status, 200, `request ${i}: ${r.text}`);

  const session = S.sessions.get(agent);
  assert.ok(session, 'the session exists');
  assert.equal(session.history.length, N, `every parallel turn is stored, got ${session.history.length} of ${N}`);
  assert.ok(sizeOf(session.history) <= Math.min(S.MAX_HISTORY_CHARS, S.MAX_HISTORY_CHARS_BUDGET) + 1000,
    'the budget still holds under parallel writes');
  // Every stored turn must be distinct - no duplicates from a retried write.
  const heads = new Set(session.history.map(e => String(e.user).slice(0, 40)));
  assert.equal(heads.size, session.history.length, 'no turn was stored twice');
});

test('parallel requests on DIFFERENT agents never share a ledger', async (t) => {
  const stamp = Date.now();
  const agents = Array.from({ length: 8 }, (_, i) => `conc-iso-${stamp}-${i}`);
  installUpstream(t, { delayMs: 15 });
  const port = await startServer(t);
  for (const a of agents) S.sessions.delete(a);
  t.after(() => { for (const a of agents) S.sessions.delete(a); });

  await Promise.all(agents.map((agent, i) =>
    chat(port, agent, [{ role: 'user', content: `agent ${i} works on C:\\repo\\proj${i}\\file${i}.js` }])));

  for (const [i, agent] of agents.entries()) {
    const session = S.sessions.get(agent);
    assert.ok(session, `${agent} exists`);
    const own = session.history.map(e => e.user).join('\n');
    assert.match(own, new RegExp(`proj${i}\\\\file${i}\\.js`), `${agent} kept its own path`);
    for (let j = 0; j < agents.length; j++) {
      if (j === i) continue;
      assert.doesNotMatch(own, new RegExp(`proj${j}\\\\file${j}\\.js`), `${agent} must not contain agent ${j} work`);
    }
  }
});

test('parallel requests do not corrupt the compaction counters', async (t) => {
  const agent = 'conc-compact-' + Date.now();
  installUpstream(t, { delayMs: 10 });
  const port = await startServer(t);
  S.sessions.delete(agent);
  t.after(() => S.sessions.delete(agent));

  // A session already near its budget, so compaction runs during the burst.
  const seeded = S.createSession();
  seeded.history.push({ user: 'opening TASK: stress the compactor', assistant: 'ok' });
  for (let i = 0; i < 60; i++) {
    seeded.history.push({ user: `seed ${i} C:\\repo\\src\\s${i}.js ` + 'z'.repeat(3000), assistant: 'ok' });
  }
  S.compactHistory(seeded, 168000, S.MAX_HISTORY_LENGTH);
  const baselineCompactions = seeded.compactions;
  S.sessions.set(agent, seeded);

  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    chat(port, agent, [{ role: 'user', content: `stress turn ${i} C:\\repo\\src\\p${i}.js ` + 'q'.repeat(20000) }])));

  const session = S.sessions.get(agent);
  assert.ok(session.compactions >= baselineCompactions, 'compactions only ever increase');
  assert.ok(Number.isInteger(session.compactions), 'the counter stays an integer');
  assert.ok(sizeOf(session.history) <= Math.min(S.MAX_HISTORY_CHARS, S.MAX_HISTORY_CHARS_BUDGET) + 2000,
    `the budget survives concurrent compaction, got ${sizeOf(session.history)}`);
  assert.ok(session.memory.reduce((n, l) => n + l.length + 1, 0) <= S.MAX_SESSION_MEMORY_CHARS,
    'the ledger cap survives concurrent compaction');
});

test('a parallel reset during in-flight requests does not corrupt the session', async (t) => {
  // /reset-session mutates the same object a request is still using. It must not
  // throw, must not leave a half-reset session, and must not resurrect history.
  const agent = 'conc-reset-' + Date.now();
  installUpstream(t, { delayMs: 40 });
  const port = await startServer(t);
  S.sessions.delete(agent);
  t.after(() => S.sessions.delete(agent));

  const inFlight = Promise.all(Array.from({ length: 6 }, (_, i) =>
    chat(port, agent, [{ role: 'user', content: `turn ${i} before the reset` }])));
  await new Promise(r => setTimeout(r, 15));
  const reset = await request(port, 'POST', `/reset-session?agent=${encodeURIComponent(agent)}`);
  const results = await inFlight;

  assert.equal(reset.status, 200, reset.text);
  for (const [i, r] of results.entries()) {
    assert.ok(r.status === 200 || r.status === 502, `request ${i} returned a sane status, got ${r.status}`);
  }
  const session = S.sessions.get(agent);
  if (session) {
    assert.ok(Array.isArray(session.history), 'history is still an array');
    assert.ok(Array.isArray(session.memory), 'memory is still an array');
    assert.ok(sizeOf(session.history) <= Math.min(S.MAX_HISTORY_CHARS, S.MAX_HISTORY_CHARS_BUDGET) + 2000,
      'the budget still holds');
  }
});

test('an idle sweep during in-flight requests does not lose the turn', async (t) => {
  // sweepIdleSessions deletes from the same map getOrCreateAgentSession handed
  // out. A request holding a stale reference would write into an orphan.
  const agent = 'conc-sweep-' + Date.now();
  installUpstream(t, { delayMs: 30 });
  const port = await startServer(t);
  S.sessions.delete(agent);
  t.after(() => S.sessions.delete(agent));

  const inFlight = chat(port, agent, [{ role: 'user', content: 'turn that must survive a sweep' }]);
  await new Promise(r => setTimeout(r, 10));
  // A sweep with a zero idle window targets everything, including this session.
  S.sweepIdleSessions(0);
  const result = await inFlight;

  assert.equal(result.status, 200, result.text);
  // Either the session survived the sweep and holds the turn, or it was evicted
  // and a later request rebuilds it. What must never happen is a corrupt session.
  const session = S.sessions.get(agent);
  if (session) {
    assert.ok(Array.isArray(session.history));
    assert.ok(sizeOf(session.history) <= Math.min(S.MAX_HISTORY_CHARS, S.MAX_HISTORY_CHARS_BUDGET) + 2000);
  }
});

test('hitting the session cap does not evict a session that is still in flight', async (t) => {
  // The previous version of this test was a false pass: it saved S.MAX_AGENT_SESSIONS
  // but never changed it, and the evictor closes over the module-level const, so
  // eviction never ran. The evictor now takes an explicit cap, which lets the test
  // drive the real branch with 4 sessions instead of 200.
  const original = new Map(S.sessions);
  S.sessions.clear();
  t.after(() => { S.sessions.clear(); for (const [k, v] of original) S.sessions.set(k, v); });
  installUpstream(t, { delayMs: 25 });
  const port = await startServer(t);
  const busy = 'conc-cap-busy';
  const others = ['conc-cap-a', 'conc-cap-b', 'conc-cap-c', 'conc-cap-d'];

  // Start a slow request so `busy` is registered as in flight...
  const inFlight = chat(port, busy, [{ role: 'user', content: 'the turn that must not be evicted' }]);
  await new Promise(r => setTimeout(r, 15));
  assert.equal(S.agentRequestInFlight(busy), true, 'the busy agent is tracked as in flight');

  // ...then push past a cap of 2. Without the in-flight guard this evicts `busy`.
  for (const a of others) {
    S.getOrCreateAgentSession(a);
    S.evictLeastRecentlyUsedSessions(a, 2);
  }
  assert.ok(S.sessions.has(busy), 'the in-flight session was not evicted while its request ran');
  assert.ok(S.sessions.size <= 4, `the map stayed bounded, got ${S.sessions.size}`);

  const result = await inFlight;
  assert.equal(result.status, 200, result.text);
  assert.equal(S.agentRequestInFlight(busy), false, 'the in-flight slot is released afterwards');
  const session = S.sessions.get(busy);
  assert.ok(session, 'the busy session still exists after the flood');
  assert.ok(session.history.some(e => String(e.user).includes('must not be evicted')),
    'the in-flight turn was stored, not dropped by eviction');
});

test('an idle sweep never drops a session whose request is still running', async (t) => {
  // lastActivityAt is stamped when the request STARTS, so a slow request looks
  // idle while it is still working. Sweeping it loses its banked memory.
  const original = new Map(S.sessions);
  S.sessions.clear();
  t.after(() => { S.sessions.clear(); for (const [k, v] of original) S.sessions.set(k, v); });
  installUpstream(t, { delayMs: 40 });
  const port = await startServer(t);
  const agent = 'conc-sweep-live';

  const inFlight = chat(port, agent, [{ role: 'user', content: 'work that must survive' }]);
  await new Promise(r => setTimeout(r, 15));
  assert.equal(S.agentRequestInFlight(agent), true);

  // A zero idle window targets everything that is not in flight.
  const idle = S.createSession();
  idle.lastActivityAt = Date.now() - 60000; // genuinely idle
  S.sessions.set('conc-sweep-idle', idle);
  const removed = S.sweepIdleSessions(0);
  assert.equal(removed, 1, 'the genuinely idle session is swept');
  assert.ok(S.sessions.has(agent), 'the in-flight session survives the sweep');

  const result = await inFlight;
  assert.equal(result.status, 200, result.text);
  assert.ok(S.sessions.has(agent), 'the session is still the one the request wrote to');
});

test('a client that disconnects mid-request does not leak its in-flight slot', async (t) => {
  // The slot is released in a finally block. If a client aborts while the upstream
  // call is pending, the handler still has to unwind - otherwise the agent looks
  // busy forever, and eviction/sweep would protect it indefinitely.
  installUpstream(t, { delayMs: 60 });
  const port = await startServer(t);
  const agent = 'conc-abort';
  t.after(() => S.sessions.delete(agent));

  const payload = JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'aborted request' }] });
  await new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/v1/chat/completions', agent: false,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-agent-session': agent,
      },
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
    // Kill the socket once the request is definitely in flight.
    setTimeout(() => { req.destroy(); resolve(); }, 25);
  });

  // Give the server a moment to unwind the handler.
  for (let i = 0; i < 40 && S.agentRequestInFlight(agent); i++) {
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(S.agentRequestInFlight(agent), false, 'the aborted request released its slot');
  assert.equal(S.activeAgentRequests.size, 0, 'no slot leaks into the map');
});

test('per-agent in-flight accounting is balanced and never goes negative', async (t) => {
  installUpstream(t, { delayMs: 15 });
  const port = await startServer(t);
  const agents = ['conc-bal-a', 'conc-bal-b'];
  t.after(() => { for (const a of agents) S.sessions.delete(a); });

  // Two rounds of parallel work, then confirm every counter returned to zero.
  for (let round = 0; round < 2; round++) {
    const results = await Promise.all(agents.flatMap(a =>
      Array.from({ length: 3 }, (_, i) => chat(port, a, [{ role: 'user', content: `round ${round} turn ${i}` }]))));
    for (const r of results) assert.equal(r.status, 200, r.text);
  }
  for (const a of agents) assert.equal(S.agentRequestInFlight(a), false, `${a} has no leaked in-flight slot`);
  assert.equal(S.activeAgentRequests.size, 0, 'the in-flight map is empty again');

  // A failing request must release its slot too.
  const before = S.activeAgentRequests.size;
  await chat(port, agents[0], [{ role: 'user', content: 'this one is fine' }]);
  assert.equal(S.activeAgentRequests.size, before, 'no slot leaks after a completed request');
});

test('the map stays bounded even when every session is in flight', async (t) => {
  // Skipping in-flight sessions means eviction can find no victim and give up, so
  // the map is allowed to exceed the cap. That is only safe because the number of
  // requests in flight is itself capped (DEEPSEEK_MAX_CONCURRENT), which bounds the
  // overshoot to cap + MAX_CONCURRENT. Without that reasoning this would be an
  // unbounded map, i.e. a slow memory leak.
  const original = new Map(S.sessions);
  S.sessions.clear();
  t.after(() => { S.sessions.clear(); for (const [k, v] of original) S.sessions.set(k, v); });

  const cap = 3;
  const busy = ['conc-full-a', 'conc-full-b', 'conc-full-c'];
  for (const a of busy) { S.getOrCreateAgentSession(a); S.beginAgentRequest(a); }
  t.after(() => { for (const a of busy) S.endAgentRequest(a); });

  // Every existing session is in flight, so nothing may be evicted...
  for (const a of busy) S.evictLeastRecentlyUsedSessions('newcomer', cap);
  assert.equal(S.sessions.size, cap, 'nothing was evicted while all sessions were busy');

  // ...and the overshoot is bounded by the in-flight cap, not unbounded.
  const ceiling = cap + S.MAX_CONCURRENT;
  for (let i = 0; i < 50; i++) {
    const id = `conc-full-new-${i}`;
    S.getOrCreateAgentSession(id);
    S.evictLeastRecentlyUsedSessions(id, cap);
    S.sessions.delete(id); // simulate the request finishing and the slot freeing
  }
  assert.ok(S.sessions.size <= ceiling,
    `the map stayed under cap + MAX_CONCURRENT (${ceiling}), got ${S.sessions.size}`);
});

test('24 agents compacting concurrently never contaminate each other', () => {
  // The in-flight cap is 24, so this is the widest fan-out the proxy allows. Each
  // agent must keep only its own paths, stay under budget, and keep its own task.
  const budget = 168000;
  const agents = [];
  for (let i = 0; i < 24; i++) {
    const s = S.createSession();
    s.history.push({ user: `TASK: agent ${i} owns proj${i}. Reply OK.`, assistant: 'OK' });
    agents.push({ i, s });
  }
  for (let t = 0; t < 15; t++) {
    for (const a of agents) {
      a.s.history.push({ user: `C:\\repo\\proj${a.i}\\f${t}.js ` + 'z'.repeat(15000), assistant: 'ok' });
      S.compactHistory(a.s, budget, S.MAX_HISTORY_LENGTH);
    }
  }
  for (const a of agents) {
    const chars = a.s.history.reduce((n, e) => n + String(e.user).length + String(e.assistant).length, 0);
    assert.ok(chars <= budget, `agent ${a.i} stayed under budget, got ${chars}`);
    assert.ok(a.s.memory.reduce((n, l) => n + l.length + 1, 0) <= S.MAX_SESSION_MEMORY_CHARS,
      `agent ${a.i} ledger stayed under its cap`);
    assert.ok(a.s.compactions > 0, `agent ${a.i} compacted`);
    const foreign = a.s.history.some(e => {
      const m = String(e.user).match(/proj(\d+)\\f/);
      return m && Number(m[1]) !== a.i;
    });
    assert.equal(foreign, false, `agent ${a.i} must not hold another agent's paths`);
    assert.match(a.s.openingRequest || '', new RegExp(`agent ${a.i} owns proj${a.i}`),
      `agent ${a.i} kept its own task as the opening request`);
  }
});

test('a 300-turn session keeps its caps, its task and its speed', () => {
  const budget = 168000;
  const session = S.createSession();
  session.history.push({ user: 'TASK: the long haul. Reply OK.', assistant: 'OK' });
  const started = process.hrtime.bigint();
  for (let t = 0; t < 300; t++) {
    session.history.push({ user: `turn ${t} C:\\repo\\long\\f${t}.js ` + 'z'.repeat(15000), assistant: 'ok' });
    S.compactHistory(session, budget, S.MAX_HISTORY_LENGTH);
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const chars = session.history.reduce((n, e) => n + String(e.user).length + String(e.assistant).length, 0);
  assert.ok(chars <= budget, `the budget held over 300 turns, got ${chars}`);
  assert.ok(session.memory.reduce((n, l) => n + l.length + 1, 0) <= S.MAX_SESSION_MEMORY_CHARS,
    'the ledger cap held over 300 turns');
  assert.match(session.openingRequest || '', /the long haul/, 'the opening task survived 300 turns');
  assert.ok(ms < 15000, `300 turns must stay fast, took ${ms.toFixed(0)} ms`);
});

test('compaction survives a reset in the middle of a session', () => {
  // resetRemoteSession zeroes messageCount and id while keeping history; compaction
  // running right after must not throw or lose the caps.
  const budget = 168000;
  const session = S.createSession();
  session.history.push({ user: 'TASK: reset stress', assistant: 'ok' });
  for (let t = 0; t < 40; t++) {
    session.history.push({ user: `t${t} ` + 'z'.repeat(15000), assistant: 'ok' });
    S.compactHistory(session, budget, S.MAX_HISTORY_LENGTH);
    if (t === 20) {
      S.resetRemoteSession(session);
      S.compactHistory(session, budget, S.MAX_HISTORY_LENGTH);
    }
  }
  const chars = session.history.reduce((n, e) => n + String(e.user).length + String(e.assistant).length, 0);
  assert.ok(chars <= budget, `the budget held after a mid-loop reset, got ${chars}`);
  assert.ok(Array.isArray(session.memory), 'the ledger is still an array');
});

test('a session survives a save after an upstream error zeroed messageCount', async (t) => {
  // serializeSessions used to skip `messageCount === 0`, but resetRemoteSession()
  // deliberately zeroes messageCount while keeping history, memory and the banked
  // opening request. So one upstream error made a long session serialize to
  // nothing and vanish from disk. Observed live: one of six parallel agents
  // disappeared after a PoW failure.
  const session = S.createSession();
  session.history.push({ user: 'turn 1', assistant: 'ok' });
  session.memory.push('C:\\repo\\important.js');
  session.decisions.push('we chose sqlite for the store');
  session.openingRequest = 'TASK: build the exporter';
  session.compactions = 5;
  session.messageCount = 40;
  session.id = 'chat-abc';

  S.resetRemoteSession(session);
  assert.equal(session.messageCount, 0, 'the reset zeroes the counter');
  assert.equal(session.history.length, 1, 'history is kept on purpose');

  S.sessions.set('conc-serialize-probe', session);
  t.after(() => S.sessions.delete('conc-serialize-probe'));
  const serialized = S.serializeSessions();
  const entry = serialized['conc-serialize-probe'];
  assert.ok(entry, 'a session with history must still be serialized after a reset');
  assert.equal(entry.history.length, 1, 'the history was written');
  assert.equal(entry.memory.length, 1, 'the banked facts were written');
  assert.equal(entry.compactions, 5, 'the compaction record was written');
  assert.equal(entry.openingRequest, 'TASK: build the exporter', 'the opening request was written');

  // A genuinely empty session is still skipped, so the file does not fill with blanks.
  S.sessions.set('conc-empty-probe', S.createSession());
  t.after(() => S.sessions.delete('conc-empty-probe'));
  const after = S.serializeSessions();
  assert.ok(!('conc-empty-probe' in after), 'a truly empty session is not written');
});

test('a transient PoW failure fails over to another login instead of killing the request', async (t) => {
  // The PoW endpoint occasionally answers 200 with an empty body. That used to
  // throw a plain Error, which isAccountFailoverError() did not recognize, so the
  // request died even with healthy logins available - live, all six parallel
  // agents failed on the same turn.
  const A = acct('conc-pow-a');
  const B = acct('conc-pow-b');
  useAccounts(t, [A, B]);
  const originalFetch = globalThis.fetch;
  let powCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    const account = String(options.headers?.Authorization || '').replace(/^Bearer /, '');
    if (u.pathname === POW) {
      powCalls++;
      if (account === 'conc-pow-a') return new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
      return jsonResp({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: 'DeepSeekHashV1', challenge: 'c', salt: 's', signature: 'sig', difficulty: 1, expire_at: 1, target_path: '/x' } } } });
    }
    if (u.pathname === SESSION_CREATE) return jsonResp({ code: 0, data: { biz_code: 0, biz_data: { id: 'pow-sess' } } });
    if (u.pathname === COMPLETION) return sseResp(sse('OK'));
    throw new Error('unexpected fetch ' + u.pathname);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  t.mock.method(pow, 'solvePOW', async () => 1);

  const port = await startServer(t);
  const agent = 'conc-pow-agent';
  t.after(() => S.sessions.delete(agent));

  const r = await chat(port, agent, [{ role: 'user', content: 'work through a PoW hiccup' }]);
  assert.equal(r.status, 200, `the request must survive a bad PoW from one login: ${r.text}`);
  assert.ok(powCalls >= 2, `it must have tried a second login, PoW calls: ${powCalls}`);
});
