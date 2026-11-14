import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Windows startup recovers offline with verified bundles and real byte progress', { skip: process.platform !== 'win32' }, () => {
  const env = { ...process.env };
  delete env.PSModulePath; // PowerShell 7's module path is incompatible with Windows PowerShell 5.1.
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./bootstrap.test.ps1', import.meta.url))], { env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
