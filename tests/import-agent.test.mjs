import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';

const serviceUrl = new URL('../server/importAgent.mjs', import.meta.url);
const run = async (...args) => {
  assert.ok(existsSync(serviceUrl), 'AI import service must exist');
  return (await import(serviceUrl)).runImportAgent(...args);
};
const call = (name, args) => ({ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const mapping = { columns: [{ index: 0, role: 'dimension' }, { index: 1, role: 'dimension' }, { index: 2, role: 'metric', unit: '分' }], labelColumn: 1 };
const view = { groupBy: '', granularity: 'none', aggregation: 'average', metric: '成绩', chart: 'bar', sort: 'original', filters: [] };
const finish = call('complete_import', { answer: '已保留学号，按学生展示成绩。' });
const table = { title: '测验', source: 'upload.csv', headers: ['学号', '姓名', '成绩'], rows: [['001', '甲', '80分'], ['002', '乙', '缺考'], ['003', '末行证据', 90]] };

async function model(t, replies) {
  const keys = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_PROVIDER', 'AI_FALLBACK_MODELS'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw); requests.push(body);
    const next = typeof replies === 'function' ? replies(body, requests.length - 1) : replies[requests.length - 1];
    if (next?.httpStatus) { res.writeHead(next.httpStatus, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'local-import-test-secret provider debug body' } })); return; }
    const message = next?.function ? { content: null, tool_calls: [next] } : { content: next || '已完成。' };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'import-test', object: 'chat.completion', created: 1, model: 'qwen-test', choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', ...message } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { AI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, AI_API_KEY: 'local-import-test-secret', AI_MODEL: 'qwen-test', AI_PROVIDER: 'qwen', AI_FALLBACK_MODELS:'' });
  t.after(() => { server.close(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  return requests;
}

test('complete raw table reaches the real SDK provider before classification; IDs remain dimensions', async t => {
  const requests = await model(t, [call('interpret_table', mapping), call('configure_view', view), finish]);
  const events = [];
  const full = { ...table, rows: Array.from({ length: 1200 }, (_, i) => [String(i + 1).padStart(5, '0'), i === 1199 ? '末行证据' : `人${i}`, i % 100]) };
  const result = await run({ table: full, text: '展示成绩，保留全部原始记录' }, event => events.push(event));
  const initial = JSON.parse(requests[0].messages.find(m => m.role === 'user').content);
  assert.deepEqual(initial.table, full);
  assert.match(requests[0].messages.find(m => m.role === 'user').content, /末行证据/);
  assert.equal(result.dataset.rows.length, 1200);
  assert.equal(result.dataset.rows[0].学号, '00001');
  assert.equal(result.dataset.rows.at(-1).姓名, '末行证据');
  assert.deepEqual(result.dataset.metrics, [{ key: '成绩', unit: '分' }]);
  assert.equal(result.dataset.dimensions[0].key, '学号');
  assert.deepEqual(result.dataset.sourceColumns,[{index:0,header:'学号',key:'学号'},{index:1,header:'姓名',key:'姓名'},{index:2,header:'成绩',key:'成绩'}]);
  assert.equal(result.metricKey, '成绩');
  assert.equal(result.dataset.source, full.source);
  assert.ok(requests.every(r => r.tool_choice === 'required'));
  const observation = requests[2].messages.filter(m => m.role === 'tool').at(-1);
  assert.equal(JSON.parse(observation.content).statistics.total, 59400);
  assert.deepEqual(result.trace.map(e => e.status), ['success', 'success', 'success']);
  assert.ok(events.some(e => e.type === 'status'));
  assert.equal(events.filter(e => e.type === 'tool-start').length, 3);
  assert.ok(events.filter(e => e.type === 'tool-start').every(e => e.entry.status === 'running'));
});

test('unit-aware values and explicit missing markers are computed without rewritten rows', async t => {
  await model(t, [call('interpret_table', mapping), call('configure_view', view), finish]);
  const result = await run({ table });
  assert.deepEqual(result.dataset.rows.map(r => r.成绩), [80, null, 90]);
  assert.deepEqual(result.dataset.rows.map(r => r.学号), ['001', '002', '003']);
});

for (const [label, replies] of [
  ['text-only success', ['已导入并完成图表']],
  ['premature completion', [finish]],
  ['interpretation without view', [call('interpret_table', mapping), finish]],
  ['view without final completion', [call('interpret_table', mapping), call('configure_view', view)]],
]) test(`rejects ${label}`, async t => {
  await model(t, replies);
  await assert.rejects(() => run({ table }), /未完成|未提交|工具/);
});

test('invalid roles and identifier metrics fail tools, and a corrected classification can recover', async t => {
  const invalid = { ...mapping, columns: [{ index: 0, role: 'metric', unit: '' }, ...mapping.columns.slice(1)] };
  const duplicate = { ...mapping, columns: [mapping.columns[0], mapping.columns[0], mapping.columns[2]] };
  const requests = await model(t, [call('interpret_table', invalid), call('interpret_table', duplicate), call('interpret_table', mapping), call('configure_view', view), finish]);
  const result = await run({ table });
  assert.deepEqual(result.trace.map(e => e.status), ['error', 'error', 'success', 'success', 'success']);
  assert.match(requests[1].messages.find(m => m.role === 'tool').content, /标识|编号|学号/);
  assert.equal(result.dataset.metrics.length, 1);
});

test('actual invalid numeric cells are rejected rather than converted to missing', async t => {
  await model(t, [call('interpret_table', mapping), call('configure_view', view), finish]);
  const events = [];
  await assert.rejects(() => run({ table: { ...table, rows: [['001', '甲', '80oops']] } }, e => events.push(e)), /未完成|工具/);
  assert.ok(events.some(e => e.entry?.status === 'error' && /数字|数值/.test(e.entry.summary)));
});

test('oversized complete table is rejected before making any provider request', async t => {
  const requests = await model(t, []);
  const huge = { ...table, rows: Array.from({ length: 700 }, () => ['001', 'x'.repeat(1900), '80']) };
  await assert.rejects(() => run({ table: huge }), /1200000|完整.*上限|拆分/);
  assert.equal(requests.length, 0);
});

test('provider failures expose no API key or provider response body', async t => {
  const requests = await model(t, []);
  process.env.AI_BASE_URL = 'http://127.0.0.1:1/v1';
  await assert.rejects(() => run({ table }), error => !String(error).includes('local-import-test-secret') && /失败|连接|服务/.test(error.message));
  assert.equal(requests.length, 0);
});

test('tool failures carry a safe actionable public error for the HTTP route', async t => {
  await model(t, [call('interpret_table', mapping), finish]);
  await assert.rejects(() => run({ table: { ...table, rows: [['001', '甲', 'bad-number']] } }), error => error.status === 400 && /不是有效数字/.test(error.publicMessage));
});

test('all roles, percentages, scaled header units and reserved label keys retain stable fields', async t => {
  const raw = { title: '营业记录', source: 'finance.csv', headers: ['name', '日期', '金额（万元）', '转化率（%）'], rows: [['0001', '2026/1/2', '1万元', '12.5%'], ['0002', '2026-01-03', '20000元', 'absent']] };
  const roles = { columns: [{ index: 0, role: 'dimension' }, { index: 1, role: 'date' }, { index: 2, role: 'metric', unit: '万元' }, { index: 3, role: 'metric', unit: '%' }], labelColumn: 0 };
  await model(t, [call('interpret_table', roles), call('configure_view', { ...view, groupBy: '日期', granularity: 'month', aggregation: 'sum', metric: '金额（万元）', chart: 'line' }), finish]);
  const result = await run({ table: raw });
  assert.equal(result.dataset.dimensions[0].key, 'name_1');
  assert.deepEqual(result.dataset.rows.map(r => r.name_1), ['0001', '0002']);
  assert.deepEqual(result.dataset.rows.map(r => r['金额（万元）']), [1, 2]);
  assert.deepEqual(result.dataset.rows.map(r => r['转化率（%）']), [12.5, null]);
  assert.equal(result.dataset.dimensions[1].type, 'date');
  assert.equal(result.dataset.rows[0].日期, '2026-01-02');
});

test('dimension names retain their supported 60-character limit', async t => {
  const header = 'a'.repeat(45);
  await model(t, [call('interpret_table', { columns: [{ index: 0, role: 'dimension' }, { index: 1, role: 'metric', unit: '' }], labelColumn: 0 }), call('configure_view', { ...view, metric: '数值' }), finish]);
  const result = await run({ table: { title: '长字段', source: 'test', headers: [header, '数值'], rows: [['原文', 1]] } });
  assert.equal(result.dataset.dimensions[0].key, header);
});

test('provider rate limits preserve status without leaking provider debug bodies', async t => {
  await model(t, [{ httpStatus: 429 }]);
  await assert.rejects(() => run({ table }), error => error.statusCode === 429 && !JSON.stringify(error).includes('local-import-test-secret') && !String(error).includes('provider debug body'));
});

test('模型权限拒绝保留403，不能伪装成导入网络故障',async t=>{
 await model(t,[{httpStatus:403}]);
 await assert.rejects(()=>run({table}),error=>error.statusCode===403&&!JSON.stringify(error).includes('local-import-test-secret'));
});

test('原表导入首选被拒绝时依序回退，仍须执行字段解释与绘图工具',async t=>{
 const requests=await model(t,[{httpStatus:403},{httpStatus:503},call('interpret_table',mapping),call('configure_view',view),finish]);
 process.env.AI_MODEL='qwen3.8-flash';process.env.AI_FALLBACK_MODELS='qwen3.7-flash,qwen3.8-max';
 const events=[],result=await run({table},e=>events.push(e));
 assert.deepEqual(requests.map(r=>r.model),['qwen3.8-flash','qwen3.7-flash','qwen3.8-max','qwen3.8-max','qwen3.8-max']);
 assert.equal(result.model,'qwen3.8-max');assert.equal(result.dataset.rows.length,3);
 assert.deepEqual(result.trace.map(t=>[t.tool,t.status]),[['interpret_table','success'],['configure_view','success'],['complete_import','success']]);
 assert.equal(events.filter(e=>e.type==='model').length,3);
});

test('日期字段保留原始时分秒，按日分组只改变视图而不截去记录时间', async t => {
  const raw={title:'时段记录',headers:['时间','数值'],rows:[['2026-01-02T10:15:30.000Z',2],['2026/1/2 18:20:00',3]]};
  await model(t,[call('interpret_table',{columns:[{index:0,role:'date'},{index:1,role:'metric',unit:''}],labelColumn:0}),call('configure_view',{...view,groupBy:'时间',granularity:'day',aggregation:'sum',metric:'数值'}),finish]);
  const result=await run({table:raw});
  assert.deepEqual(result.dataset.rows.map(row=>row.时间),['2026-01-02T10:15:30.000Z','2026-01-02T18:20:00']);
});
