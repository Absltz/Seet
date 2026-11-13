import test from 'node:test';
import assert from 'node:assert/strict';
import {metricHeadline} from '../src/metricHeadline.mjs';
import {buildView} from '../src/analysis.mjs';
import {summarize} from '../src/data.mjs';
const data={title:'成绩',dimensions:[{key:'课程',type:'text'}],metrics:[{key:'总评',unit:'分'}],rows:[{name:'甲',课程:'数学',总评:60},{name:'乙',课程:'数学',总评:100},{name:'丙',课程:'英语',总评:50}]};
test('平均分主指标按有效原始记录计算，不把分组均分相加或再次无权平均',()=>{
 const view={groupBy:'课程',granularity:'none',aggregation:'average',filters:[]};
 const stats=summarize(buildView(data,view),'总评'),head=metricHeadline(data,view,'总评',stats);
 assert.equal(head.label,'总评平均值');assert.equal(head.value,70);assert.notEqual(head.value,stats.total);assert.notEqual(head.value,stats.average);
});
test('求和指标和极值口径保持对应语义，空值不参与平均',()=>{
 const view={groupBy:'课程',granularity:'none',aggregation:'sum',filters:[]};
 const sum=metricHeadline(data,view,'总评',summarize(buildView(data,view),'总评'));assert.equal(sum.value,210);assert.equal(sum.label,'总评合计');
 const minView={...view,aggregation:'min'};const min=metricHeadline(data,minView,'总评',summarize(buildView(data,minView),'总评'));assert.equal(min.value,50);assert.equal(min.label,'总评最低值');
});
