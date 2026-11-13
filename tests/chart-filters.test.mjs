import test from 'node:test';
import assert from 'node:assert/strict';
import { buildView, filterSource } from '../src/analysis.mjs';
import { chartDimension, selectionForRow, selectionForRange, selectionFilters, mergeChartSelection, rowSelected, selectionLabel } from '../src/chartFilters.mjs';

const view = (extra = {}) => ({ groupBy: '', granularity: 'none', aggregation: 'auto', filters: [], ...extra });
const cities = {
  title: '城市记录', dimensions: [{ key: '城市', type: 'text' }], metrics: [{ key: '收入', unit: '元' }],
  rows: [{ name: '第一条', 城市: '郑州', 收入: 10 }, { name: '第二条', 城市: '洛阳', 收入: 20 }, { name: '第三条', 城市: '郑州', 收入: 30 }],
};
const dates = (values) => ({ title: '日期记录', dimensions: [{ key: '日期', type: 'date' }], metrics: [{ key: '收入', unit: '元' }], rows: values.map((日期, i) => ({ name: `第${i}条`, 日期, 收入: i + 1 })) });
const selectedRows = (data, v, selection) => filterSource(data, mergeChartSelection(data, v, selection)).rows;

test('图表字段优先选择分组并为 name 使用分类标签', () => {
  assert.deepEqual(chartDimension(cities, view()), { key: '城市', label: '城市', type: 'text' });
  assert.deepEqual(chartDimension({ ...cities, dimensions: [{ key: '地区', type: 'text' }, ...cities.dimensions] }, view({ groupBy: '城市' })), { key: '城市', label: '城市', type: 'text' });
  assert.deepEqual(chartDimension({ metrics: cities.metrics, rows: [{ name: '甲', 收入: 1 }] }, view()), { key: 'name', label: '分类', type: 'text' });
});

test('原始行按维度字段选中全部重复分类并支持增选取消', () => {
  const one = selectionForRow(cities, view(), cities.rows[0]);
  assert.deepEqual(one, { kind: 'categories', field: '城市', values: ['郑州'] });
  assert.equal(selectedRows(cities, view(), one).length, 2);
  assert.equal(rowSelected(cities, view(), cities.rows[2], one), true);
  assert.equal(rowSelected(cities, view(), cities.rows[1], one), false);
  const two = selectionForRow(cities, view(), cities.rows[1], one);
  assert.deepEqual(two.values, ['郑州', '洛阳']);
  const last = selectionForRow(cities, view(), cities.rows[0], two);
  assert.deepEqual(last.values, ['洛阳']);
  assert.equal(selectionForRow(cities, view(), cities.rows[1], last), null);
  assert.deepEqual(one.values, ['郑州']);
});

test('分组行还原分类，切换图形及原始行后保留同字段选择', () => {
  const grouped = view({ groupBy: '城市' });
  const rows = buildView(cities, grouped).rows;
  const one = selectionForRow(cities, grouped, rows[0]);
  assert.deepEqual(selectionForRow(cities, view(), cities.rows[1], one).values, ['郑州', '洛阳']);
  assert.equal(rowSelected(cities, grouped, rows[0], one), true);
  assert.equal(rowSelected(cities, grouped, rows[1], one), false);
  assert.equal(rowSelected(cities, grouped, rows[1], null), true);
});

for (const count of [101, 1000]) {
  test(`${count} 条重复记录汇总为 A 后只占一个选择项`, () => {
    const data = { ...cities, rows: Array.from({ length: count }, (_, i) => ({ name: String(i), 城市: 'A', 收入: 1 })) };
    const grouped = view({ groupBy: '城市' });
    const row = buildView(data, grouped).rows[0];
    const selection = selectionForRow(data, grouped, row);
    assert.deepEqual(selection, { kind: 'categories', field: '城市', values: ['A'] });
    assert.equal(selectedRows(data, grouped, selection).length, count);
    assert.equal(selectionForRow(data, grouped, row, selection), null);
  });
}

