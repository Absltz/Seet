import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';

test('startup completion is announced after HTTP readiness and can suppress browser opening', async () => {
  let probes = 0;
  const server = http.createServer((req, res) => {
    probes++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ configured: false }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const child = spawn(process.execPath, ['scripts/start.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, PORT: String(server.address().port), SEET_NO_OPEN: '1', SEET_STARTUP_PROGRESS: '1' },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, output);
    assert.ok(probes > 0);
    assert.match(output, /\[5\/5\].*100%.*服务已就绪/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a readiness timeout remains a failure after terminating the unready server', async () => {
  await mkdir(new URL('../tmp/', import.meta.url), { recursive: true });
  const fixture = await mkdtemp(new URL('../tmp/startup-timeout-', import.meta.url));
  try {
    await mkdir(fixture + '/scripts'); await mkdir(fixture + '/server');
    await copyFile(new URL('../scripts/start.mjs', import.meta.url), fixture + '/scripts/start.mjs');
    await writeFile(fixture + '/server/index.mjs', 'setInterval(() => {}, 1000);');
    const portHolder = http.createServer();
    await new Promise(resolve => portHolder.listen(0, '127.0.0.1', resolve));
    const port = portHolder.address().port;
    await new Promise(resolve => portHolder.close(resolve));
    const child = spawn(process.execPath, ['scripts/start.mjs'], {
      cwd: fixture,
      env: { ...process.env, PORT: String(port), SEET_NO_OPEN: '1', SEET_STARTUP_PROGRESS: '1', SEET_STARTUP_TIMEOUT_MS: '100' },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 1, output);
    assert.doesNotMatch(output, /100%.*服务已就绪/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
