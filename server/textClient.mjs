import {textModels} from './provider.mjs';

const unavailableStatuses=new Set([402,403,404,408,429]);
const reasonFor=status=>({402:'额度限制',403:'模型权限不足',404:'模型暂不可用',408:'等待响应超时',429:'模型请求受限'}[status]||'模型服务暂不可用');

// 每个任务独立创建。只重发尚未取得响应的模型请求，不重放已执行的工具。
export function createTextClient({models=textModels(),onModel=()=>{},fetchImpl=(...args)=>fetch(...args),headerTimeoutMs=30000}={}) {
 const candidates=[...new Set(models)],used=new Set();
 if(!candidates.length)throw new Error('缺少文字模型配置');
 let index=0,announced=-1,reason;
 return {
  get model(){return candidates[index];},
  get modelsUsed(){return [...used];},
  async fetch(url,init={}) {
   const body=JSON.parse(init.body);
   for(;;){
    init.signal?.throwIfAborted();
    const model=candidates[index];
    if(announced!==index){
     onModel({type:'model',model,previousModel:index?candidates[index-1]:undefined,reason,
      text:index?`${reason}，正在切换至 ${model}`:`正在调用 ${model}`});
     announced=index;
    }
    const timeout=new AbortController();
    const timer=setTimeout(()=>timeout.abort(new DOMException('等待模型响应超时','TimeoutError')),headerTimeoutMs);
    const signal=init.signal?AbortSignal.any([init.signal,timeout.signal]):timeout.signal;
    let response;
    try {
     response=await fetchImpl(url,{...init,body:JSON.stringify({...body,model}),signal});
    } catch(error) {
     if(init.signal?.aborted)throw init.signal.reason;
     if(index+1>=candidates.length || !(timeout.signal.aborted||error instanceof TypeError||error.name==='TimeoutError'))throw Object.assign(error,{model});
     reason=timeout.signal.aborted||error.name==='TimeoutError'?'等待响应超时':'模型连接中断';
     index++;
     continue;
    } finally {clearTimeout(timer);}
    if(response.ok){used.add(model);return response;}
    if(index+1>=candidates.length || !(unavailableStatuses.has(response.status)||response.status>=500))return response;
    reason=reasonFor(response.status);
    await response.body?.cancel().catch(()=>{});
    index++;
   }
  },
 };
}
