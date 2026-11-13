import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReportBundle } from '../server/report/snapshot.mjs';
import { generateNarrative } from '../server/report/narrative.mjs';
import { reportKeyFor, serializeReport, restoreReport } from '../src/reportState.mjs';
import { validateStoredReport } from '../server/report/storage.mjs';
import { questionBatches } from '../server/report/questions.mjs';
import { fallbackNarrative } from '../server/report/narrative.mjs';
import { renderReportPdf } from '../server/report/pdf.mjs';

const dataset = {
  title: '分馆运营',
  dimensions: [{ key: '日期', type: 'date' }, { key: '分馆', type: 'text' }],
  metrics: [{ key: '入馆人数', unit: '人' }],
  rows: [
    { name: '甲', 日期: '2026-01-01', 分馆: '东馆', 入馆人数: 10 },
    { name: '乙', 日期: '2026-02-01', 分馆: '东馆', 入馆人数: 20 },
    { name: '丙', 日期: '2026-01-01', 分馆: '西馆', 入馆人数: 100 },
  ],
};
const view = { groupBy: '日期', granularity: 'month', aggregation: 'sum', filters: [{ field: '分馆', op: 'eq', value: '西馆' }] };

test('report snapshot and cache identity retain user concerns older than the last twelve messages', () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ role: 'user', text: `用户关注点${i}，${'说明'.repeat(700)}` }));
  const { question } = prepareReportBundle({ dataset, view, history });
  assert.equal(question.questions.length, 30);
  assert.equal(question.questions[0], history[0].text);
  const workspace = { dataset, view, messages: history, questionHistory: history.map(m => m.text) };
  const changed = [...workspace.questionHistory];
  changed[0] = '更早的另一个真实关注点';
  assert.notEqual(reportKeyFor(workspace), reportKeyFor({ ...workspace, questionHistory: changed }));
});

function localModel(t, respond) {
  const original = process.env.AI_API_KEY;
  process.env.AI_API_KEY = 'local-test-only';
  t.after(() => original === undefined ? delete process.env.AI_API_KEY : process.env.AI_API_KEY = original);
  const requests = [];
  return {
    requests,
    client: { model: 'qwen3.8-flash', modelsUsed: ['qwen3.8-flash'], async fetch(_url, init) {
      const body = JSON.parse(init.body);
      requests.push(body);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(respond(body, requests.length)) } }] }), { headers: { 'Content-Type': 'application/json' } });
    } },
  };
}
const query = (branch, chart = 'bar') => ({ metricKey: '入馆人数', groupBy: '日期', granularity: 'month', aggregation: 'sum', filters: [{ field: '分馆', op: 'eq', value: branch }], chart });
function draft(body) {
  const material = JSON.parse(body.messages[1].content);
  return {
    summary: '关注两个分馆的表现，并分别核对证据。', answer: '东馆的变化与西馆的记录分别呈现，当前刷选没有覆盖此前问题的全部范围。',
    findings: [{ headline: '分别核对关注范围', explanation: '各图使用对应关注点的原始记录，避免混用口径。', chartIds: material.validatedPlan.chartIds }],
    chapters: material.validatedPlan.chartIds.map(id => ({ title: '分馆表现与分析边界', analysis: '该图依据对应分馆的记录核算，描述性差异还需结合经营背景核查。', chartId: id })),
    nextSteps: ['继续核对分馆的业务背景。'], limitations: ['现有数据不能证明差异的原因。'],
  };
}

