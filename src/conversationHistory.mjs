// 聊天渲染可以保留最近记录；报告的用户意图档案单独保存，不能静默截断。
export function questionHistoryFor(workspace={}) {
 const entries=workspace.questionHistory ?? (workspace.messages||[]).filter(m=>m?.role==='user').map(m=>m.text);
 if(!Array.isArray(entries) || entries.length>10000)throw new Error('用户消息历史格式或数量超出存储范围。');
 let characters=0;
 for(const text of entries){
  if(typeof text!=='string'||text.length>12000)throw new Error('用户消息历史格式不正确。');
  characters+=text.length;
 }
 if(characters>2000000)throw new Error('本次分析的用户消息超过存储容量，请导出后新建分析。');
 return [...entries];
}
