import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {validateDataset} from '../src/data.mjs';
import {dataProfile} from '../src/analysis.mjs';
import * as evidence from '../server/analysisEvidence.mjs';
import {runAgent} from '../server/agent.mjs';
import {enumerationRequirements, enumerationCompletionError} from '../server/queryCompleteness.mjs';

const dataset = validateDataset({
  title:'分类查询测试', dimensions:['城市','编号','课程','区域'].map(key=>({key,type:'text'})),
  metrics:[{key:'数量',unit:'条'}],
  rows:Array.from({length:2550},(_,i)=>({name:`记录${i+1}`,城市:`城市${String(Math.floor(i/170)+1).padStart(2,'0')}`,
    编号:`ID${String(i%75+1).padStart(3,'0')}`,课程:`课程${i%12+1}`,区域:i%2?'南区':'北区',数量:i%4===0?null:1})),
});
const view={groupBy:'区域',granularity:'none',aggregation:'sum',filters:[{field:'区域',op:'eq',value:'北区'}]};

test('数据概况显式区分前八个示例与完整分类集合',()=>{
  const field=dataProfile(dataset).dimensions.find(field=>field.key==='城市');
  assert.equal(field.unique,15);
  assert.equal(field.examples.length,8);
  assert.equal(field.examplesComplete,false);
  assert.equal(field.hasMoreExamples,true);
  assert.equal(field.remainingExamples,7);
});

test('去重值查询遍历2550行后返回15个城市，不受前50行重复及空指标影响',()=>{
  assert.equal(typeof evidence.distinctValues,'function');
  const before=JSON.stringify(view);
  const result=evidence.distinctValues(dataset,view,{field:'城市'});
  assert.equal(result.scope,'all');
  assert.equal(result.matchedRows,2550);
  assert.equal(result.total,15);
  assert.equal(result.returned,15);
  assert.equal(result.hasMore,false);
  assert.deepEqual(result.values.map(item=>item.value),Array.from({length:15},(_,i)=>`城市${String(i+1).padStart(2,'0')}`));
  assert.ok(result.values.every(item=>item.count===170));
  assert.equal(JSON.stringify(view),before);
});

test('不同领域字段去重支持当前筛选、附加条件与可靠分页',()=>{
  assert.equal(typeof evidence.distinctValues,'function');
  const first=evidence.distinctValues(dataset,view,{field:'编号',scope:'current',limit:20});
  assert.equal(first.scopedRows,1275);assert.equal(first.total,75);assert.equal(first.hasMore,true);assert.equal(first.nextOffset,20);
  const second=evidence.distinctValues(dataset,view,{field:'编号',scope:'current',offset:first.nextOffset,limit:50});
  const last=evidence.distinctValues(dataset,view,{field:'编号',scope:'current',offset:second.nextOffset,limit:50});
  assert.equal(new Set([...first.values,...second.values,...last.values].map(item=>item.value)).size,75);
  assert.equal(last.hasMore,false);assert.equal(last.nextOffset,null);
  const courses=evidence.distinctValues(dataset,view,{field:'课程',scope:'current',filters:[{field:'城市',op:'eq',value:'城市15'}]});
  assert.equal(courses.total,6);assert.equal(courses.matchedRows,85);
  const regions=evidence.distinctValues(dataset,view,{field:'区域',scope:'current'});
  assert.deepEqual(regions.values,[{value:'北区',count:1275}]);
  assert.throws(()=>evidence.distinctValues(dataset,view,{field:'不存在'}));
  assert.throws(()=>evidence.distinctValues(dataset,view,{field:'城市',limit:51}));
});

test('缺失分类独立计数，真实的未填写文本不与空值合并',()=>{
  assert.equal(typeof evidence.distinctValues,'function');
  const data={...dataset,rows:[null,' ','未填写','001','001','002'].map((value,i)=>({...dataset.rows[i],城市:value}))};
  const result=evidence.distinctValues(data,view,{field:'城市'});
  assert.equal(result.missingRows,2);assert.equal(result.total,3);
  assert.deepEqual(result.values,[{value:'未填写',count:1},{value:'001',count:2},{value:'002',count:1}]);
});

