import test from 'node:test';
import assert from 'node:assert/strict';
import {readSheetFile} from '../src/sheets/import.mjs';
test('CSV imports all rows and preserves leading zeros, blank cells, and inert formulas',async()=>{
 const result=await readSheetFile(new File(['学号,成绩,备注\n001,90,\n002,0,=SUM(A1)\n'],'students.csv'));
 assert.deepEqual(result.rows,[['001','90',''],['002','0','=SUM(A1)']]);
 assert.equal(result.title,'students');
});
test('JSON keeps number and null types and rejects nested values',async()=>{
 const file=value=>new File([JSON.stringify(value)],'数据.json');
 const result=await readSheetFile(file([{学号:'001',成绩:90},{学号:'002',成绩:null}]));
 assert.deepEqual(result.rows,[['001',90],['002',null]]);
 await assert.rejects(readSheetFile(file([{值:{nested:1}}])),/单元格/);
});
