import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextClient} from '../server/textClient.mjs';

const models=['qwen3.8-flash','qwen3.7-flash','qwen3.8-max'];
const input={method:'POST',body:JSON.stringify({model:models[0],messages:[{role:'user',content:'分析'}],stream:true,tools:[{type:'function',function:{name:'inspect'}}]})};
const ok=()=>new Response('data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});

test('文字模型严格依次回退，后续工具步骤沿用成功模型，新任务重新首选',async()=>{
 const bodies=[],events=[];
 const fetchImpl=async(url,init)=>{bodies.push(JSON.parse(init.body));return bodies.length<=2?new Response('private response',{status:bodies.length===1?403:404}):ok();};
 const client=createTextClient({models,onModel:e=>events.push(e),fetchImpl});
 const result=await client.fetch('https://local/chat/completions',input);
 assert.equal(await result.text(),'data: [DONE]\n\n');
 await client.fetch('https://local/chat/completions',input);
 assert.deepEqual(bodies.map(b=>b.model),[...models,models[2]]);
 assert.deepEqual(bodies[2].messages,JSON.parse(input.body).messages);
 assert.deepEqual(bodies[2].tools,JSON.parse(input.body).tools);
 assert.equal(client.model,models[2]);assert.deepEqual(client.modelsUsed,[models[2]]);
 assert.deepEqual(events.map(e=>e.model),models);
 assert.equal(events[1].previousModel,models[0]);assert.match(events[1].text,/权限/);
 assert.doesNotMatch(JSON.stringify(events),/private/);
 const fresh=createTextClient({models,fetchImpl});await fresh.fetch('https://local/chat/completions',input);
 assert.equal(bodies.at(-1).model,models[0]);
});

test('首选可用不触发备用，成功的流不被读取或改写',async()=>{
 let calls=0;const client=createTextClient({models,fetchImpl:async()=>{calls++;return ok();}});
 assert.equal((await client.fetch('https://local/chat/completions',input)).headers.get('content-type'),'text/event-stream');
 assert.equal(calls,1);assert.deepEqual(client.modelsUsed,[models[0]]);
});

test('密钥认证与普通参数错误不会通过换模型反复请求',async()=>{
 for(const status of [400,401,422]){
  let calls=0;const client=createTextClient({models,fetchImpl:async()=>{calls++;return new Response('invalid',{status});}});
  assert.equal((await client.fetch('https://local/chat/completions',input)).status,status);assert.equal(calls,1);
 }
});

test('全部不可用时每个模型只尝试一次并保留最后状态',async()=>{
 const called=[];const client=createTextClient({models,fetchImpl:async(url,init)=>{called.push(JSON.parse(init.body).model);return new Response('denied',{status:403});}});
 assert.equal((await client.fetch('https://local/chat/completions',input)).status,403);
 assert.deepEqual(called,models);assert.deepEqual(client.modelsUsed,[]);
});

test('网络中断与响应超时回退，用户取消立即停止',async()=>{
 let calls=0;const client=createTextClient({models,fetchImpl:async()=>{if(++calls===1)throw new TypeError('fetch failed');return ok();}});
 await client.fetch('https://local/chat/completions',input);assert.equal(client.model,models[1]);
 let timeCalls=0;const slow=createTextClient({models,headerTimeoutMs:5,fetchImpl:async(url,init)=>{if(++timeCalls===1)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));return ok();}});
 await slow.fetch('https://local/chat/completions',input);assert.equal(slow.model,models[1]);
 const controller=new AbortController();controller.abort();let abortedCalls=0;
 const canceled=createTextClient({models,fetchImpl:async()=>{abortedCalls++;return ok();}});
 await assert.rejects(()=>canceled.fetch('https://local/chat/completions',{...input,signal:controller.signal}),e=>e.name==='AbortError');assert.equal(abortedCalls,0);
});

test('并行任务各自保留模型，不共享可变路由状态',async()=>{
 const a=createTextClient({models,fetchImpl:async(url,init)=>JSON.parse(init.body).model===models[0]?new Response('',{status:429}):ok()});
 const b=createTextClient({models,fetchImpl:async()=>ok()});
 await Promise.all([a.fetch('https://local/chat/completions',input),b.fetch('https://local/chat/completions',input)]);
 assert.equal(a.model,models[1]);assert.equal(b.model,models[0]);
});