test('AI synthesizes every user concern and computes each requested scope independently of current brush filters', async t => {
  const history = [
    { role: 'user', text: '已导入分馆运营表，共三行记录。' },
    { role: 'user', text: '东馆逐月入馆人数怎样变化？' },
    ...Array.from({ length: 14 }, () => ({ role: 'assistant', text: '旧回答包含未经核对的99999人。' })),
    { role: 'user', text: '也看看西馆的情况，并综合前面的问题。' },
  ];
  const bundle = prepareReportBundle({ dataset, view, history });
  const mock = localModel(t, (body, count) => count === 1 ? {
    focus: '归纳东馆变化与西馆表现，分别使用原始记录核对。',
    topics: [
      { label: '东馆逐月变化', messageIds: ['u2'], queries: [{ ...query('东馆', 'line'), filters: [...query('东馆').filters, { field: '日期', op: 'gte', value: '2026-01-01' }] }] },
      { label: '西馆表现', messageIds: ['u3'], queries: [query('西馆')] },
    ], ignoredMessageIds: ['u1'],
  } : body.messages[0].content.includes('分析规划')
    ? { focus: '综合分馆变化与差异，并说明证据边界。', chartIds: JSON.parse(body.messages[1].content).charts.map(c => c.id).slice(0, 2) }
    : draft(body));
  const result = await generateNarrative(bundle.question, undefined, undefined, 0, undefined, null, null, mock.client);
  assert.equal(result.mode, 'ai');
  assert.equal(mock.requests.length, 3);
  const intentMaterial = JSON.parse(mock.requests[0].messages[1].content);
  assert.ok(Array.isArray(intentMaterial.messages), 'first AI stage must synthesize all user messages before choosing charts');
  assert.deepEqual(intentMaterial.messages.map(m => m.text), [history[0].text, history[1].text, history.at(-1).text]);
  assert.ok(mock.requests.every(r => !r.messages[1].content.includes('99999')));
  assert.equal(bundle.overall.statistics.total, 130);
  const east = bundle.question.charts.find(c => c.view.filters.some(f => f.value === '东馆'));
  const west = bundle.question.charts.find(c => c.view.filters.some(f => f.value === '西馆'));
  assert.deepEqual(east.rows.map(r => r.value), [10, 20]);
  assert.equal(east.statistics.total, 30);
  assert.match(east.scope, /2026年1月1日/);
  assert.ok(!/\b(?:eq|gte|sum|month)\b/.test(east.scope));
  assert.equal(west.statistics.total, 100);
  assert.ok(result.chapters.every(c => c.evidence.every(id => id.startsWith(c.chartId + '_'))));
  assert.equal(result.questionCoverage.processedMessages, 3);
  assert.deepEqual(result.models, ['qwen3.8-flash']);
  assert.ok(!bundle.question.questions.includes(history[0].text));
});

test('saved reports preserve more than six complete user questions and coverage metadata', () => {
  const questions = Array.from({ length: 20 }, (_, i) => `关注点${i}${'说明'.repeat(700)}`);
  const narrative = { mode: 'ai', notice: 'AI解读', summary: '分析摘要', answer: '直接答复', findings: [], chapters: [], nextSteps: [], limitations: [], model: 'qwen3.8-flash', models: ['qwen3.8-flash'], questionCoverage: { totalMessages: 20, processedMessages: 20, totalCharacters: questions.join('').length, processedCharacters: questions.join('').length, truncated: false, note: '已归纳全部用户消息。' } };
  const metadata = { bytes: new TextEncoder().encode('%PDF-1.4\n%%EOF'), title: dataset.title, metric: '入馆人数', mode: 'ai', notice: 'AI解读', createdAt: '2026-11-13T00:00:00.000Z', fileName: '报告.pdf', pages: 8, chartCount: 2, model: 'qwen3.8-flash', models: ['qwen3.8-flash'], questions, narrative: { ...narrative, questionSection: narrative } };
  const restored = restoreReport(validateStoredReport(serializeReport('abcdef0123456789', metadata)));
  assert.deepEqual(restored.result.questions, questions);
  assert.deepEqual(restored.result.narrative.questionSection.questionCoverage, narrative.questionCoverage);
});

test('histories beyond the report budget are rejected explicitly without sampling out middle concerns', () => {
  const questions = Array.from({ length: 40 }, (_, i) => `关注点${i}：${'说明'.repeat(5990)}`);
  assert.throws(() => questionBatches(questions), error => error.code === 'history_too_long' && /拆分/.test(error.message));
  const supported = Array.from({ length: 200 }, (_, i) => `关注点${i}：${'说明'.repeat(150)}`);
  const { batches, coverage } = questionBatches(supported);
  assert.equal(coverage.truncated, false);
  assert.equal(coverage.processedMessages, 200);
  assert.deepEqual(batches.flat().map(message => message.text), supported);
  assert.equal(coverage.processedCharacters, batches.flat().reduce((sum, message) => sum + message.text.length, 0));
});

test('AI-classified import-only input does not manufacture a question section', async t => {
  const { question } = prepareReportBundle({ dataset, history: [{ role: 'user', text: '已导入分馆运营表。' }] });
  const mock = localModel(t, () => ({ focus: '仅包含导入回显，没有分析关注点。', topics: [], ignoredMessageIds: ['u1'] }));
  const result = await generateNarrative(question, undefined, undefined, 0, undefined, null, null, mock.client);
  assert.equal(result.omitQuestionSection, true);
  assert.equal(mock.requests.length, 1);
  assert.deepEqual(question.questions, []);
});

