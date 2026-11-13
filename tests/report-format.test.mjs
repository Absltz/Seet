import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReport, prepareReportBundle } from '../server/report/snapshot.mjs';
import { generateNarrative } from '../server/report/narrative.mjs';

test('模型将完整 JSON 包在代码块中时仍能读取，不放宽证据校验', async t => {
  const previous = process.env.AI_API_KEY;
  process.env.AI_API_KEY = 'local-test-only';
  t.after(() => previous === undefined ? delete process.env.AI_API_KEY : process.env.AI_API_KEY = previous);
  const snapshot = prepareReport({ dataset: {
    title: '仓库周转记录', metrics: [{ key: '出库量', unit: '件' }],
    rows: [{ name: '东库', 出库量: 14 }, { name: '西库', 出库量: 22 }, { name: '南库', 出库量: 9 }],
  } });
  let fabricated = false;
  const client = { model: 'qwen3.8-flash', modelsUsed: ['qwen3.8-flash'], async fetch(_url, init) {
    const material = JSON.parse(JSON.parse(init.body).messages[1].content);
    const ids = material.validatedPlan?.chartIds || material.charts.slice(0, 3).map(chart => chart.id);
    const output = material.validatedPlan ? {
      summary: fabricated ? '出库总量为999999件。' : '仓库之间存在出库量差异，需要结合业务安排核查。',
      answer: '各仓库记录均已纳入统计，数值来自对应原始记录。',
      findings: [{ headline: '核查仓库差异', explanation: '比较各库的出库表现，并保留核对业务背景的空间。', chartIds: ids }],
      chapters: ids.map(chartId => ({ title: '仓库出库表现', analysis: '图表展示各仓库对应的出库记录，当前证据仅用于描述差异。', chartId })),
      nextSteps: ['核对各仓库的业务安排。'], limitations: ['现有记录无法解释出库差异的原因。'],
    } : { focus: '比较仓库出库表现与数据质量。', chartIds: ids };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '```json\n' + JSON.stringify(output) + '\n```' } }] }), { headers: { 'Content-Type': 'application/json' } });
  } };
  assert.equal((await generateNarrative(snapshot, undefined, undefined, 0, undefined, null, null, client)).mode, 'ai');
  fabricated = true;
  const rejected = await generateNarrative(snapshot, undefined, undefined, 0, undefined, null, null, client);
  assert.equal(rejected.mode, 'rules');
  assert.equal(rejected.failureCode, 'evidence');
});

test('专题查询格式错误会把具体字段反馈给下一次归纳，避免重复相同的无效图形', async t => {
  const previous = process.env.AI_API_KEY;
  process.env.AI_API_KEY = 'local-test-only';
  t.after(() => previous === undefined ? delete process.env.AI_API_KEY : process.env.AI_API_KEY = previous);
  const { question } = prepareReportBundle({ dataset: {
    title: '仓库周转记录', dimensions: [{ key: '仓库', type: 'text' }], metrics: [{ key: '出库量', unit: '件' }],
    rows: [{ name: '东库', 仓库: '东库', 出库量: 14 }, { name: '西库', 仓库: '西库', 出库量: 22 }],
  }, history: [{ role: 'user', text: '比较各库出库量' }] });
  const intents = [];
  const client = { model: 'qwen3.8-flash', modelsUsed: ['qwen3.8-flash'], async fetch(_url, init) {
    const material = JSON.parse(JSON.parse(init.body).messages[1].content);
    let output;
    if (material.messages) {
      intents.push(material);
      output = { focus: '比较各仓库出库记录。', topics: [{ label: '各库出库比较', messageIds: ['u1'], queries: [{
        metricKey: '出库量', groupBy: '仓库', granularity: 'none', aggregation: 'sum', filters: [],
        chart: material.revision ? 'bar' : 'table',
      }] }], ignoredMessageIds: [] };
    } else if (!material.validatedPlan) {
      output = { focus: '比较各仓库已核对的出库记录。', chartIds: material.charts.map(chart => chart.id).slice(0, 2) };
    } else output = {
      summary: '各仓库出库量存在差异。', answer: '已分别核对各仓库的原始出库记录。',
      findings: [{ headline: '比较仓库差异', explanation: '现有记录只说明差异，仍需核查业务安排。', chartIds: material.validatedPlan.chartIds }],
      chapters: material.validatedPlan.chartIds.map(chartId => ({ title: '仓库出库比较', analysis: '核对原始记录与汇总方式后，再结合业务安排分析差异。', chartId })),
      nextSteps: ['核查仓库业务安排。'], limitations: ['当前记录不能证明差异原因。'],
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }), { headers: { 'Content-Type': 'application/json' } });
  } };
  const result = await generateNarrative(question, undefined, undefined, 0, undefined, null, null, client);
  assert.equal(result.mode, 'ai');
  assert.equal(intents.length, 2);
  assert.equal(intents[1].revision.issues[0].field, 'topics.0.queries.0.chart');
});
