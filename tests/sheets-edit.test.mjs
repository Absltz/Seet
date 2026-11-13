import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPaste, makeHistory, commitHistory, undoHistory, redoHistory, sortColumn, selectionTSV } from '../src/sheets/edit.mjs';
const table = { title:'学生', source:'测试', headers:['学号','成绩'], rows:[['001',30],['010',2],['002',null]] };
test('rectangular paste preserves identifiers and formulas as inert raw text', () => {
  const result = applyPaste(table, {row:1,col:0}, '0007\t98\n=SUM(A1)\t');
  assert.deepEqual(result.rows, [['001',30],['0007','98'],['=SUM(A1)','']]);
  assert.equal(table.rows[1][0], '010');
  assert.equal(selectionTSV(result,{row:0,col:0},{row:1,col:1}), '001\t30\n0007\t98');
});
test('paste expands cells but enforces the raw table boundaries', () => {
  assert.equal(applyPaste(table,{row:3,col:2},'x').rows[3][2], 'x');
  assert.throws(() => applyPaste(table,{row:0,col:56},'x'), /56/);
});
test('undo and redo preserve values and cap history', () => {
  let h = makeHistory(table);
  for(let i=0;i<70;i++) h=commitHistory(h,{...table,title:String(i)});
  assert.equal(h.past.length,40);
  const prev=undoHistory(h);
  assert.equal(prev.present.title,'68');
  assert.equal(redoHistory(prev).present.title,'69');
  assert.equal(commitHistory(prev,table).future.length,0);
});
test('sort uses numeric values for numeric columns and lexical identifiers', () => {
  assert.deepEqual(sortColumn(table,1).rows.map(r=>r[1]),[2,30,null]);
  assert.deepEqual(sortColumn({...table,rows:[['10',1],['2',2],['001',3]]},0).rows.map(r=>r[0]),['001','10','2']);
});
