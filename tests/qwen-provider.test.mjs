import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {encodeWav} from '../src/voice.mjs';
import {samples} from './fixtures/datasets.mjs';

async function upstream(t,handler){
 const vars=['AI_PROVIDER','AI_BASE_URL','AI_API_KEY','AI_MODEL','AI_FALLBACK_MODELS','AI_ASR_MODEL','AI_ASR_BASE_URL'];
 const old=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
 const server=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;await handler(JSON.parse(raw),req,res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 Object.assign(process.env,{AI_PROVIDER:'qwen',AI_BASE_URL:base+'/compatible-mode/v1',AI_API_KEY:'mock-local-only',AI_MODEL:'qwen3.8-flash',AI_FALLBACK_MODELS:'qwen3.7-flash,qwen3.8-max',AI_ASR_MODEL:'qwen-audio-3.1-asr-flash',AI_ASR_BASE_URL:base+'/api/v1'});
 t.after(()=>{server.close();for(const k of vars){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}});return base;
}
const json=(res,content)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(content));};
const completion=(content,tools)=>({id:'local-test',object:'chat.completion',created:1,model:'qwen3.8-flash',choices:[{index:0,finish_reason:tools?'tool_calls':'stop',message:{role:'assistant',content,...(tools?{tool_calls:tools}:{})}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});

test('千问提取使用专属思考参数并保留零值与缺失值',async t=>{
 const requests=[];await upstream(t,(body,req,res)=>{requests.push(body);assert.equal(req.url,'/compatible-mode/v1/chat/completions');json(res,completion(JSON.stringify({title:'课程得分',metrics:[{key:'总评',unit:'分'}],rows:[{name:'王晨',总评:0},{name:'李宁',总评:null}]})));});
 const {runAI}=await import('../server/ai.mjs');const result=await runAI({text:'王晨零分，李宁未录入。'});
 assert.equal(result.dataset.rows[0].总评,0);assert.equal(result.dataset.rows[1].总评,null);
 assert.equal(requests[0].model,'qwen3.8-flash');assert.equal(requests[0].enable_thinking,false);assert.equal(requests[0].thinking,undefined);assert.equal(requests[0].max_tokens,8192);assert.equal(requests[0].response_format.type,'json_object');
});

test('千问 Agent 实际执行筛选绘图并回传工具结果',async t=>{
 const requests=[];await upstream(t,(body,req,res)=>{requests.push(body);const first=requests.length===1;json(res,completion(null,[{id:first?'view':'finish',type:'function',function:{name:first?'configure_view':'complete_response',arguments:JSON.stringify(first?{groupBy:'name',granularity:'none',aggregation:'sum',metric:'销量',chart:'line',sort:'original',filters:[]}:{intent:'clarify',answer:'已切换折线图。'})}}]));});
 const {runAgent}=await import('../server/agent.mjs');const events=[];const result=await runAgent({text:'显示销量折线图',dataset:samples[0]},e=>events.push(e));
 assert.equal(result.chart,'line');assert.equal(result.trace[0].status,'success');assert.equal(requests.length,2);assert.equal(requests[0].enable_thinking,false);assert.equal(requests[0].thinking,undefined);assert.equal(requests[0].max_completion_tokens,undefined);assert.equal(requests[0].parallel_tool_calls,false);assert.ok(requests[1].messages.some(m=>m.role==='tool'));assert.ok(events.some(e=>e.type==='tool-end'));
});

test('千问语音走原生同步端点并安全处理失败与空识别',async t=>{
 let request,url,status=200,output={sentence:{text:'比较本班各门课程的及格率。'}};
 await upstream(t,(body,req,res)=>{request=body;url=req.url;res.statusCode=status;json(res,status===200?{output}:{code:'InvalidApiKey',message:'private upstream text'});});
 const {transcribeAudio}=await import('../server/speech.mjs');const audio='data:audio/wav;base64,'+Buffer.from(encodeWav([new Float32Array(16000)],16000)).toString('base64');
 assert.equal((await transcribeAudio(audio)).text,'比较本班各门课程的及格率。');
 assert.equal(url,'/api/v1/services/aigc/multimodal-generation/generation');assert.equal(request.model,'qwen-audio-3.1-asr-flash');assert.equal(request.input.messages[0].content[0].input_audio.data,audio);assert.equal(request.parameters.format,'wav');assert.equal(+request.parameters.sample_rate,16000);assert.equal(request.messages,undefined);
 output={text:'查看学生的学期变化。'};assert.equal((await transcribeAudio(audio)).text,'查看学生的学期变化。');
 output={};await assert.rejects(()=>transcribeAudio(audio),/清晰语音/);
 status=401;await assert.rejects(()=>transcribeAudio(audio),e=>e.status===401&&/认证/.test(e.message)&&!e.message.includes('private'));
});

test('Agent 中途模型不可用时按序回退，已经执行的绘图工具只执行一次',async t=>{
 const requests=[],events=[];
 await upstream(t,(body,req,res)=>{
  requests.push(body);
  if(requests.length===2||requests.length===3){res.statusCode=requests.length===2?403:503;return json(res,{error:{message:'private denied'}});}
  const first=requests.length===1;
  json(res,completion(null,[{id:first?'view':'finish',type:'function',function:{name:first?'configure_view':'complete_response',arguments:JSON.stringify(first?{groupBy:'name',granularity:'none',aggregation:'sum',metric:'销量',chart:'line',sort:'original',filters:[]}:{intent:'clarify',answer:'已切换为销量折线图。'})}}]));
 });
 const {runAgent}=await import('../server/agent.mjs');
 const result=await runAgent({text:'显示销量折线图',dataset:samples[0]},event=>events.push(event));
 assert.deepEqual(requests.map(r=>r.model),['qwen3.8-flash','qwen3.8-flash','qwen3.7-flash','qwen3.8-max']);
 assert.equal(result.trace.filter(t=>t.tool==='configure_view').length,1);assert.equal(result.chart,'line');
 assert.equal(result.model,'qwen3.8-max');assert.deepEqual(result.models,['qwen3.8-flash','qwen3.8-max']);
 assert.deepEqual(events.filter(e=>e.type==='model').map(e=>e.model),['qwen3.8-flash','qwen3.7-flash','qwen3.8-max']);
 assert.deepEqual(requests[1].messages,requests[3].messages);
});

test('千问提取可自动改用第二候选并回传实际型号',async t=>{
 const requests=[];await upstream(t,(body,req,res)=>{
  requests.push(body);if(requests.length===1){res.statusCode=403;return json(res,{error:{message:'denied'}});}
  json(res,completion(JSON.stringify({title:'销量',metrics:[{key:'销量',unit:'杯'}],rows:[{name:'周一',销量:120}]})));
 });
 const {runAI}=await import('../server/ai.mjs');const result=await runAI({text:'周一卖出120杯'});
 assert.deepEqual(requests.map(r=>r.model),['qwen3.8-flash','qwen3.7-flash']);assert.equal(result.model,'qwen3.7-flash');
 assert.equal(result.dataset.rows[0].销量,120);
});

test('前两个模型均等待超时，提取总预算仍允许第三候选接管',async t=>{
 await upstream(t,()=>{});
 const timeout=AbortSignal.timeout.bind(AbortSignal),schedule=setTimeout,requested=[];
 // 按千分之一缩短真实时间，同时保留候选与总预算的比例，避免等待一分钟。
 t.mock.method(AbortSignal,'timeout',ms=>timeout(Math.ceil(ms/1000)));
 t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>schedule(fn,Math.ceil(ms/1000),...args));
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  requested.push(JSON.parse(init.body).model);
  if(requested.length<3)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  return new Response(JSON.stringify(completion(JSON.stringify({title:'销量',metrics:[{key:'销量',unit:'杯'}],rows:[{name:'周一',销量:120}]}))),{headers:{'Content-Type':'application/json'}});
 });
 const {runAI}=await import('../server/ai.mjs');const result=await runAI({text:'周一卖出120杯'});
 assert.deepEqual(requested,['qwen3.8-flash','qwen3.7-flash','qwen3.8-max']);assert.equal(result.model,'qwen3.8-max');
});

