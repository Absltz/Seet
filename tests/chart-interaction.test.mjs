import test from 'node:test';
import assert from 'node:assert/strict';

import * as interaction from '../src/chartInteraction.mjs';
const implementation = name => {
  assert.equal(typeof interaction[name], 'function', `${name} must be available`);
  return interaction[name];
};
const metric = '收入';
const dates = Array.from({ length: 260 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
  return { name: `记录${i}`, 日期: date, 收入: i };
});

test('15 个城市按可用宽度保留全部刻度，空间不足时旋转并扩展画布', () => {
  const layout = implementation('chartAxisLayout');
  const rows = ['郑州','洛阳','开封','安阳','新乡','焦作','许昌','漯河','三门峡','南阳','商丘','信阳','周口','驻马店','济源'].map(name => ({ name }));
  const dense = layout(rows, 500, 48);
  assert.equal(dense.interval, 0);
  assert.ok(dense.angle < 0);
  assert.ok(dense.minWidth > 500);
  assert.ok(dense.height >= 48);
  const roomy = layout(rows, 1000, 48);
  assert.equal(roomy.angle, 0);
  assert.equal(roomy.interval, 0);
  assert.equal(roomy.minWidth, 1000);
});

test('完整日期概览不受主图 200 类限制，并按实际日期排序', () => {
  const rows = implementation('chartTimelineRows')({ rows: [...dates].reverse() }, metric, { key: '日期' });
  assert.equal(rows.length, 260);
  assert.equal(rows[0].name, '2026-01-01');
  assert.equal(rows.at(-1).name, '2026-09-17');
  assert.equal(rows[0].__sourceRow, dates[0]);
  assert.equal(rows.at(-1).value, 259);
});

test('日期选区先筛选主图再应用 200 类上限，可以重新扩到原始两端', () => {
  const series = implementation('chartSeriesRows');
  const data = { rows: dates };
  const selection = { dimension: { type: 'date' }, selection: { kind: 'range' }, isSelected: row => row.收入 >= 210 && row.收入 <= 240 };
  const selected = series(data, metric, selection);
  assert.equal(selected.length, 31);
  assert.equal(selected[0].__sourceRow, dates[210]);
  assert.equal(selected.at(-1).value, 240);
  assert.equal(series(data, metric, { ...selection, selection: null }).length, 200);
  assert.equal(data.rows.length, 260);
});

test('分类多选继续保留背景，方便逐项增选', () => {
  const rows = implementation('chartSeriesRows')({ rows: dates.slice(0, 15) }, metric, { dimension: { type: 'text' }, selection: { kind: 'categories' }, isSelected: () => false });
  assert.equal(rows.length, 15);
});

test('语义相同的新概览数组保留原引用，避免 Brush 在筛选回写后重置轨道', () => {
  const timeline = implementation('chartTimelineRows');
  const stabilize = implementation('stableTimelineRows');
  const previous = timeline({ rows: dates }, metric, { key: '日期' });
  const rebuilt = timeline({ rows: structuredClone(dates) }, metric, { key: '日期' });
  assert.equal(stabilize(previous, rebuilt), previous);
  const changed = timeline({ rows: dates.slice(5) }, metric, { key: '日期' });
  assert.equal(stabilize(previous, changed), changed);
  rebuilt[0].value = 999;
  assert.equal(stabilize(previous, rebuilt), rebuilt);
});

test('常见的 1000 点折线保留已选时间范围每一个点，包含末日', () => {
  const data = { rows: Array.from({ length: 1000 }, (_, i) => ({ name: String(i), 收入: i })) };
  const rows = implementation('chartSeriesRows')(data, metric, null, 'line');
  assert.equal(rows.length, 1000);
  assert.equal(rows.at(-1).__sourceRow, data.rows.at(-1));
});

test('数万点折线抽稀覆盖首尾，保留每段极小值、极大值及缺失值', () => {
  const data = { rows: Array.from({ length: 50000 }, (_, i) => ({ name: String(i), 收入: Math.sin(i) })) };
  data.rows[41001].收入 = 9999;
  data.rows[8003].收入 = -9999;
  data.rows[25555].收入 = null;
  const rows = implementation('chartSeriesRows')(data, metric, null, 'line');
  assert.ok(rows.length <= 2000);
  assert.equal(rows[0].__sourceRow, data.rows[0]);
  assert.equal(rows.at(-1).__sourceRow, data.rows.at(-1));
  for (const index of [41001, 8003, 25555]) assert.ok(rows.some(row => row.__sourceRow === data.rows[index]));
  assert.ok(rows.every((row, index) => !index || row.id > rows[index - 1].id));
});
