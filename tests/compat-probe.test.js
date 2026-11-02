// Client-compatibility probes (OpenCode V2 and similar).
//
// These are GET endpoints a client hits BEFORE it has a proxy key, so they must
// be public. The trap: `isPublicProbe` only skips the 401 gate - the request
// still has to be ANSWERED, or it falls through to the catch-all
// `res.writeHead(404); res.end('Not found')`. A probe that 401s or 404s makes a
// client declare the proxy dead, so the route and the exemption have to move
// together and both are asserted here.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const S = require('../server.js').__test;

async function startServer(t) {
  const server = S.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

function request(port, method, pathName, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method, path: pathName, agent: false, headers,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* non-JSON body */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('client compatibility probes answer without a proxy key', async (t) => {
  const port = await startServer(t);

  for (const pathName of ['/v2/health', '/api/info']) {
    const res = await request(port, 'GET', pathName);
    assert.equal(res.status, 200, `${pathName} must not be gated or 404 (got ${res.status}: ${res.text})`);
    assert.equal(res.json?.ok, true, `${pathName} must report ok:true, got ${res.text}`);
  }
});

test('/health keeps its full payload and is not shadowed by the bare-ok route', async (t) => {
  // Regression: the compatibility block listed '/health' alongside the new paths.
  // '/health' is answered earlier in the handler, so the duplicate was dead code
  // that would have downgraded a 2902-char status payload to {"ok":true} if the
  // earlier branch were ever reordered or removed.
  const port = await startServer(t);
  const res = await request(port, 'GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.json?.status, 'ok');
  assert.equal(res.json?.service, 'FreeDeepseekAPI');
  assert.ok(Array.isArray(res.json?.models), 'the health payload still lists models');
  assert.notEqual(res.text, '{"ok":true}', '/health must not collapse to the bare compatibility body');
});

test('an unknown GET is still 404, so the probe exemption is not a catch-all', async (t) => {
  const port = await startServer(t);
  const res = await request(port, 'GET', '/definitely-not-a-probe');
  assert.equal(res.status, 404);
});