test('名单意图按实际字段精确匹配，当前数据本身不等于工作台当前筛选',()=>{
  assert.deepEqual(enumerationRequirements(dataset,'当前数据有哪些城市？'),[{field:'城市',scope:'all'}]);
  assert.deepEqual(enumerationRequirements(dataset,'当前筛选有哪些课程？'),[{field:'课程',scope:'current'}]);
  const overlapping={...dataset,dimensions:[...dataset.dimensions,{key:'城市编号',type:'text'}]};
  assert.deepEqual(enumerationRequirements(overlapping,'列出城市编号'),[{field:'城市编号',scope:'all'}]);
});

test('带条件谓词的名单问题不被误作字段全取值要求，条件前置后置及不同领域一致',()=>{
  for (const request of [
    '有哪些城市缺失营业日期？',
    '有哪些课程的数量为空？',
    '有哪些编号需要核对？',
    '有哪些区域没有记录？',
    '数量异常的课程有哪些？',
    '北区有哪些城市？',
    '编号为ID001的课程有哪些？',
    '有哪些城市数量为0？',
    '有哪些城市的数量？',
    '有哪些城市数量？',
  ]) assert.deepEqual(enumerationRequirements(dataset,request),[],request);
  assert.deepEqual(enumerationRequirements(dataset,'请把所有课程完整列出来。'),[{field:'课程',scope:'all'}]);
  assert.deepEqual(enumerationRequirements(dataset,'这份数据里包含哪些区域？'),[{field:'区域',scope:'all'}]);
  assert.deepEqual(enumerationRequirements(dataset,'城市和区域分别有哪些？'),[{field:'城市',scope:'all'},{field:'区域',scope:'all'}]);
});

test('分页覆盖不把重复页、遗漏页或额外筛选的分类当作查全',()=>{
  const options={requirements:[{field:'编号',scope:'all'}],request:'有哪些编号？',hasCurrentFilters:false};
  const first=evidence.distinctValues(dataset,view,{field:'编号',limit:50});
  assert.match(enumerationCompletionError({...options,observations:[first,first],answer:'所有编号的完整名单：ID001、ID002。'}),/分页|部分/);
  const narrowed=evidence.distinctValues(dataset,view,{field:'编号',filters:[{field:'城市',op:'eq',value:'城市01'}]});
  assert.match(enumerationCompletionError({...options,observations:[narrowed],answer:'编号只有ID001。'}),/尚无/);
});

