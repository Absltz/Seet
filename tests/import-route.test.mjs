import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { importRouter } from '../server/importRoute.mjs';

async function service(t, run) {
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('test-user'))req.user={username:decodeURIComponent(req.get('test-user'))};next();});
 app.use(importRouter({run,isReady:()=>true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 return async body=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/`,{method:'POST',headers:{'Content-Type':'application/json','test-user':encodeURIComponent('甲')},body:JSON.stringify(body)});return {status:response.status,text:await response.text()};};
}
const table={title:'原始成绩',headers:['学号','姓名','成绩'],rows:[['2025001','张清',85],['00102','刘昊',0]]};
test('导入请求将完整表格交给运行器，转发真实进度后才返回结果',async t=>{
 const request=await service(t,async(input,emit)=>{assert.deepEqual(input.table.rows,table.rows);emit({type:'status',text:'正在理解字段'});return {dataset:{rows:table.rows},answer:'已完成'};});
 const response=await request({owner:'甲',table});assert.equal(response.status,200);
 const events=response.text.trim().split('\n').map(JSON.parse);assert.equal(events[0].type,'status');assert.equal(events.at(-1).type,'result');
});
test('错误账号或不合法原表不能触发模型调用',async t=>{
 const request=await service(t,()=>assert.fail('不应调用模型'));
 assert.equal((await request({owner:'乙',table})).status,409);
 assert.equal((await request({owner:'甲',table:{...table,rows:[]}})).status,400);
});
test('工具失败给出可操作原因，供应商错误不泄露原始请求',async t=>{
 const request=await service(t,async()=>{throw Object.assign(new Error('private request Bearer SECRET'),{publicMessage:'字段解释未完成，请重试。'});});
 const response=await request({owner:'甲',table});assert.match(response.text,/字段解释未完成/);assert.doesNotMatch(response.text,/SECRET/);
});

test('导入模型权限不足明确提示开通与授权，不提示网络故障',async t=>{
 const request=await service(t,async()=>{throw Object.assign(new Error('Bearer SECRET private provider detail'),{statusCode:403});});
 const response=await request({owner:'甲',table});const error=JSON.parse(response.text.trim());
 assert.equal(error.code,'model_permission');assert.match(error.error,/模型.*权限|权限.*模型/);assert.match(error.error,/授权|开通/);
 assert.doesNotMatch(error.error,/检查网络|SECRET|private/);
});