test('大量重复的未填写分组仍优先报告缺失值歧义', () => {
  const data = { ...cities, rows: Array.from({ length: 1000 }, (_, i) => ({ name: String(i), 城市: i ? '未填写' : null, 收入: 1 })) };
  const grouped = view({ groupBy: '城市' });
  assert.throws(() => selectionForRow(data, grouped, buildView(data, grouped).rows[0]), /缺失|空值|区分/);
});

test('零值和字符串零属于同一显示分类且不会选中空串或其他分类', () => {
  const data = { ...cities, rows: [0, '0', '', '10'].map((城市, i) => ({ name: String(i), 城市, 收入: 1 })) };
  const selection = selectionForRow(data, view(), data.rows[0]);
  assert.deepEqual(selection.values, [0]);
  assert.deepEqual(selectedRows(data, view(), selection).map(r => r.城市), [0, '0']);
  assert.equal(rowSelected(data, view(), data.rows[1], selection), true);
  assert.equal(rowSelected(data, view(), data.rows[2], selection), false);
  assert.equal(selectionForRow(data, view(), data.rows[1], selection), null);
});

test('已有 AI 筛选会保留，清除选择还原基础视图且输入不突变', () => {
  const base = view({ filters: [{ field: '收入', op: 'gte', value: 20 }] });
  const snapshot = structuredClone({ data: cities, base });
  const selection = selectionForRow(cities, base, cities.rows[2]);
  const merged = mergeChartSelection(cities, base, selection);
  assert.deepEqual(merged.filters[0], base.filters[0]);
  assert.equal(merged.filters.length, 2);
  assert.deepEqual(selectedRows(cities, base, selection), [cities.rows[2]]);
  const reset = mergeChartSelection(cities, base, null);
  assert.deepEqual(reset, base);
  reset.filters[0].value = 99;
  assert.deepEqual({ data: cities, base }, snapshot);
});

test('分类上限为100，既有条件与图表条件总数最多六个', () => {
  const data = { ...cities, rows: Array.from({ length: 101 }, (_, i) => ({ name: String(i), 城市: String(i), 收入: i })) };
  let selection = null;
  for (const row of data.rows.slice(0, 100)) selection = selectionForRow(data, view(), row, selection);
  assert.equal(selection.values.length, 100);
  assert.throws(() => selectionForRow(data, view(), data.rows[100], selection), /100|一百/);
  assert.equal(selectionForRow(data, view(), data.rows[0], selection).values.length, 99);
  const base = view({ filters: Array.from({ length: 6 }, () => ({ field: '收入', op: 'gte', value: 0 })) });
  assert.throws(() => mergeChartSelection(data, base, selection), /六|6/);
  assert.deepEqual(mergeChartSelection(data, base, null), base);
});

test('缺失分类及与真实未填写混合的分组不能被错误恢复', () => {
  const data = { ...cities, rows: [{ name: 'a', 城市: null, 收入: 1 }, { name: 'b', 城市: '未填写', 收入: 2 }] };
  assert.throws(() => selectionForRow(data, view(), data.rows[0]), /缺失|空值|未填写/);
  const grouped = view({ groupBy: '城市' });
  assert.throws(() => selectionForRow(data, grouped, buildView(data, grouped).rows[0]), /缺失|空值|未填写/);
  assert.throws(() => selectionFilters(data, view(), { kind: 'categories', field: '城市', values: [null] }), /缺失|空值|不受支持/);
  const onlyText = { ...data, rows: [data.rows[1]] };
  assert.deepEqual(selectionForRow(onlyText, grouped, buildView(onlyText, grouped).rows[0]).values, ['未填写']);
});

test('真实文本 null 与空值无法用现有筛选区分时拒绝误选', () => {
  const data = { ...cities, rows: [{ name: 'a', 城市: null, 收入: 1 }, { name: 'b', 城市: 'null', 收入: 2 }] };
  assert.throws(() => selectionForRow(data, view(), data.rows[1]), /缺失|空值|区分/);
});