async function localAgent(t,sequence,input={}) {
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    requests.push(JSON.parse(raw));
    const [name,args]=sequence[Math.min(requests.length-1,sequence.length-1)];
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({id:'local',object:'chat.completion',created:1,model:'qwen3.8-flash',choices:[{index:0,finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:`call_${requests.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const old=Object.fromEntries(['AI_BASE_URL','AI_API_KEY','AI_MODEL','AI_PROVIDER'].map(key=>[key,process.env[key]]));
  Object.assign(process.env,{AI_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,AI_API_KEY:'mock-local',AI_MODEL:'qwen3.8-flash',AI_PROVIDER:'qwen'});
  t.after(()=>{server.close();for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const result=await runAgent({dataset,view,chart:'line',text:'有哪些城市？',...input});
  return {requests,result};
}

test('Agent拒绝用原始样本或只列部分分类的回答冒充完整名单，改用去重工具查全',async t=>{
  const all=Array.from({length:15},(_,i)=>`城市${String(i+1).padStart(2,'0')}`).join('、');
  const {requests,result}=await localAgent(t,[
    ['query_records',{columns:['城市'],limit:50}],
    ['complete_response',{intent:'analyze',answer:'全表城市有城市01。'}],
    ['list_values',{field:'城市',scope:'all'}],
    ['complete_response',{intent:'analyze',answer:'全表有15个城市：城市01、城市02。'}],
    ['complete_response',{intent:'analyze',answer:`全表共15个城市：${all}。`}],
  ]);
  assert.equal(requests.length,5);
  assert.match(JSON.stringify(requests[2].messages),/list_values/);
  const rejection=JSON.parse(requests[4].messages.filter(message=>message.role==='tool').at(-1).content);
  assert.equal(rejection.ok,false);assert.match(rejection.error,/完整|遗漏|部分/);
  assert.equal(result.answer,`全表共15个城市：${all}。`);
  assert.equal(result.changed,false);assert.deepEqual(result.view,view);
});

test('Agent未取全的大分类必须说明当前范围、准确总数及只展示部分',async t=>{
  const {requests,result}=await localAgent(t,[
    ['list_values',{field:'编号',scope:'current',limit:50}],
    ['complete_response',{intent:'analyze',answer:'当前筛选共75个编号，完整名单：ID001、ID002。'}],
    ['complete_response',{intent:'analyze',answer:'当前筛选共75个编号，本次仅展示已核查名单的一部分：ID001、ID002；其余73个尚未列出，可继续分页。'}],
  ],{text:'当前筛选有哪些编号？'});
  assert.equal(requests.length,3);
  assert.match(JSON.stringify(requests[2].messages),/分页|部分/);
  assert.match(result.answer,/仅展示/);assert.match(result.answer,/75/);
});

test('Agent不能把当前筛选范围当成全数据中的分类名单',async t=>{
  const {requests,result}=await localAgent(t,[
    ['list_values',{field:'区域',scope:'current'}],
    ['complete_response',{intent:'analyze',answer:'全表只有北区。'}],
    ['list_values',{field:'区域',scope:'all'}],
    ['complete_response',{intent:'analyze',answer:'全表共有2个区域：北区、南区。'}],
  ],{text:'数据中有哪些区域？'});
  assert.equal(requests.length,4);assert.match(result.answer,/南区/);
});

test('Agent不能通过clarify意图绕过已知字段名单的证据要求',async t=>{
  const {requests,result}=await localAgent(t,[
    ['inspect_data',{}],
    ['complete_response',{intent:'clarify',answer:'全表只有北区。'}],
    ['list_values',{field:'区域',scope:'all'}],
    ['complete_response',{intent:'analyze',answer:'全表共有2个区域：北区、南区。'}],
  ],{text:'有哪些区域？'});
  assert.equal(requests.length,4);assert.match(result.answer,/南区/);
});

test('Agent可按缺失条件的去重证据回答子集，无须混入其余全表分类',async t=>{
  const subset={...dataset,rows:dataset.rows.map((row,index)=>({...row,数量:index===0?null:1}))};
  const {requests,result}=await localAgent(t,[
    ['list_values',{field:'城市',scope:'all',filters:[{field:'数量',op:'is_missing'}]}],
    ['complete_response',{intent:'analyze',answer:'全表中有1条记录缺失数量，对应城市01；其余城市没有该字段缺失记录。'}],
  ],{dataset:subset,text:'有哪些城市缺失数量？'});
  assert.equal(requests.length,2);assert.match(result.answer,/对应城市01/);
  assert.equal(result.changed,false);assert.deepEqual(result.view,view);
});

test('Agent可用原始问题记录回答课程异常子集，无须调用全量名单工具',async t=>{
  const subset={...dataset,rows:dataset.rows.map((row,index)=>({...row,数量:index===0?-1:1}))};
  const {requests,result}=await localAgent(t,[
    ['query_records',{scope:'all',issue:'negative',issueFields:['数量'],columns:['课程','数量']}],
    ['complete_response',{intent:'analyze',answer:'全表有1条数量为负的记录：课程1，数量为-1。负值需要核对业务含义。'}],
  ],{dataset:subset,text:'有哪些课程的数量为负？'});
  assert.equal(requests.length,2);assert.match(result.answer,/课程1/);
});
