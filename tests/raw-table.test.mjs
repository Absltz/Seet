import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRawTable, tableFromMatrix, tableFromDataset, tableToMatrix } from '../src/rawTable.mjs';
import { validateDataset } from '../src/data.mjs';

test('来源编号在数据校验、还原原表和编辑后保留，非法来源不能写入',()=>{
 const projectId='11111111-1111-4111-8111-111111111111';
 const data={title:'经营数据',projectId,metrics:[{key:'收入',unit:'元'}],rows:[{name:'一月',收入:100}]};
 const normalized=validateDataset(data);assert.equal(normalized.projectId,projectId);
 const table=tableFromDataset(normalized);assert.equal(table.projectId,projectId);
 assert.equal(validateRawTable({...table,title:'重命名',rows:[['一月',120]]}).projectId,projectId);
 assert.throws(()=>validateDataset({...data,projectId:'错误编号'}),/项目编号/);
 assert.throws(()=>validateRawTable({...table,projectId:'错误编号'}),/项目编号/);
});

test('原表只读取单元格，不把学号或含零标识转换为指标', () => {
  const matrix = [['学号', '姓名', '课程', '成绩'], ['202501001', '林知远', '高等数学', 87], ['001020', '陈舒', '大学英语', '缺考']];
  const original = structuredClone(matrix);
  const table = tableFromMatrix(matrix, '一班成绩', '成绩.xlsx');
  assert.deepEqual(table.headers, matrix[0]);
  assert.deepEqual(table.rows, matrix.slice(1));
  assert.deepEqual(tableToMatrix(table), matrix);
  assert.equal(table.metrics, undefined);
  table.rows[0][0] = 'changed';
  assert.deepEqual(matrix, original);
});

test('缺失值、日期、零值和最后一行均保留', () => {
  const matrix = [['日期', '编号', '用量'], [new Date('2026-01-01T00:00:00Z'), '0001', 0], ['2026-01-02', null, null], ['2026-12-31', '9999', '1.50']];
  const table = tableFromMatrix(matrix);
  assert.equal(table.rows[0][0], '2026-01-01');
  assert.deepEqual(table.rows.at(-1), ['2026-12-31', '9999', '1.50']);
  assert.deepEqual(table.rows[1], ['2026-01-02', null, null]);
  assert.equal(tableFromMatrix([['时间'],[new Date('2026-01-01T10:30:00Z')]]).rows[0][0], '2026-01-01T10:30:00.000Z');
});

test('空白和重复表头使用可编辑的唯一列名，不丢失列', () => {
  const table = tableFromMatrix([['姓名', '', '姓名'], ['王昊', 0, '乙']]);
  assert.equal(new Set(table.headers).size, 3);
  assert.equal(table.headers.length, 3);
  assert.deepEqual(table.rows, [['王昊', 0, '乙']]);
});

test('已有数据集送入 AI 前还原所有字段、单位与原始行', () => {
  const dataset = { title: '成绩', source: '已保存数据', dimensions: [{ key:'姓名',type:'text' }], metrics:[{key:'学号',unit:''},{key:'总评',unit:'分'}],rows:[{name:'许清',姓名:'许清',学号:202501001,总评:87}] };
  const raw = tableFromDataset(dataset);
  assert.deepEqual(raw.headers, ['姓名','学号','总评（分）']);
  assert.deepEqual(raw.rows, [['许清',202501001,87]]);
  assert.equal(raw.source, '已保存数据');
});

test('验证拒绝危险键、不匹配列数、非有限数与超限原表', () => {
  const valid = { title:'测试',headers:['标识','数值'],rows:[['001',1]] };
  assert.throws(() => validateRawTable({...valid,headers:['__proto__','数值']}), /表头|字段/);
  assert.throws(() => validateRawTable({...valid,rows:[[1,2,3]]}), /列/);
  assert.throws(() => validateRawTable({...valid,rows:[[null,Infinity]]}), /单元格|数字/);
  assert.throws(() => validateRawTable({...valid,rows:[['x'.repeat(2001),1]]}), /2000|单元格/);
  assert.throws(() => validateRawTable({...valid,rows:Array.from({length:50001},()=>['x',1])}), /50000/);
});

test('超过完整上下文上限必须报错，不能截取部分表格', () => {
  const rows = Array.from({length:1000},()=>['文本'.repeat(700),1]);
  assert.throws(() => validateRawTable({title:'大表',headers:['说明','数值'],rows}), /完整|拆分|1200000/);
  assert.equal(rows.length, 1000);
});