test('a fabricated percentage in the outline is replanned before drafting instead of surviving every revision', async t => {
  const snapshot = prepareReportBundle({dataset}).overall;
  const mock = localModel(t, (body, count) => body.messages[0].content.includes('分析规划')
    ? {focus:count === 1 ? '西馆占比为99991%，应核查差异。' : '核对分馆差异、时间变化及证据边界。', chartIds:JSON.parse(body.messages[1].content).charts.map(chart=>chart.id).slice(0,3)}
    : draft(body));
  const failures=[];
  const result = await generateNarrative(snapshot,undefined,failure=>failures.push(failure),0,undefined,null,null,mock.client);
  assert.equal(result.mode,'ai');
  assert.equal(mock.requests.length,3,'invalid outline must be replaced before the single writing request');
  assert.equal(failures[0].violation,'plan-unsupported-numbers');
  assert.ok(mock.requests[1].messages[0].content.includes('分析规划'));
  assert.equal(JSON.parse(mock.requests[2].messages[1].content).validatedPlan.focus,'核对分馆差异、时间变化及证据边界。');
});

test('unclassified earlier messages and invented query categories fail evidence validation', async t => {
  for (const [topic, expected] of [
    [{ label: '西馆表现', messageIds: ['u2'], queries: [query('西馆')] }, 'unclassified-user-message'],
    [{ label: '分馆比较', messageIds: ['u1', 'u2'], queries: [query('不存在的馆')] }, 'unknown-question-filter-value'],
    [{ label: '分馆比较', messageIds: ['u1', 'u2'], queries: [{ ...query('东馆'), groupBy: '分馆', granularity: 'month' }] }, 'invalid-question-view'],
  ]) {
    const { question } = prepareReportBundle({ dataset, history: [{ role: 'user', text: '东馆变化？' }, { role: 'user', text: '西馆变化？' }] });
    const failures = [];
    const mock = localModel(t, () => ({ focus: '综合分馆表现', topics: [topic], ignoredMessageIds: [] }));
    const result = await generateNarrative(question, undefined, failure => failures.push(failure), 0, undefined, null, null, mock.client);
    assert.equal(result.mode, 'rules');
    assert.equal(result.failureCode, 'evidence');
    assert.equal(failures.at(-1).violation, expected);
  }
});

test('numbers verified for a different concern cannot be reused as a chapter statistic', async t => {
  const { question } = prepareReportBundle({ dataset, view, history: [{ role: 'user', text: '比较东馆和西馆。' }] });
  const mock = localModel(t, (body, count) => count === 1
    ? { focus: '比较两个分馆的记录', topics: [{ label: '分馆比较', messageIds: ['u1'], queries: [query('东馆', 'line'), query('西馆')] }], ignoredMessageIds: [] }
    : body.messages[0].content.includes('分析规划') ? { focus: '分别观察分馆表现', chartIds: ['c1', 'c2'] }
      : { ...draft(body), chapters: draft(body).chapters.map((chapter, i) => i ? chapter : { ...chapter, analysis: '东馆合计为100人。' }) });
  const failures = [];
  const result = await generateNarrative(question, undefined, failure => failures.push(failure), 0, undefined, null, null, mock.client);
  assert.equal(result.mode, 'rules');
  assert.equal(result.failureCode, 'evidence');
  assert.equal(failures.at(-1).violation, 'question-chart-scope');
});

test('writing selected question charts keeps topic scope and evidence aligned after sparse chart IDs are renumbered', async t => {
  const { question } = prepareReportBundle({ dataset, view, history: [{ role: 'user', text: '分别看看东馆、各馆对比和西馆。' }] });
  const mock = localModel(t, (body, count) => count === 1
    ? { focus: '分别核对分馆与时间范围', topics: [
      { label: '东馆变化', messageIds: ['u1'], queries: [query('东馆', 'line')] },
      { label: '全部分馆', messageIds: ['u1'], queries: [{ ...query('东馆'), filters: [], groupBy: '分馆', granularity: 'none' }] },
      { label: '西馆表现', messageIds: ['u1'], queries: [query('西馆')] },
    ], ignoredMessageIds: [] }
    : body.messages[0].content.includes('分析规划') ? { focus: '比较全部分馆并独立观察西馆', chartIds: ['c2', 'c3'] } : draft(body));
  const result = await generateNarrative(question, undefined, undefined, 0, undefined, null, null, mock.client);
  assert.equal(result.mode, 'ai');
  const writing = JSON.parse(mock.requests.at(-1).messages[1].content);
  assert.deepEqual(writing.questionIntents.topics.map(topic => topic.chartIds), [[], ['c1'], ['c2']]);
  assert.equal(writing.facts.c1_total.value, 130);
  assert.equal(writing.facts.c2_total.value, 100);
  assert.ok(!Object.keys(writing.facts).some(key => key.startsWith('c3_')));
  assert.deepEqual(result.chapters.map(chapter => chapter.chartId), ['c2', 'c3']);
  assert.ok(result.chapters.every(chapter => chapter.evidence.every(id => id.startsWith(chapter.chartId + '_'))));
});

