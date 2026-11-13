import test from 'node:test';
import assert from 'node:assert/strict';
import {readDraft,writeDraft} from '../src/sheets/draft.mjs';

test('刷新或恢复草稿后仍保留最近保存版本，撤销修改不把草稿当成已保存版本',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const baseline={title:'已保存',source:'导入',headers:['课程','成绩'],rows:[['数学',80]]};
 const table={...baseline,title:'修改中',rows:[['数学',60]]};
 writeDraft(storage,'A',{table,baseline,dirty:true},'分析1');
 assert.deepEqual(readDraft(storage,'A','分析1').baseline,baseline);
 assert.deepEqual(readDraft(storage,'A','分析1').table,table);
 assert.equal(readDraft(storage,'B','分析1'),null);
});
test('per-account drafts preserve unfinished headers and raw types without sharing owners',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const table={title:'草稿',source:'手工',headers:['','字段'],rows:[['001',null],[3,'=A1']]};
 writeDraft(storage,'A',{table,record:{id:'id',revision:2},dirty:true,seenIncomingId:'incoming-1'});
 assert.deepEqual(readDraft(storage,'A').table,table);
 assert.equal(readDraft(storage,'A').dirty,true);
 assert.equal(readDraft(storage,'A').seenIncomingId,'incoming-1');
 assert.equal(readDraft(storage,'B'),null);
 values.set('seet:sheet-draft:C','broken');assert.equal(readDraft(storage,'C'),null);
});
test('同一个账号的不同分析草稿分别保存',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const table={title:'A',source:'上传',headers:['字段'],rows:[['001']]};
 writeDraft(storage,'A',{table,dirty:true},'分析1');writeDraft(storage,'A',{table:{...table,title:'B'},dirty:true},'分析2');
 assert.equal(readDraft(storage,'A','分析1').table.title,'A');assert.equal(readDraft(storage,'A','分析2').table.title,'B');assert.equal(readDraft(storage,'B','分析1'),null);
});
test('手动打开其他表格的草稿单独保留，默认仍打开当前分析原表',async()=>{
 const {recoverSourceDraft}=await import('../src/sheets/draft.mjs');
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const table={title:'手动新建',source:'手工',headers:['字段'],rows:[['未保存内容']]};
 writeDraft(storage,'A',{table,dirty:true},'分析1');
 const source={table:{...table,title:'原始成绩',projectId:'A'},item:{id:'sheet-A',revision:1}};
 const result=recoverSourceDraft(storage,'A','分析1',source);
 assert.equal(result.table.title,'原始成绩');assert.equal(result.detachedScope,'分析1:detached');
 assert.equal(readDraft(storage,'A',result.detachedScope).table.rows[0][0],'未保存内容');assert.equal(readDraft(storage,'B',result.detachedScope),null);
});
test('先后新建的两份未保存草稿不能互相覆盖，相同草稿不重复备份',async()=>{
 const {recoverSourceDraft}=await import('../src/sheets/draft.mjs');
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const table={title:'T1',source:'手工',headers:['字段'],rows:[['第一份']]},source={table:{...table,title:'原表',projectId:'P'},item:{id:'S',revision:1}};
 writeDraft(storage,'A',{table,dirty:true},'分析1');const one=recoverSourceDraft(storage,'A','分析1',source);
 writeDraft(storage,'A',{table:{...table,title:'T2',rows:[['第二份']]},dirty:true},'分析1');const two=recoverSourceDraft(storage,'A','分析1',source);
 assert.notEqual(one.detachedScope,two.detachedScope);assert.equal(readDraft(storage,'A',one.detachedScope).table.title,'T1');assert.equal(readDraft(storage,'A',two.detachedScope).table.title,'T2');
 assert.equal(recoverSourceDraft(storage,'A','分析1',source).detachedScope,two.detachedScope);
});