test('千问报告完成流式提纲和正文且保留证据校验',async t=>{
 const requests=[];
 await upstream(t,(body,req,res)=>{requests.push(body);const material=JSON.parse(body.messages[1].content);const planning=body.messages[0].content.includes('分析规划');
 const payload=planning?{focus:'根据课程记录比较差异，结合记录质量继续核实。',chartIds:material.charts.slice(0,3).map(c=>c.id)}:{summary:'记录显示出不同的变化，应结合背景进一步核对。',answer:'先比较当前范围的差异，再核对资料完整度。',findings:[{headline:'记录存在差异',explanation:'图表反映了记录之间的变化，原因仍需进一步核实。',chartIds:[material.validatedPlan.chartIds[0]]}],chapters:material.validatedPlan.chartIds.map(chartId=>({chartId,title:'数据变化与核查方向',analysis:'根据已有记录比较差异，并核对相应的业务背景。当前统计描述记录中的现象，不能据此直接推断原因。'})),nextSteps:['核对原始记录后继续分析。'],limitations:['当前资料不足以判断变化原因。']};
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(payload)},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
 const {prepareReport}=await import('../server/report/snapshot.mjs');const {generateNarrative}=await import('../server/report/narrative.mjs');const result=await generateNarrative(prepareReport({dataset:samples[0]}));
 assert.equal(result.mode,'ai');assert.equal(result.chapters.length,3);assert.equal(requests[0].enable_thinking,true);assert.ok(requests[0].thinking_budget<=4096);assert.equal(requests.at(-1).enable_thinking,false);assert.ok(requests.every(r=>r.thinking===undefined&&r.model==='qwen3.8-flash'&&r.max_tokens>0));assert.ok(result.chapters.every(c=>c.evidence.length>0));
});

test('报告模型无权限与密钥认证失败分开提示',async t=>{
 await upstream(t,(body,req,res)=>{res.statusCode=403;json(res,{error:{code:'AccessDenied.Unpurchased',message:'private upstream text'}});});
 const {prepareReport}=await import('../server/report/snapshot.mjs');
 const {generateNarrative,reportFailureMessage}=await import('../server/report/narrative.mjs');
 const result=await generateNarrative(prepareReport({dataset:samples[0]}));
 assert.equal(result.failureCode,'model_permission');assert.match(reportFailureMessage(result.failureCode),/权限.*开通|开通.*权限/);
 assert.doesNotMatch(reportFailureMessage(result.failureCode),/密钥认证失败|private/);
});

test('报告流式提纲和正文共用回退状态，显示并保存实际模型',async t=>{
 const requests=[],events=[];
 await upstream(t,(body,req,res)=>{
  requests.push(body);
  if(requests.length<3){res.statusCode=requests.length===1?403:429;return json(res,{error:{message:'unavailable'}});}
  const material=JSON.parse(body.messages[1].content),planning=body.messages[0].content.includes('分析规划');
  const payload=planning?{focus:'比较实际记录，核对差异与背景。',chartIds:material.charts.slice(0,3).map(c=>c.id)}:{summary:'当前记录呈现差异，应结合业务背景核实。',answer:'先比较记录中的变化，再确认背景。',findings:[{headline:'核对变化',explanation:'已有记录呈现差异，原因仍需核实。',chartIds:[material.validatedPlan.chartIds[0]]}],chapters:material.validatedPlan.chartIds.map(chartId=>({chartId,title:'记录变化',analysis:'图表反映了记录的变化，实际原因需要进一步核实。'})),nextSteps:['核对记录。'],limitations:['不能据此推断因果关系。']};
  res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(payload)},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });
 const {composeReport}=await import('../server/report/compose.mjs'),{prepareReportBundle}=await import('../server/report/snapshot.mjs');
 const {narrative}=await composeReport(prepareReportBundle({dataset:samples[0]}),{onModel:e=>events.push(e)});
 assert.equal(narrative.mode,'ai');assert.equal(narrative.model,'qwen3.8-max');assert.deepEqual(narrative.models,['qwen3.8-max']);
 assert.deepEqual(requests.map(r=>r.model),['qwen3.8-flash','qwen3.7-flash','qwen3.8-max','qwen3.8-max']);
 assert.deepEqual(events.map(e=>e.model),['qwen3.8-flash','qwen3.7-flash','qwen3.8-max']);
});
