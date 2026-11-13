import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {runAgent} from '../server/agent.mjs';

test('Agent 可只读检查质量、查对象明细、换口径计算，完成回答不改变用户图表',async t=>{
  const requests=[];
  const sequence=[
    ['check_data_quality',{scope:'all'}],
    ['query_records',{issue:'missing',columns:['recordNumber','网点']}],
    ['query_records',{issue:'missing',columns:['编号','网点','日期','金额']}],
    ['calculate_statistics',{scope:'all',groupBy:'网点',aggregation:'average',metric:'金额'}],
    ['complete_response',{intent:'analyze',answer:'乙网点在二月的金额未录入，原始记录3。零值仍是有效记录，未自动删除或填补；请先核对原始台账。'}],
  ];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    const body=JSON.parse(raw);requests.push(body);
    const [name,args]=sequence[Math.min(requests.length-1,sequence.length-1)];
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'local',object:'chat.completion',created:1,model:'qwen3.8-flash',choices:[{index:0,finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call_'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const old=Object.fromEntries(['AI_BASE_URL','AI_API_KEY','AI_MODEL','AI_PROVIDER'].map(key=>[key,process.env[key]]));
  Object.assign(process.env,{AI_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AI_API_KEY:'mock-local',AI_MODEL:'qwen3.8-flash',AI_PROVIDER:'qwen'});
  t.after(()=>{server.close();for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const dataset={title:'月度台账',dimensions:[{key:'编号',type:'text'},{key:'网点',type:'text'},{key:'日期',type:'date'}],metrics:[{key:'金额',unit:'元'}],rows:[
    {name:'甲',编号:'01',网点:'甲',日期:'2026-01-01',金额:100},
    {name:'甲',编号:'02',网点:'甲',日期:'2026-02-01',金额:0},
    {name:'乙',编号:'03',网点:'乙',日期:'2026-02-02',金额:null},
  ]};
  const view={groupBy:'日期',granularity:'month',aggregation:'sum',filters:[{field:'网点',op:'eq',value:'甲'}]};
  const result=await runAgent({text:'这份资料有什么问题？',dataset,view,chart:'line',metricKey:'金额'});
  assert.equal(requests.length,5);assert.equal(result.changed,false);assert.equal(result.chart,'line');assert.deepEqual(result.view,view);
  assert.equal(result.trace.length,4);assert.equal(result.trace[1].status,'error');assert.equal(result.trace[2].status,'success');
  const observations=requests.at(-1).messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
  assert.equal(observations[0].missing.examples[0].values.网点,'乙');assert.equal(observations[0].zero.rowCount,1);
  assert.equal(observations[2].records[0].values.编号,'03');assert.equal(observations[2].records[0].values.日期,'2026-02-02');
  assert.equal(observations[3].values.find(row=>row.name==='甲').金额,50);
  assert.match(result.answer,/乙网点/);
});
