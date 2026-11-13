import test from 'node:test';
import assert from 'node:assert/strict';

// 缺少模块时仍以断言显示待实现的公开接口。
const board = await import('../src/library/board.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

const dataset = {
  title: '分类记录',
  dimensions: [{ key: '区域', type: 'text' }, { key: '日期', type: 'date' }],
  metrics: [{ key: '数量', unit: '个' }, { key: '比例', unit: '%' }],
  rows: [
    { name: '记录 1', 区域: '甲', 日期: '2026-01-01', 数量: 2, 比例: 10 },
    { name: '记录 2', 区域: '甲', 日期: '2026-02-01', 数量: 4, 比例: 20 },
    { name: '记录 3', 区域: '乙', 日期: '2026-02-01', 数量: 9, 比例: 30 },
  ],
};
const card = (overrides = {}) => ({
  id: 'a', dataset, metricKey: '数量', chart: 'bar',
  view: { groupBy: '区域', granularity: 'none', aggregation: 'sum', filters: [] },
  ...overrides,
});

test('看板字段汇总所有数据集的维度和指标并限制候选值数量', () => {
  assert.equal(typeof board.boardFields, 'function');
  const other = { dimensions: [{ key: '分类', type: 'text' }], metrics: [{ key: '数量' }],
    rows: Array.from({ length: 110 }, (_, i) => ({ name: `记录 ${i}`, 分类: `分类${i}`, 数量: i })) };
  const fields = board.boardFields([card(), card({ dataset: other })]);
  assert.deepEqual(fields.find(f => f.key === '区域'), { key: '区域', type: 'text', values: ['甲', '乙'] });
  assert.equal(fields.find(f => f.key === '日期').type, 'date');
  assert.equal(fields.find(f => f.key === '数量').type, 'number');
  assert.equal(fields.find(f => f.key === '分类').values.length, 100);
  assert.equal(fields.filter(f => f.key === '数量').length, 1);
  assert.deepEqual(board.boardFields([]), []);
});

test('全局筛选替换同字段条件且保留其它筛选与视图属性', () => {
  assert.equal(typeof board.viewForCard, 'function');
  const item = card({ view: { ...card().view, note: '保留设置', filters: [
    { field: '区域', op: 'eq', value: '乙' },
    { field: '数量', op: 'gte', value: 3 },
  ] } });
  const snapshot = structuredClone(item);
  const { view, applicable } = board.viewForCard(item, { field: '区域', op: 'eq', value: '甲' });
  assert.equal(applicable, true);
  assert.equal(view.note, '保留设置');
  assert.deepEqual(view.filters, [
    { field: '数量', op: 'gte', value: 3 }, { field: '区域', op: 'eq', value: '甲' },
  ]);
  assert.deepEqual(item, snapshot);
});

test('异构卡片遇到不存在的字段保留原视图且标记不适用', () => {
  assert.equal(typeof board.viewForCard, 'function');
  const item = card();
  assert.deepEqual(board.viewForCard(item, { field: '其它分类', op: 'eq', value: '甲' }), {
    view: item.view, applicable: false,
  });
  assert.deepEqual(board.viewForCard(item, null), { view: item.view, applicable: true });
});

test('六个筛选允许替换同字段但拒绝新增第七个条件', () => {
  assert.equal(typeof board.viewForCard, 'function');
  const item = card({ view: { ...card().view,
    filters: Array.from({ length: 6 }, () => ({ field: '数量', op: 'gte', value: 0 })) } });
  assert.equal(board.viewForCard(item, { field: '数量', op: 'gte', value: 1 }).view.filters.length, 1);
  assert.throws(() => board.viewForCard(item, { field: '区域', op: 'eq', value: '甲' }), /六|6/);
});

test('多字段筛选重新计算汇总和源行数并匹配所选指标', () => {
  assert.equal(typeof board.buildBoardCard, 'function');
  const item = card({ view: { ...card().view, filters: [{ field: '数量', op: 'gte', value: 3 }] } });
  const result = board.buildBoardCard(item, { field: '区域', op: 'eq', value: '甲' });
  assert.deepEqual(result.data.rows, [{ name: '甲', 数量: 4, 比例: 20 }]);
  assert.equal(result.stats.total, 4);
  assert.equal(result.sourceRows, 1);
  assert.equal(result.metric.key, '数量');
  assert.equal(result.applicable, true);
  assert.equal(result.availability.ok, true);
});

test('空筛选结果返回空数据和空统计而不沿用旧数据', () => {
  assert.equal(typeof board.buildBoardCard, 'function');
  const result = board.buildBoardCard(card(), { field: '区域', op: 'eq', value: '不存在' });
  assert.deepEqual(result.data.rows, []);
  assert.equal(result.sourceRows, 0);
  assert.equal(result.stats.total, null);
  assert.equal(result.stats.count, 0);
  assert.equal(result.availability.ok, false);
});

test('卡片按当前指标降序排列且不修改源数据和原始视图顺序', () => {
  const item = card({ sort: true, view: { ...card().view, groupBy: '' } });
  const snapshot = structuredClone(item);
  const result = board.buildBoardCard(item, null);
  assert.deepEqual(result.data.rows.map(row => row.数量), [9, 4, 2]);
  assert.deepEqual(item, snapshot);
  assert.deepEqual(board.buildBoardCard({ ...item, sort: false }, null).data.rows.map(row => row.数量), [2, 4, 9]);
});

test('零行数据的共享筛选和纯计算返回空结果且无非数字统计', () => {
  const empty = { ...dataset, rows: [] };
  const item = card({ dataset: empty, sort: true });
  assert.deepEqual(board.boardFields([item]).map(field => field.values), [[], [], [], []]);
  assert.equal(board.viewForCard(item, { field: '数量', op: 'gte', value: 0 }).applicable, true);
  for (const globalFilter of [null, { field: '数量', op: 'gte', value: 0 }]) {
    const result = board.buildBoardCard(item, globalFilter);
    assert.deepEqual(result.data.rows, []);
    assert.deepEqual(result.stats, { total: null, count: 0, missing: 0, average: null, max: null, min: null, leaders: [] });
    assert.equal(result.sourceRows, 0);
    assert.equal(result.availability.ok, false);
    assert.equal(Object.values(result.stats).some(Number.isNaN), false);
  }
  assert.deepEqual(board.datasetQuality(empty), { rows: 0, fields: 4, missingCells: 0, duplicateRows: 0 });
});

test('不适用筛选仍计算自身视图且不可用饼图返回原因', () => {
  assert.equal(typeof board.buildBoardCard, 'function');
  const result = board.buildBoardCard(card({ chart: 'pie', dataset: {
    ...dataset, rows: [{ name: '记录 1', 区域: '甲', 日期: '2026-01-01', 数量: -1, 比例: 0 }],
  } }), { field: '别的字段', op: 'eq', value: '甲' });
  assert.equal(result.applicable, false);
  assert.equal(result.stats.total, -1);
  assert.equal(result.availability.ok, false);
  assert.match(result.availability.reason, /负值/);
});

test('卡片排序不修改输入并安全处理越界和未知标识', () => {
  assert.equal(typeof board.moveBoardItem, 'function');
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(board.moveBoardItem(items, 'a', 2).map(i => i.id), ['b', 'c', 'a']);
  assert.deepEqual(board.moveBoardItem(items, 'c', -10).map(i => i.id), ['c', 'a', 'b']);
  assert.deepEqual(board.moveBoardItem(items, 'a', 90).map(i => i.id), ['b', 'c', 'a']);
  assert.equal(board.moveBoardItem(items, '不存在', 1), items);
  assert.deepEqual(items.map(i => i.id), ['a', 'b', 'c']);
});

test('数据质量统计维度和指标的缺失并将零视为有效值', () => {
  assert.equal(typeof board.datasetQuality, 'function');
  assert.deepEqual(board.datasetQuality({ ...dataset, rows: [
    { name: '记录 1', 区域: '', 日期: null, 数量: 0, 比例: undefined },
    { name: '记录 2', 区域: '甲', 日期: '2026-01-01', 数量: null, 比例: 0 },
  ] }), { rows: 2, fields: 4, missingCells: 4, duplicateRows: 0 });
});

test('重复检测比较全部源字段且忽略生成的显示名称', () => {
  assert.equal(typeof board.datasetQuality, 'function');
  const same = { 区域: '甲', 日期: '2026-01-01', 数量: 0, 比例: 0 };
  assert.equal(board.datasetQuality({ ...dataset, rows: [
    { name: '记录 1', ...same }, { name: '记录 2', ...same },
    { name: '记录 3', ...same, 日期: '2026-02-01' },
  ] }).duplicateRows, 1);
  assert.equal(board.datasetQuality({ metrics: [{ key: '值' }], rows: [
    { name: '记录 1', 值: 0 }, { name: '记录 2', 值: 0 },
  ] }).duplicateRows, 1);
  assert.equal(board.datasetQuality({ metrics: [{ key: '值' }], rows: [
    { name: '甲', 值: 0 }, { name: '乙', 值: 0 },
  ] }).duplicateRows, 0);
});

test('日期全局筛选保留同一字段的上下界并整组替换原条件', () => {
  const item = card({ view: { ...card().view, note: '保留日期视图', filters: [
    { field: '日期', op: 'gte', value: '2025-01-01' },
    { field: '区域', op: 'eq', value: '甲' },
    { field: '日期', op: 'lte', value: '2027-01-01' },
  ] } });
  const range = [
    { field: '日期', op: 'gte', value: '2026-02-01' },
    { field: '日期', op: 'lte', value: '2026-02-28' },
  ];
  const snapshot = structuredClone({ item, range });
  const result = board.viewForCard(item, range);
  assert.equal(result.applicable, true);
  assert.equal(result.view.note, '保留日期视图');
  assert.deepEqual(result.view.filters, [{ field: '区域', op: 'eq', value: '甲' }, ...range]);
  assert.deepEqual({ item, range }, snapshot);
});

test('任一全局字段不适用时整组保留卡片原视图', () => {
  const item = card();
  const filters = [
    { field: '日期', op: 'gte', value: '2026-02-01' },
    { field: '其它分类', op: 'eq', value: '甲' },
  ];
  const result = board.viewForCard(item, filters);
  assert.equal(result.view, item.view);
  assert.equal(result.applicable, false);
  assert.equal(board.buildBoardCard(item, filters).sourceRows, 3);
});

test('空数组等同未筛选并保留原视图', () => {
  const item = card();
  assert.deepEqual(board.viewForCard(item, []), { view: item.view, applicable: true });
  assert.deepEqual(board.buildBoardCard(item, []), board.buildBoardCard(item, null));
});

test('日期整组筛选按合并后的条件总数执行六条件限制', () => {
  const range = [
    { field: '日期', op: 'gte', value: '2026-01-01' },
    { field: '日期', op: 'lte', value: '2026-02-28' },
  ];
  const numeric = count => Array.from({ length: count }, () => ({ field: '数量', op: 'gte', value: 0 }));
  const six = card({ view: { ...card().view, filters: [
    ...numeric(4), { field: '日期', op: 'gte', value: '2025-01-01' },
    { field: '日期', op: 'lte', value: '2027-01-01' },
  ] } });
  assert.equal(board.viewForCard(six, range).view.filters.length, 6);
  const overflow = card({ view: { ...card().view, filters: numeric(5) } });
  assert.throws(() => board.viewForCard(overflow, range), /六|6/);
  assert.throws(() => board.viewForCard(card(), numeric(7)), /六|6/);
});

test('数组中的每个全局条件均通过视图校验', () => {
  assert.throws(() => board.viewForCard(card(), [
    { field: '日期', op: 'gte', value: '2026-01-01' },
    { field: '日期', op: 'invalid', value: '2026-02-01' },
  ]), /筛选/);
});

test('日期双界和原有其他字段条件共同重新计算源行数与统计', () => {
  const item = card({ metricKey: '比例', view: { ...card().view, filters: [
    { field: '区域', op: 'eq', value: '甲' },
    { field: '日期', op: 'gte', value: '2025-01-01' },
  ] } });
  const range = [
    { field: '日期', op: 'gte', value: '2026-02-01' },
    { field: '日期', op: 'lte', value: '2026-02-01' },
  ];
  const snapshot = structuredClone({ item, range });
  const result = board.buildBoardCard(item, range);
  assert.equal(result.applicable, true);
  assert.deepEqual(result.data.rows, [{ name: '甲', 数量: 4, 比例: 20 }]);
  assert.equal(result.sourceRows, 1);
  assert.equal(result.stats.total, 20);
  assert.equal(result.stats.average, 20);
  assert.equal(result.metric.key, '比例');
  assert.deepEqual({ item, range }, snapshot);
});

test('点击月份与原日期下限取交集而不扩大已筛选的数据', () => {
  const item = card({ dataset: { ...dataset, rows: [
    { name: '记录 1', 区域: '甲', 日期: '2024-02-01', 数量: 100, 比例: 10 },
    { name: '记录 2', 区域: '甲', 日期: '2024-02-20', 数量: 1, 比例: 20 },
    { name: '记录 3', 区域: '甲', 日期: '2024-03-01', 数量: 10, 比例: 30 },
  ] }, view: { ...card().view, note: '保留交集视图', filters: [
    { field: '日期', op: 'gte', value: '2024-02-15' },
  ] } });
  const clickedMonth = [
    { field: '日期', op: 'gte', value: '2024-02-01' },
    { field: '日期', op: 'lte', value: '2024-02-29' },
  ];
  const snapshot = structuredClone({ item, clickedMonth });
  const selected = board.viewForCard(item, null, clickedMonth);
  assert.deepEqual(selected.view.filters, [...item.view.filters, ...clickedMonth]);
  assert.equal(selected.view.note, '保留交集视图');
  const result = board.buildBoardCard(item, null, clickedMonth);
  assert.equal(result.applicable, true);
  assert.equal(result.sourceRows, 1);
  assert.equal(result.stats.total, 1);
  assert.deepEqual(result.data.rows, [{ name: '甲', 数量: 1, 比例: 20 }]);
  // 手工全局筛选依旧可以覆盖同字段原条件。
  assert.equal(board.buildBoardCard(item, clickedMonth).stats.total, 101);
  assert.deepEqual({ item, clickedMonth }, snapshot);
});

test('交互条件追加到手工覆盖后的视图且不替换任何现有条件', () => {
  const item = card({ view: { ...card().view, filters: [
    { field: '区域', op: 'eq', value: '乙' },
    { field: '日期', op: 'gte', value: '2026-02-01' },
  ] } });
  const manual = { field: '区域', op: 'eq', value: '甲' };
  const interaction = [
    { field: '区域', op: 'eq', value: '乙' },
    { field: '日期', op: 'lte', value: '2026-02-28' },
  ];
  const snapshot = structuredClone({ item, manual, interaction });
  assert.deepEqual(board.viewForCard(item, manual, interaction).view.filters, [
    item.view.filters[1], manual, ...interaction,
  ]);
  assert.equal(board.buildBoardCard(item, manual, interaction).sourceRows, 0);
  assert.deepEqual({ item, manual, interaction }, snapshot);
});

test('全局和交互条件作为一组检查字段适用性', () => {
  const item = card();
  const manual = { field: '区域', op: 'eq', value: '甲' };
  const interaction = [{ field: '不存在', op: 'eq', value: '甲' }];
  assert.deepEqual(board.viewForCard(item, manual, interaction), { view: item.view, applicable: false });
  assert.deepEqual(board.viewForCard(item, interaction, [manual]), { view: item.view, applicable: false });
  const result = board.buildBoardCard(item, manual, interaction);
  assert.equal(result.applicable, false);
  assert.equal(result.sourceRows, 3);
});

test('交互追加后的完整视图仍校验六条件上限和操作符', () => {
  const item = card({ view: { ...card().view, filters: Array.from({ length: 5 },
    () => ({ field: '数量', op: 'gte', value: 0 })) } });
  const interaction = [
    { field: '日期', op: 'gte', value: '2026-01-01' },
    { field: '日期', op: 'lte', value: '2026-02-28' },
  ];
  assert.equal(board.viewForCard(item, null, interaction.slice(0, 1)).view.filters.length, 6);
  assert.throws(() => board.viewForCard(item, null, interaction), /六|6/);
  assert.throws(() => board.viewForCard(card(), null, [{ field: '区域', op: 'invalid', value: '甲' }]), /筛选/);
});
