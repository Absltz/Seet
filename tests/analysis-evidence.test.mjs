import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDataset} from '../src/data.mjs';
import {queryRecords, qualityEvidence, statisticsEvidence} from '../server/analysisEvidence.mjs';

const data=validateDataset({
  title:'服务网点台账',dimensions:['编号','网点','区域','日期','状态'].map(key=>({key,type:key==='日期'?'date':'text'})),
  metrics:[{key:'金额',unit:'元'},{key:'订单',unit:'单'}],rows:[
    {name:'甲',编号:'001',网点:'甲',区域:'东区',日期:'2026-01-01',状态:'完成',金额:100,订单:5},
    {name:'乙',编号:'002',网点:'乙',区域:'西区',日期:'2026-01-01',状态:'停业',金额:0,订单:0},
    {name:'丙',编号:'003',网点:'丙',区域:'东区',日期:'2026-02-01',状态:'待核对',金额:null,订单:3},
    {name:'丁',编号:'004',网点:'丁',区域:null,日期:'2026-02-02',状态:'退款调整',金额:-12,订单:0},
    {name:'戊',编号:'005',网点:'戊',区域:' ',日期:'2026-02-03',状态:'完成',金额:80,订单:null},
    {name:'甲',编号:'001',网点:'甲',区域:'东区',日期:'2026-01-01',状态:'完成',金额:100,订单:5},
  ],
});
const current={groupBy:'网点',granularity:'none',aggregation:'sum',filters:[{field:'区域',op:'eq',value:'东区'}]};

test('质量证据把缺失数量关联到对象、字段和原始记录，零值保持有效',()=>{
  const result=qualityEvidence(data,current);
  assert.equal(result.scope,'all');assert.equal(result.rows,6);
  assert.equal(result.missing.rowCount,3);assert.equal(result.missing.cellCount,4);
  assert.deepEqual(result.missing.examples.map(r=>[r.recordNumber,r.fields,r.values.网点]),[[3,['金额'],'丙'],[4,['区域'],'丁'],[5,['区域','订单'],'戊']]);
  assert.equal(result.metrics.find(m=>m.key==='金额').missing,1);
  assert.equal(result.metrics.find(m=>m.key==='金额').zero,1);
  assert.equal(result.negative.rowCount,1);assert.equal(result.negative.examples[0].values.状态,'退款调整');
  assert.equal(result.duplicateRows,1);assert.equal(result.duplicates.examples[0].recordNumber,6);assert.equal(result.duplicates.examples[0].duplicateOf,1);
  assert.equal(result.missing.hasMore,false);
});

test('质量检查和只读钻取准确区分当前筛选与全表，不改动视图',()=>{
  const before=JSON.stringify({data,current});
  const report=qualityEvidence(data,current,{scope:'current'});
  assert.equal(report.rows,3);assert.equal(report.missing.rowCount,1);assert.equal(report.missing.examples[0].recordNumber,3);
  const details=queryRecords(data,current,{scope:'current',issue:'missing'});
  assert.equal(details.total,1);assert.equal(details.records[0].recordNumber,3);
  const all=queryRecords(data,current,{issue:'missing',issueFields:['区域']});
  assert.equal(all.total,2);assert.deepEqual(all.records.map(r=>r.recordNumber),[4,5]);
  assert.equal(JSON.stringify({data,current}),before);
});

test('原始记录查询支持分页、列投影和多条件查证，保留编号字符串及零值',()=>{
  const first=queryRecords(data,current,{filters:[{field:'区域',op:'in',value:['东区','西区']}],offset:1,limit:2,columns:['编号','网点','金额']});
  assert.equal(first.total,4);assert.equal(first.hasMore,true);assert.equal(first.nextOffset,3);
  assert.deepEqual(first.records.map(r=>r.recordNumber),[2,3]);assert.equal(first.records[0].values.编号,'002');assert.equal(first.records[0].values.金额,0);
  assert.deepEqual(Object.keys(first.records[0].values),['编号','网点','金额']);
  const next=queryRecords(data,current,{filters:[{field:'区域',op:'in',value:['东区','西区']}],offset:first.nextOffset,limit:2});
  assert.equal(next.records[0].recordNumber,6);assert.equal(next.hasMore,false);
  assert.deepEqual(queryRecords(data,current,{filters:[{field:'金额',op:'is_missing'},{field:'订单',op:'is_missing'}],match:'any'}).records.map(r=>r.recordNumber),[3,5]);
  assert.deepEqual(queryRecords(data,current,{issue:'zero',issueFields:['金额']}).records.map(r=>r.recordNumber),[2]);
  assert.equal(queryRecords(data,current,{issue:'duplicate'}).records[0].duplicateOf,1);
});

test('大量问题明确标出截断，分页能取全而不把样本当作全部',()=>{
  const large={...data,rows:Array.from({length:75},(_,i)=>({...data.rows[2],name:String(i),编号:String(i)}))};
  const report=qualityEvidence(large,current);
  assert.equal(report.missing.rowCount,75);assert.equal(report.missing.examples.length,20);assert.equal(report.missing.hasMore,true);assert.equal(report.missing.nextOffset,20);
  const rest=queryRecords(large,current,{issue:'missing',offset:20,limit:50});
  assert.equal(rest.records.length,50);assert.equal(rest.nextOffset,70);assert.equal(rest.total,75);
});

test('统计支持独立分组及范围，并返回真实汇总与分页边界',()=>{
  const before=JSON.stringify(current);
  const result=statisticsEvidence(data,current,{scope:'all',groupBy:'日期',granularity:'month',aggregation:'sum',metric:'金额',limit:1});
  assert.equal(result.matchedRows,6);assert.equal(result.rows,2);assert.equal(result.statistics.total,268);assert.equal(result.statistics.average,134);
  assert.equal(result.values[0].金额,200);assert.equal(result.hasMore,true);assert.equal(result.nextOffset,1);
  const second=statisticsEvidence(data,current,{scope:'all',groupBy:'日期',granularity:'month',aggregation:'sum',metric:'金额',offset:1});
  assert.equal(second.values[0].金额,68);
  const filtered=statisticsEvidence(data,current,{groupBy:'',metric:'金额',filters:[{field:'编号',op:'eq',value:'003'}]});
  assert.equal(filtered.matchedRows,1);assert.equal(filtered.statistics.missing,1);assert.equal(filtered.statistics.total,null);
  assert.equal(JSON.stringify(current),before);
});

test('不接受未知字段、失效范围、不完整条件或无限制大批返回',()=>{
  for(const options of [{columns:['不存在']},{filters:[{field:'不存在',op:'eq',value:'甲'}]},{filters:[{field:'网点',op:'eq'}]},{filters:[{field:'网点',op:'in',value:[]}]},{scope:'wrong'},{issueFields:['不存在']},{offset:-1},{offset:1.5},{limit:0},{limit:51}]){
    assert.throws(()=>queryRecords(data,current,options));
  }
  assert.throws(()=>statisticsEvidence(data,current,{metric:'不存在'}));
  assert.throws(()=>statisticsEvidence(data,current,{granularity:'month',groupBy:'网点'}));
});
