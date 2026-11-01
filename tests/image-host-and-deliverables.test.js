// #3: two SSRF / path-leak holes closed against upstream.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const s = require('../server.js').__test;

const PRIVATE = ['::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:127.0.0.1', '::ffff:192.168.1.5', '::ffff:169.254.169.254', '::1', 'fc00::1', 'fe80::1'];
const PUBLIC = ['::ffff:808:808', '::ffff:8.8.8.8', '2001:4860:4860::8888'];

test('every textual form of an IPv4-mapped private host is rejected', () => {
  for (const host of PRIVATE) assert.equal(s.isPrivateNetworkAddress(host), true, host);
});

test('a mapped public IPv4 stays public', () => {
  for (const host of PUBLIC) assert.equal(s.isPrivateNetworkAddress(host), false, host);
});

test('the IPv4 part is decoded from groups, not from the text', () => {
  assert.equal(s.ipv4FromMappedIpv6('::ffff:7f00:1'), '127.0.0.1');
  assert.equal(s.ipv4FromMappedIpv6('::ffff:808:808'), '8.8.8.8');
  assert.equal(s.ipv4FromMappedIpv6('2001:db8::1'), '');
  assert.equal(s.ipv4FromMappedIpv6('not-an-address'), '');
});

function toolTurn(filePath) {
  return [{ role: 'user', content: 'shot' }, { role: 'tool', content: JSON.stringify({ screenshot_path: filePath }) }];
}

function tmpFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-deliver-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes || 'x');
  return file;
}

test('a real image inside the temp dir becomes a MEDIA tag', () => {
  const out = s.extractScreenshotPaths(toolTurn(tmpFile('a.png')));
  assert.equal(out.length, 1);
  assert.match(out[0], /^MEDIA:/);
});

test('a non-image file in the temp dir is dropped', () => {
  assert.deepEqual(s.extractScreenshotPaths(toolTurn(tmpFile('a.txt'))), []);
});

test('an image path outside the temp dir is dropped, even if it exists', () => {
  assert.deepEqual(s.extractScreenshotPaths(toolTurn(path.join(__dirname, '..', 'package.json'))), []);
});

test('a relative or empty path is dropped', () => {
  assert.deepEqual(s.extractScreenshotPaths(toolTurn('a.png')), []);
  assert.deepEqual(s.extractScreenshotPaths(toolTurn('')), []);
});
