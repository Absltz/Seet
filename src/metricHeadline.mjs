import {aggregationFor,filterSource} from './analysis.mjs';
import {summarize} from './data.mjs';

export function metricHeadline(dataset,view,metricKey,stats) {
 const metric=dataset.metrics.find(item=>item.key===metricKey);
 const method=aggregationFor(metric,view?.aggregation||'auto');
 if(method==='average') {
  // 各组样本量可能不同。主指标按有效原始记录加权，不累加分组平均值。
  const source=summarize(filterSource(dataset,view),metricKey);
  return {label:`${metric.key}平均值`,value:source.average,caption:`基于 ${source.count} 个有效原始值`};
 }
 if(method==='min'||method==='max')return {label:`${metric.key}${method==='min'?'最低值':'最高值'}`,value:method==='min'?stats.min:stats.max,caption:'当前筛选范围'};
 if(method==='count')return {label:`${metric.key}有效记录数`,value:summarize(filterSource(dataset,view),metricKey).count,caption:'仅计入非空数值',unit:'条'};
 return {label:`${metric.key}合计`,value:stats.total,caption:'当前筛选范围'};
}
