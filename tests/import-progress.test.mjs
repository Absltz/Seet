import test from 'node:test';
import assert from 'node:assert/strict';

const load=()=>import('../src/components/importProgress.mjs');
const step=(id,tool,status,summary='')=>({id,tool,status,summary,label:tool});
test('等待模型时只确认已读取原表，不虚构 AI 已完成的步骤',async()=>{
 const {importProgress}=await load(),result=importProgress([],true);
 assert.deepEqual(result.stages.map(s=>s.status),['success','waiting','pending','pending']);
 assert.equal(result.completed,1);
});
test('阶段来自工具结果，运行和错误不计为完成',async()=>{
 const {importProgress}=await load();
 const result=importProgress([step('1','interpret_table','success','已识别12列'),step('2','configure_view','running')],true);
 assert.deepEqual(result.stages.map(s=>s.status),['success','success','running','pending']);
 assert.equal(result.completed,2);
 const failed=importProgress([step('1','interpret_table','success'),step('2','configure_view','error','筛选后无数据')],false);
 assert.equal(failed.stages[2].status,'error');assert.equal(failed.stages[2].summary,'筛选后无数据');assert.equal(failed.completed,2);
});
test('重新解释字段会使下游旧统计与完成结果失效',async()=>{
 const {importProgress}=await load();
 const trace=[step('1','interpret_table','success'),step('2','configure_view','success'),step('3','complete_import','success'),step('4','interpret_table','running')];
 const result=importProgress(trace,true);
 assert.deepEqual(result.stages.map(s=>s.status),['success','running','pending','pending']);assert.equal(result.completed,1);
});
test('计算重试成功后才进入核对阶段，失败退出保留当前事实',async()=>{
 const {importProgress}=await load();
 const trace=[step('1','interpret_table','success'),step('2','configure_view','error'),step('3','configure_view','success')];
 assert.deepEqual(importProgress(trace,true).stages.map(s=>s.status),['success','success','success','waiting']);
 assert.deepEqual(importProgress(trace,false).stages.map(s=>s.status),['success','success','success','pending']);
 trace.push(step('4','complete_import','success'));
 assert.equal(importProgress(trace,false).completed,4);
});
