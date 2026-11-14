import test from 'node:test';
import assert from 'node:assert/strict';
import {reportProgress as progress} from '../src/components/reportProgress.mjs';

test('报告加载仅确认服务端已进入下一阶段的步骤，不按时间补齐', () => {
  const starting = progress({stage: 0, text: '正在核对数据与统计口径'});
  assert.equal(starting.completed, 0);
  assert.deepEqual(starting.steps.map(step => step.status), ['current', 'pending', 'pending']);
  const writing = progress({stage: 1, text: '千问 正在撰写分析解读', model: 'qwen3.8-flash'});
  assert.equal(writing.completed, 1);
  assert.equal(writing.modeLabel, 'qwen3.8-flash');
  assert.equal(writing.statistical, false);
  const pdf = progress({stage: 2, text: 'AI 解读已完成，正在排版 PDF', model: 'qwen3.8-max'});
  assert.equal(pdf.completed, 2);
  assert.equal(pdf.steps[2].status, 'current');
  assert.equal(pdf.modeLabel, 'qwen3.8-max');
});

test('自动统计保底即时标注实际模式，整理统计时不提前确认内容完成', () => {
  const fallback = progress({stage: 2, text: '正在整理统计结果与图表，准备报告预览', model: 'qwen3.8-flash'});
  assert.equal(fallback.statistical, true);
  assert.equal(fallback.modeLabel, '统计报告');
  assert.equal(fallback.stage, 1);
  assert.equal(fallback.completed, 1);
  assert.match(fallback.steps[1].label, /统计/);
  assert.deepEqual(fallback.steps.map(step => step.status), ['complete', 'current', 'pending']);
  const layout = progress({stage: 2, text: '正在将统计解读排版为 PDF'}, true);
  assert.equal(layout.completed, 2);
  assert.equal(layout.statistical, true);
});

test('手动统计和非法阶段值仍保留可解释的三步进度', () => {
  assert.equal(progress({stage: 0, text: '正在核对数据与统计口径'}, true).modeLabel, '统计报告');
  assert.equal(progress({stage: 99}).completed, 2);
  assert.equal(progress({stage: -1}).completed, 0);
  assert.equal(progress({stage: Number.NaN}).completed, 0);
});
