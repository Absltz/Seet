import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchCoreSession } from '../src/components/workbenchCoreSession.mjs';

function scene() {
  return {
    attached: [], paused: 0, disposed: 0,
    attachCore(host, options) { this.attached.push({ host, options }); },
    suspendCore() { this.paused++; },
    dispose() { this.disposed++; },
  };
}

test('切出后暂停，切回复用同一场景和当前旋转姿态', async () => {
  const runtime = scene();
  let created = 0;
  const session = createWorkbenchCoreSession(async () => { created++; return runtime; });
  const first = session.acquire('对话标题一', { reduced: false });
  await first.ready;
  first.release();
  assert.equal(runtime.paused, 1);
  const second = session.acquire('对话标题二', { reduced: true });
  await second.ready;
  assert.equal(created, 1);
  assert.deepEqual(runtime.attached.at(-1), { host: '对话标题二', options: { reduced: true } });
  assert.equal(runtime.disposed, 0);
  first.release();
  assert.equal(runtime.paused, 1, '过期引用不能暂停当前页面的场景');
  second.release();
  session.dispose();
  session.dispose();
  assert.equal(runtime.disposed, 1);
});

test('StrictMode 的试挂载不会生成重复的 WebGL 场景', async () => {
  const runtime = scene(), hosts = [];
  const session = createWorkbenchCoreSession(async host => { hosts.push(host); return runtime; });
  const trial = session.acquire('试挂载', {});
  trial.release();
  const actual = session.acquire('正式挂载', {});
  await Promise.all([trial.ready, actual.ready]);
  assert.deepEqual(hosts, ['正式挂载']);
  assert.equal(runtime.attached.at(-1).host, '正式挂载');
  session.dispose();
});

test('异步初始化期间切页不会留下后台转动或重复创建', async () => {
  let resolve, creations = 0;
  const runtime = scene();
  const session = createWorkbenchCoreSession(() => {
    creations++;
    return new Promise(done => { resolve = done; });
  });
  const first = session.acquire('旧页面', {});
  await Promise.resolve();
  first.release();
  resolve(runtime);
  await first.ready;
  assert.equal(runtime.paused, 1);
  assert.equal(runtime.attached.length, 0);
  const next = session.acquire('新页面', {});
  await next.ready;
  assert.equal(creations, 1);
  assert.equal(runtime.attached.at(-1).host, '新页面');
  session.dispose();
});

test('离开工作区时释放资源，晚到的初始化也必须销毁', async () => {
  let resolve;
  const runtime = scene();
  const session = createWorkbenchCoreSession(() => new Promise(done => { resolve = done; }));
  const mount = session.acquire('标题', {});
  await Promise.resolve();
  session.dispose();
  resolve(runtime);
  await mount.ready;
  assert.equal(runtime.disposed, 1);
  assert.equal(runtime.attached.length, 0);
});

test('创建失败后允许下次进入重新尝试', async () => {
  let attempts = 0;
  const runtime = scene();
  const session = createWorkbenchCoreSession(async () => {
    if (++attempts === 1) throw new Error('显卡暂时不可用');
    return runtime;
  });
  const first = session.acquire('标题', {});
  await assert.rejects(first.ready, /显卡/);
  first.release();
  const second = session.acquire('标题', {});
  await second.ready;
  assert.equal(attempts, 2);
  session.dispose();
});

test('懒加载中的旧 host 已卸载时，自动接续当前挂载请求', async () => {
  let resolve;
  const hosts = [], runtime = scene();
  const session = createWorkbenchCoreSession(host => {
    hosts.push(host);
    return host === '旧标题' ? new Promise(done => { resolve = done; }) : runtime;
  });
  const old = session.acquire('旧标题', {});
  await Promise.resolve();
  old.release();
  const latest = session.acquire('新标题', {});
  resolve(null);
  await Promise.all([old.ready, latest.ready]);
  assert.deepEqual(hosts, ['旧标题', '新标题']);
  assert.equal(runtime.attached.at(-1).host, '新标题');
  session.dispose();
});

test('显卡上下文丢失后，下次进入重建场景而不是清掉兜底后继续留白', async () => {
  let available = true, creations = 0;
  const broken = scene(), recovered = scene();
  broken.isCoreAvailable = () => available;
  const session = createWorkbenchCoreSession(async () => ++creations === 1 ? broken : recovered);
  const first = session.acquire('标题', {});
  await first.ready;
  available = false;
  first.release();
  const retry = session.acquire('标题', {});
  await retry.ready;
  assert.equal(creations, 2);
  assert.equal(broken.disposed, 1);
  assert.equal(recovered.attached.length, 1);
  session.dispose();
});