test('real concerns without a supported query produce an AI boundary response without invented charts', async t => {
  const { question } = prepareReportBundle({ dataset, history: [{ role: 'user', text: '明年是否一定增长？' }] });
  const mock = localModel(t, (body, count) => count === 1
    ? { focus: '未来变化的证据边界', topics: [{ label: '未来增长', messageIds: ['u1'], queries: [], limitation: '当前记录不能支持未来增长的确定性判断。' }], ignoredMessageIds: [] }
    : body.messages[0].content.includes('分析规划') ? { focus: '说明未来变化的证据边界', chartIds: [] } : draft(body));
  const result = await generateNarrative(question, undefined, undefined, 0, undefined, null, null, mock.client);
  assert.equal(result.mode, 'ai');
  assert.deepEqual(result.chapters, []);
  assert.equal(result.omitQuestionSection, undefined);
  assert.equal(question.questionIntents.topics[0].status, 'unresolved');
});

async function pdfText(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true, isEvalSupported: false });
  const pdf = await loading.promise;
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index++) pages.push((await (await pdf.getPage(index)).getTextContent()).items.map(item => item.str).join(''));
  await loading.destroy();
  return pages;
}

test('question PDF renders synthesized focus, coverage and each chart scope without quoting only the last command', async () => {
  const bundle = prepareReportBundle({ dataset, view, history: [{ role: 'user', text: '最后一条原始命令' }] });
  const focus = bundle.question;
  focus.charts = [{ ...focus.charts[0], scope: '独立专题范围：东馆和西馆分别核算。' }];
  const main = fallbackNarrative(bundle.overall), section = { ...fallbackNarrative(focus), focus: '综合分馆变化与差异', answer: '按所有关注点综合分析。', questionCoverage: { note: '历史中间部分未覆盖。' } };
  const result = await renderReportPdf({ ...bundle.overall, questionSection: focus }, { ...main, questionSection: section });
  const pages = await pdfText(result.bytes), page = pages.find(text => text.includes('用户问题专题 ·'));
  assert.ok(page.includes('综合分馆变化与差异'));
  assert.ok(page.includes('东馆和西馆分别核算'));
  assert.ok(page.includes('历史中间部分未覆盖'));
  assert.ok(!page.includes('最后一条原始命令'));
});

test('unresolved real concerns still receive one bounded PDF response page without inventing a chart', async () => {
  const bundle = prepareReportBundle({ dataset, history: [{ role: 'user', text: '明年是否一定增长？' }] });
  const main = fallbackNarrative(bundle.overall), focus = { ...bundle.question, charts: [], facts: {} };
  const section = { ...fallbackNarrative(focus), focus: '未来变化的证据边界', answer: '当前记录不能支持未来增长的确定性判断。' };
  const base = await renderReportPdf(bundle.overall, main);
  const combined = await renderReportPdf({ ...bundle.overall, questionSection: focus }, { ...main, questionSection: section });
  assert.equal(combined.pages - base.pages, 1);
  assert.ok((await pdfText(combined.bytes)).some(page => page.includes(section.answer)));
});

test('maximal narrative and scope text keep the question section within two pages', async () => {
  const bundle = prepareReportBundle({ dataset, view, history: [{ role: 'user', text: '所有关注点都请分析。' }] });
  const focus = bundle.question, main = fallbackNarrative(bundle.overall);
  focus.charts = [focus.charts[0], { ...focus.charts[0], id: 'c99' }].map(chart => ({ ...chart, scope: '专题独立范围。'.repeat(200) }));
  const section = { ...fallbackNarrative(focus), focus: '所有关注点。'.repeat(50), answer: '综合回应全部关注点。'.repeat(28), questionCoverage: { note: '全部用户输入均已归纳。'.repeat(120) }, limitations: ['现有数据无法证明因果。'.repeat(25), '缺少未来的实际记录。'.repeat(25)], chapters: focus.charts.map(chart => ({ title: '不同对象与时间范围的分析'.repeat(5), analysis: '核对不同对象与日期的证据边界。'.repeat(23), chartId: chart.id, evidence: [] })) };
  const base = await renderReportPdf(bundle.overall, main);
  const combined = await renderReportPdf({ ...bundle.overall, questionSection: focus }, { ...main, questionSection: section });
  assert.equal(combined.pages - base.pages, 2);
});
