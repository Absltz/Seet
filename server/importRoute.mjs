import { Router } from 'express';
import { ready } from './ai.mjs';
import { runImportAgent } from './importAgent.mjs';
import { validateRawTable } from '../src/rawTable.mjs';
import {aiFailure} from './aiFailure.mjs';

export function importRouter({run = runImportAgent, isReady = ready} = {}) {
 const router = Router();
 let active = 0;
 router.post('/', async (req,res) => {
  if (!req.user) return res.status(401).json({error:'请先登录。'});
  if (req.body?.owner !== req.user.username) return res.status(409).json({error:'登录账号已改变，请刷新后继续。'});
  if (!isReady()) return res.status(503).json({error:'AI 服务尚未配置。'});
  let table;
  try {table=validateRawTable(req.body.table);} catch(error) {return res.status(400).json({error:error.message});}
  if (req.body.text !== undefined && (typeof req.body.text !== 'string' || req.body.text.length > 12000)) return res.status(400).json({error:'分析要求最多 12000 字。'});
  if (active>=2) return res.status(429).json({error:'AI 正在处理其他导入，请稍后重试。'});
  active++;
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),180000);
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  res.set({'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders();
  const emit=event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n');};
  try { const result=await run({table,text:req.body.text||''},emit,controller.signal);emit({type:'result',result}); }
  catch(error) {
   emit({type:'error',...aiFailure(error,{aborted:controller.signal.aborted,fallback:'AI 未完成导入，请稍后重试。原始表格未被改动。'})});
  } finally {active--;clearTimeout(timer);res.end();}
 });
 return router;
}