test('按月点击产生日期桶，覆盖月末时间后缀并可再次取消', () => {
  const data = dates(['2024-02-01', '2024-02-29', '2024-02-29T23:59:59.999Z', '2024-03-01']);
  const monthly = view({ groupBy: '日期', granularity: 'month' });
  const row = buildView(data, monthly).rows[0];
  const selection = selectionForRow(data, monthly, row);
  assert.deepEqual(selection, { kind: 'range', field: '日期', granularity: 'month', start: '2024-02', end: '2024-02' });
  assert.deepEqual(selectedRows(data, monthly, selection), data.rows.slice(0, 3));
  assert.deepEqual(selectionFilters(data, monthly, selection).map(f => f.op), ['gte', 'lte']);
  assert.equal(selectionForRow(data, monthly, row, selection), null);
  assert.equal(rowSelected(data, monthly, data.rows[2], selection), true);
  assert.equal(rowSelected(data, monthly, data.rows[3], selection), false);
});

test('月份最后一秒兼容有小数和无小数的标准 ISO 时间', () => {
  const data = dates(['2024-02-29T23:59:59Z', '2024-02-29T23:59:59.001Z', '2024-02-29T23:59:59.999Z', '2024-03-01T00:00:00Z']);
  const monthly = view({ groupBy: '日期', granularity: 'month' });
  const selection = selectionForRow(data, monthly, { name: '2024-02' });
  assert.deepEqual(selectedRows(data, monthly, selection), data.rows.slice(0, 3));
});

test('无显式维度时逐点日期高亮只进行线性规模的字段读取', () => {
  const count = 1000;
  let reads = 0;
  const rows = Array.from({ length: count }, () => Object.defineProperty({ 收入: 1 }, 'name', {
    enumerable: true,
    get() { reads++; return '2024-02-29'; },
  }));
  const data = { metrics: cities.metrics, rows };
  const selection = { kind: 'range', field: 'name', granularity: 'day', start: '2024-02-29', end: '2024-02-29' };
  for (const row of rows) assert.equal(rowSelected(data, view(), row, selection), true);
  assert.ok(reads <= count * 3, `1000 个点读取了 ${reads} 次字段，应随点数线性增长`);
});

test('维度缓存随数据集身份、行引用和维度引用变化失效', () => {
  const data = { metrics: cities.metrics, rows: [{ name: '2024-02-29', 收入: 1 }] };
  assert.equal(chartDimension(data, view()).type, 'date');
  data.rows = [{ name: '分类甲', 收入: 1 }];
  assert.equal(chartDimension(data, view()).type, 'text');
  data.dimensions = [{ key: '城市', type: 'text' }];
  assert.equal(chartDimension(data, view()).key, '城市');
  data.dimensions = [{ key: '日期', type: 'date' }];
  assert.equal(chartDimension(data, view()).key, '日期');
  const original = { metrics: cities.metrics, rows: [{ name: '分类乙', 收入: 1 }] };
  assert.equal(chartDimension(original, view()).type, 'text');
  original.rows[0].name = '2026-01-01';
  assert.equal(chartDimension({ ...original }, view()).type, 'date');
});

test('逆向日期拖选形成跨年连续区间且按桶高亮', () => {
  const data = dates(['2025-11-30', '2025-12-01', '2026-01-12', '2026-02-28T23:59:59', '2026-03-01']);
  const monthly = view({ groupBy: '日期', granularity: 'month' });
  const rows = buildView(data, monthly).rows;
  const selection = selectionForRange(data, monthly, rows[3], rows[1]);
  assert.deepEqual(selection, { kind: 'range', field: '日期', granularity: 'month', start: '2025-12', end: '2026-02' });
  assert.deepEqual(selectedRows(data, monthly, selection), data.rows.slice(1, 4));
  assert.equal(rowSelected(data, monthly, { name: '2026-01' }, selection), true);
  assert.equal(rowSelected(data, monthly, { name: '2026-03' }, selection), false);
});

