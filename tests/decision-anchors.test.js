// lib/context.js extractDecisions: must find real decisions in English and
// Indonesian, and must never harvest a tool call or a shell command that
// happens to contain a trigger word. The first version did exactly that on
// real session data (189 anchors -> 3 "decisions", all machinery).
const test = require('node:test');
const assert = require('node:assert/strict');

const { extractDecisions } = require('../lib/context');

const REAL = [
  'We chose SQLite because the repo has no dependencies.',
  'Pakai 30s cooldown karena throttle reset 15-30s.',
  'Jangan ubah parser di server.js.',
  'Saya pakai Node 24 untuk build.',
  'Gunakan port 9655 karena sudah dipakai.',
  'Never commit deepseek-auth.json.',
];

const MACHINERY = [
  'arguments: {"command":"git log --oneline -5","workdir":"D:\\\\proj","timeout":60000}',
  '{"command":"adb -s 192.168.18.44:36237 install -r build\\\\app.apk","workdir":"D:\\\\proj"}',
  'D:\\FreeDeepseekAPI\\lib\\context.js',
  'node --check lib/context.js; node -e "use because"',
  'npm test 2>&1 | Select-String -Pattern "pass"',
  'git commit -q -m "we chose X because Y"',
  'Get-Content data\\sessions.json -Raw | ConvertFrom-Json',
  'Tes lulus semua.',
  'Tidak saya cek: CI GitHub Actions.',
];

test('extractDecisions finds real decisions in English and Indonesian', () => {
  for (const line of REAL) {
    const found = extractDecisions(line, 4);
    assert.equal(found.length, 1, `missed: ${line}`);
    assert.ok(found[0].startsWith(line.slice(0, 20)), `wrong line: ${found[0]}`);
  }
});

test('extractDecisions never harvests a tool call or a shell command', () => {
  for (const line of MACHINERY) {
    assert.deepEqual(extractDecisions(line, 4), [], `harvested machinery: ${line}`);
  }
});

test('extractDecisions keeps prose line count sane on a mixed turn', () => {
  const turn = [...MACHINERY, ...REAL].join('\n');
  const found = extractDecisions(turn, 12);
  assert.equal(found.length, REAL.length, `expected ${REAL.length}, got ${found.length}: ${JSON.stringify(found)}`);
});
