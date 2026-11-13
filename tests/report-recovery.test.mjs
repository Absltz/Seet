import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { reportRouter } from '../server/report/index.mjs';
import { composeReport } from '../server/report/compose.mjs';
import { requestReport } from '../src/reportApi.mjs';
import { validateStoredReport } from '../server/report/storage.mjs';

const input = {
  dataset: { title: '设备巡检记录', dimensions: [{ key: '站点', type: 'text' }],
    metrics: [{ key: '巡检次数', unit: '次' }],
    rows: [{ name: '甲站', 站点: '甲站', 巡检次数: 7 }, { name: '乙站', 站点: '乙站', 巡检次数: 11 }] },
  history: [{ role: 'user', text: '比较各站点的巡检情况' }],
};

async function endpoint(t, options) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { username: 'report_test' }; next(); });
  app.use('/report', reportRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { response, events: (await response.text()).trim().split('\n').map(JSON.parse) };
  };
}

const pdf = { bytes: Buffer.from('%PDF-1.4\n%%EOF'), pages: 6 };

test('模型未配置时自动生成可预览的统计 PDF，不停在错误页面', async t => {
  const previous = process.env.AI_API_KEY;
  process.env.AI_API_KEY = '';
  t.after(() => previous === undefined ? delete process.env.AI_API_KEY : process.env.AI_API_KEY = previous);
  const post = await endpoint(t);
  const { response, events } = await post(input);
  assert.equal(response.status, 200);
  assert.ok(!events.some(event => event.type === 'error'));
  const result = events.find(event => event.type === 'result')?.result;
  assert.equal(result?.mode, 'rules');
  assert.equal(Buffer.from(result.pdf, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.model, '程序统计');
  assert.equal(validateStoredReport({ key: 'abcdef0123456789', result }).result.mode, 'rules');
});

test('专题格式失败时整份报告自动改用原始统计快照，保留全部数据', async t => {
  const attempts = [];
  const post = await endpoint(t, {
    compose: async (bundle, options) => {
      attempts.push(options.statistical);
      const composed = await composeReport(bundle, { statistical: true });
      if (!options.statistical) {
        composed.narrative.mode = 'ai';
        composed.narrative.questionSection.failureCode = 'format';
        // 模型规划会原地更改专题；统计兜底必须重新使用原始快照。
        bundle.question.rows = [];
        bundle.question.charts = [];
      }
      return composed;
    },
    renderPdf: async (snapshot, narrative) => {
      assert.equal(snapshot.statistics.total, 18);
      assert.ok(snapshot.questionSection.charts.length > 0);
      assert.equal(narrative.mode, 'rules');
      assert.equal(narrative.questionSection.mode, 'rules');
      return pdf;
    },
  });
  const { events } = await post(input);
  assert.deepEqual(attempts, [false, true]);
  assert.ok(!events.some(event => event.type === 'error'));
  assert.equal(events.at(-1).result.mode, 'rules');
});

test('AI 排版失败后只重试一次统计排版，不重复请求模型', async t => {
  const modes = [], renders = [];
  const post = await endpoint(t, {
    compose: async (bundle, options) => {
      modes.push(options.statistical);
      const result = await composeReport(bundle, { statistical: true });
      if (!options.statistical) {
        result.narrative.mode = 'ai';
        result.narrative.questionSection.mode = 'ai';
      }
      return result;
    },
    renderPdf: async (_snapshot, narrative) => {
      renders.push(narrative.mode);
      if (narrative.mode === 'ai') throw new Error('layout failure');
      return pdf;
    },
  });
  const { events } = await post(input);
  assert.deepEqual(modes, [false, true]);
  assert.deepEqual(renders, ['ai', 'rules']);
  assert.equal(events.at(-1).result.mode, 'rules');
});

test('AI 正常完成时保留 AI 报告及实际模型，不触发统计替换', async t => {
  let attempts = 0;
  const post = await endpoint(t, {
    compose: async (bundle, options) => {
      attempts++;
      const result = await composeReport(bundle, { statistical: true });
      result.narrative.mode = result.narrative.questionSection.mode = 'ai';
      result.narrative.model = 'qwen3.8-flash';
      return result;
    }, renderPdf: async () => pdf,
  });
  const { events } = await post(input);
  assert.equal(attempts, 1);
  assert.equal(events.at(-1).result.mode, 'ai');
  assert.equal(events.at(-1).result.model, 'qwen3.8-flash');
});

test('模型超时后终止 AI 等待并生成统计报告', async t => {
  const modes = [];
  const post = await endpoint(t, {
    aiTimeoutMs: 20,
    compose: async (bundle, options) => {
      modes.push(options.statistical);
      if (options.statistical) return composeReport(bundle, options);
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }, renderPdf: async () => pdf,
  });
  const { events } = await post(input);
  assert.deepEqual(modes, [false, true]);
  assert.equal(events.at(-1).result.mode, 'rules');
});

test('统计 PDF 也失败时停止重试，仍保留明确错误', async t => {
  let attempts = 0;
  const post = await endpoint(t, {
    compose: (bundle, options) => composeReport(bundle, { ...options, statistical: true }),
    renderPdf: async () => { attempts++; throw new Error('font unavailable'); },
  });
  const { events } = await post({ ...input, allowStatistical: true });
  assert.equal(attempts, 1);
  assert.equal(events.at(-1).type, 'error');
});

test('断开生成连接后停止 AI，不在后台额外生成统计 PDF', async t => {
  let composeStarted, aborted;
  const started = new Promise(resolve => composeStarted = resolve);
  const stopped = new Promise(resolve => aborted = resolve);
  const calls = [];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { username: 'report_test' }; next(); });
  app.use('/report', reportRouter({ compose: async (_bundle, options) => {
    calls.push(options.statistical); composeStarted();
    await new Promise((_, reject) => options.signal.addEventListener('abort', () => { aborted(); reject(options.signal.reason); }, { once: true }));
  }, renderPdf: async () => { calls.push('render'); return pdf; } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/report`, {
    method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const body = response.text().catch(() => {});
  await started; controller.abort(); await stopped; await body;
  assert.deepEqual(calls, [false]);
});

test('传输中断时前端自动请求统计报告，并正确读取末尾无换行结果', async t => {
  const original = globalThis.fetch, attempts = [];
  globalThis.fetch = async (_url, init) => {
    attempts.push(JSON.parse(init.body).allowStatistical === true);
    if (attempts.length === 1) throw new TypeError('connection interrupted');
    return new Response(JSON.stringify({ type: 'result', result: {
      mode: 'rules', pdf: pdf.bytes.toString('base64'), pages: 6,
    } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  };
  t.after(() => globalThis.fetch = original);
  const result = await requestReport(input, () => {}, new AbortController().signal);
  assert.deepEqual(attempts, [false, true]);
  assert.equal(result.mode, 'rules');
  assert.equal(new TextDecoder().decode(result.bytes).slice(0, 5), '%PDF-');
});

test('用户取消或登录失效时不自动启动统计生成', async t => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (_url, init) => { attempts++; throw init.signal.reason; };
  t.after(() => globalThis.fetch = original);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestReport(input, () => {}, controller.signal), { name: 'AbortError' });
  assert.equal(attempts, 1);
  globalThis.fetch = async () => { attempts++; return new Response('{"error":"登录已过期"}', { status: 401 }); };
  // Node 中没有 window，替身只接收认证失效事件。
  const originalWindow = globalThis.window;
  globalThis.window = { dispatchEvent() {} };
  t.after(() => originalWindow === undefined ? delete globalThis.window : globalThis.window = originalWindow);
  await assert.rejects(requestReport(input, () => {}, new AbortController().signal), /登录已过期/);
  assert.equal(attempts, 2);
});
