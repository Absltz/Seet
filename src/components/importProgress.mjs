const phases=[
 {key:'read',label:'读取并保留原表',summary:'原始单元格已读取，保留完整行列'},
 {key:'interpret_table',label:'识别字段含义',summary:'区分分类、日期、标识与数值指标'},
 {key:'configure_view',label:'计算统计并选图',summary:'确定分组、统计口径与首张图表'},
 {key:'complete_import',label:'核对分析结果',summary:'确认字段和图表工具均已成功'},
];

// 只用服务端工具事件确认完成；重做上游工具会使旧的下游结果失效。
export function importProgress(steps=[],busy=false) {
 const stages=phases.map((phase,index)=>({...phase,status:index===0?'success':'pending'}));
 for(const step of steps){
  const index=stages.findIndex(phase=>phase.key===step.tool);if(index<1)continue;
  for(let next=index+1;next<stages.length;next++)stages[next]={...phases[next],status:'pending'};
  stages[index]={...phases[index],status:step.status,summary:step.summary||phases[index].summary};
 }
 if(busy&&!stages.some(phase=>phase.status==='running'||phase.status==='error')){
  const next=stages.find(phase=>phase.status==='pending');if(next)next.status='waiting';
 }
 return {stages,completed:stages.filter(phase=>phase.status==='success').length};
}