test('逐日拖选包含闰日及所有当日时间记录', () => {
  const data = dates(['2024-02-28', '2024-02-29T12:00:00', '2024-03-01 23:59:59', '2024-03-02']);
  const selection = selectionForRange(data, view(), data.rows[2], data.rows[0]);
  assert.equal(selection.granularity, 'day');
  assert.deepEqual(selectedRows(data, view(), selection), data.rows.slice(0, 3));
});

test('年度选择包含年末且兼容年、月份精度原始日期', () => {
  const yearly = view({ groupBy: '日期', granularity: 'year' });
  const data = dates(['2025', '2026', '2026-01', '2026-12-31T23:59:59.999Z', '2027']);
  const selection = selectionForRow(data, yearly, { name: '2026' });
  assert.deepEqual(selectedRows(data, yearly, selection), data.rows.slice(1, 4));
  const months = dates(['2026-01', '2026-02', '2026-03']);
  const monthly = view({ groupBy: '日期', granularity: 'month' });
  assert.deepEqual(selectedRows(months, monthly, selectionForRow(months, monthly, { name: '2026-02' })), [months.rows[1]]);
  assert.equal(selectionForRow(months, view(), months.rows[0]).granularity, 'month');
  assert.equal(selectionForRow(dates(['2026']), view(), dates(['2026']).rows[0]).granularity, 'year');
});

test('兼容 name 日期维度并保留日期条件总数限制', () => {
  const data = { metrics: cities.metrics, rows: [{ name: '2024-02-29', 收入: 1 }, { name: '2024-03-01', 收入: 2 }] };
  const base = view({ filters: Array.from({ length: 5 }, () => ({ field: '收入', op: 'gte', value: 0 })) });
  const selection = selectionForRow(data, view(), data.rows[0]);
  assert.equal(selection.field, 'name');
  assert.throws(() => mergeChartSelection(data, base, selection), /六|6/);
  assert.deepEqual(selectedRows(data, view(), selection), [data.rows[0]]);
});

test('较细日期分组仍可选中只有年份或月份的原始记录', () => {
  for (const [values, granularity] of [[['2025', '2026', '2027'], 'month'], [['2026-01', '2026-02', '2026-03'], 'day']]) {
    const data = dates(values);
    const grouped = view({ groupBy: '日期', granularity });
    const row = buildView(data, grouped).rows[1];
    const selection = selectionForRow(data, grouped, row);
    assert.deepEqual(selectedRows(data, grouped, selection), [data.rows[1]]);
    assert.equal(rowSelected(data, grouped, row, selection), true);
  }
});

test('无效日期、非日期拖选及不匹配选择字段给出中文错误', () => {
  const bad = dates(['2023-02-29']);
  assert.throws(() => selectionForRow(bad, view(), bad.rows[0]), /日期/);
  assert.throws(() => selectionForRange(cities, view(), cities.rows[0], cities.rows[1]), /日期/);
  assert.throws(() => selectionFilters(cities, view(), { kind: 'categories', field: '不存在', values: ['郑州'] }), /字段/);
});

test('选择摘要为简短中文，且输入选择和数据保持不变', () => {
  const one = { kind: 'categories', field: '城市', values: ['郑州', '洛阳'] };
  const range = { kind: 'range', field: '日期', granularity: 'month', start: '2026-01', end: '2026-03' };
  const snapshot = structuredClone({ one, range, cities });
  assert.equal(selectionLabel(one), '城市：郑州、洛阳');
  assert.equal(selectionLabel(range), '日期：2026-01 至 2026-03');
  assert.equal(selectionLabel({ ...one, field: 'name' }), '分类：郑州、洛阳');
  assert.equal(selectionLabel(null), '');
  selectionFilters(cities, view(), one);
  assert.deepEqual({ one, range, cities }, snapshot);
});
