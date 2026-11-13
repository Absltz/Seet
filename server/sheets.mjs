import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,rename,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRawTable } from '../src/rawTable.mjs';
import { validateDataset } from '../src/data.mjs';
import { findSourceSheet } from '../src/sheets/source.mjs';
import { withAssetLock, assertAssetLive, createAssetLifecycle } from './assetLifecycle.mjs';
import {validateOriginalFile,publicSheet,versionMetadata,sheetDownload,sheetSnapshots,snapshotFor} from './sheetVersions.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const queues=new Map();
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const metadata=({id,title,revision,createdAt,updatedAt,table})=>({id,title,revision,createdAt,updatedAt,rows:table.rows.length,columns:table.headers.length});
export function sheetsRouter(options={}) {
  const root=options.root||process.env.SHEETS_STORE||fileURLToPath(new URL('../.data/sheets',import.meta.url));
  const router=Router();
  const fileFor=user=>path.join(root,createHash('sha256').update(user.username.toLowerCase()).digest('hex')+'.json');
  const read=async file=>{try {const data=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(data))throw new Error('Invalid store');return data}catch(error){if(error.code==='ENOENT')return [];throw error}};
  const load=async user=>{const file=fileFor(user);await queues.get(file);return withAssetLock(user,()=>read(file),{sheets:root})};
  const change=(user,update)=>{
    const file=fileFor(user);
    const operation=(queues.get(file)||Promise.resolve()).catch(()=>{}).then(()=>withAssetLock(user,async()=>{
      const items=await read(file),result=await update(items);
      await mkdir(root,{recursive:true});
      const temp=file+'.'+randomUUID()+'.tmp';
      try {await writeFile(temp,JSON.stringify(items),{mode:0o600});await rename(temp,file)}
      catch(error){await unlink(temp).catch(()=>{});throw error}
      return result;
    },{sheets:root}));
    const settled=operation.catch(()=>{});queues.set(file,settled);
    settled.finally(()=>{if(queues.get(file)===settled)queues.delete(file)});
    return operation;
  };
  const safe=fn=>async(req,res)=>{try{await fn(req,res)}catch(error){res.status(error.status||500).json({error:error.status?error.message:'表格暂时无法读取或保存，请稍后重试。'})}};
  router.use((req,res,next)=>{
    if(!req.user?.username)return res.status(401).json({error:'请先登录，再使用数据表格。'});
    let owner=req.get('X-Workspace-Owner');
    try{if(owner!==undefined)owner=decodeURIComponent(owner)}catch{return res.status(400).json({error:'账号请求格式不正确。'})}
    if((owner!==undefined&&owner!==req.user.username)||(Object.hasOwn(req.body||{},'owner')&&req.body.owner!==req.user.username))return res.status(409).json({error:'登录账号已改变，请刷新页面后继续。'});
    next();
  });
  const tableFor=req=>{try {return validateRawTable(req.body?.table)}catch(error){throw failure(error.message||'表格格式不正确。')}};
  const find=(items,id)=>{const item=items.find(v=>v.id===id);if(!item)throw failure('未找到这份表格。',404);return item};
  router.param('id',(req,res,next,id)=>UUID.test(id)?next():res.status(404).json({error:'未找到这份表格。'}));
  router.get('/',safe(async(req,res)=>{res.set('Cache-Control','no-store');res.json({items:(await load(req.user)).map(metadata).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))})}));
  router.post('/resolve',safe(async(req,res)=>{
    let dataset;try{dataset=validateDataset(req.body?.dataset)}catch{throw failure('当前分析的数据格式不正确。')}
    res.json({item:publicSheet(findSourceSheet(await load(req.user),dataset))});
  }));
  router.get('/:id/versions',safe(async(req,res)=>{res.set('Cache-Control','no-store');res.json(versionMetadata(find(await load(req.user),req.params.id)))}));
  router.get('/:id/download',safe(async(req,res)=>{
    const version=req.query.version??'latest';if(typeof version!=='string')throw failure('下载版本格式不正确。');
    const download=sheetDownload(find(await load(req.user),req.params.id),version);
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.attachment(download.name);res.set('Content-Type',download.mediaType);res.send(download.bytes);
  }));
  router.get('/:id',safe(async(req,res)=>{res.set('Cache-Control','no-store');res.json({item:publicSheet(find(await load(req.user),req.params.id))})}));
  router.post('/',safe(async(req,res)=>{
    const id=randomUUID(),source=tableFor(req),table={...source,projectId:source.projectId||id};
    const originalFile=validateOriginalFile(req.body?.originalFile);
    const item=await change(req.user,async items=>{await assertAssetLive(req.user,table,null,null,{sheets:root});if(items.length>=20)throw failure('每个账号最多保存 20 份表格，请先删除不再使用的表格。',409);const now=new Date().toISOString(),value={id,title:table.title,table,revision:1,createdAt:now,updatedAt:now,origin:originalFile?'imported':'saved',...(originalFile?{originalFile}:{})};value.tableVersions=[snapshotFor(value)];items.push(value);return value});
    res.status(201).json({item:publicSheet(item)});
  }));
  router.put('/:id',safe(async(req,res)=>{
    const table=tableFor(req);
    if(!Number.isSafeInteger(req.body?.revision)||req.body.revision<1)throw failure('缺少有效的表格版本，请重新打开表格。');
    const item=await change(req.user,async items=>{await assertAssetLive(req.user,table,'sheets',req.params.id,{sheets:root});const item=find(items,req.params.id);if(item.revision!==req.body.revision)throw failure('这份表格已在其他页面更新。请另存为新表格，或重新打开最新版本。',409);if(table.projectId&&item.table.projectId&&table.projectId!==item.table.projectId)throw failure('已有表格不能更换所属项目，请另存为新表格。');const history=sheetSnapshots(item);Object.assign(item,{title:table.title,table:{...table,projectId:item.table.projectId||table.projectId||item.id},revision:item.revision+1,updatedAt:new Date().toISOString()});item.tableVersions=[...history,snapshotFor(item)];return item});
    res.json({item:publicSheet(item)});
  }));
  router.delete('/:id',safe(async(req,res)=>{res.json(await createAssetLifecycle({sheets:root}).remove(req.user,'sheet',req.params.id,req.body?.token))}));
  return router;
}
