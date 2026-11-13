import {Router} from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {projectContent} from '../src/projectLinks.mjs';

const queues=new Map(), kinds=new Set(['analysis','chart','dataset','sheet','report']);
const retentionDays=7,day=24*60*60*1000,retentionMs=retentionDays*day;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
function rootsFor(overrides={}) {
 const home=fileURLToPath(new URL('../.data/',import.meta.url));
 const analyses=overrides.analyses||process.env.ANALYSIS_STORE||path.join(home,'analyses');
 return Object.fromEntries(Object.entries({analyses,library:overrides.library||process.env.LIBRARY_STORE||path.join(home,'library'),sheets:overrides.sheets||process.env.SHEETS_STORE||path.join(home,'sheets'),lifecycle:overrides.lifecycle||process.env.ASSET_STORE||path.join(path.dirname(analyses),'asset-lifecycle')}).map(([key,value])=>[key,path.resolve(value)]));
}
const filesFor=(user,roots)=>Object.fromEntries(Object.entries(roots).map(([key,root])=>[key,path.join(root,hash(user.username.toLowerCase())+'.json')]));
async function textOrNull(file){try{return await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomicText(file,text){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,text,{mode:0o600});await rename(temp,file);}finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
async function recover(files) {
 const journal=files.lifecycle+'.journal',raw=await textOrNull(journal);if(!raw)return;
 const data=JSON.parse(raw);
 if(data.version!==1||!Array.isArray(data.before)||data.before.some(entry=>!Object.hasOwn(files,entry.key)||!(entry.text===null||typeof entry.text==='string')))throw new Error('资产恢复日志不正确。');
 for(const entry of data.before){if(entry.text===null)await unlink(files[entry.key]).catch(error=>{if(error.code!=='ENOENT')throw error;});else await atomicText(files[entry.key],entry.text);}
 await unlink(journal);
}
// 所有资产路由使用同一账号锁；恢复日志在每次读写前处理，避免跨文件半提交。
export function withAssetLock(user,action,overrides={}) {
 const roots=rootsFor(overrides),files=filesFor(user,roots),key=JSON.stringify(files);
 const pending=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{await recover(files);return action(files);});
 const settled=pending.catch(()=>{});queues.set(key,settled);settled.finally(()=>{if(queues.get(key)===settled)queues.delete(key);});return pending;
}
async function load(files){const defaults={analyses:[],library:{datasets:[],items:[],boardRevision:0},sheets:[],lifecycle:{deletedProjects:[],deletedIds:[],deletedGroups:[],trash:[]}};const state={};for(const key of Object.keys(defaults))state[key]=JSON.parse(await textOrNull(files[key])||JSON.stringify(defaults[key]));state.lifecycle={...defaults.lifecycle,...state.lifecycle};return state;}
async function commit(files,state,options={}) {
 const before=[];for(const key of Object.keys(files))before.push({key,text:await textOrNull(files[key])});
 await atomicText(files.lifecycle+'.journal',JSON.stringify({version:1,before}));
 try{let index=0;for(const key of Object.keys(files)){await options.beforeWrite?.(key,index++);await atomicText(files[key],JSON.stringify(state[key]));}await unlink(files.lifecycle+'.journal');}
 catch(error){try{await recover(files);}catch(recovery){throw new Error('资产保存失败，恢复日志已保留，请重启后重试。',{cause:recovery});}throw error;}
}
function fingerprint(value,raw=false) {
 const content=projectContent(value,raw);return content?hash(content):null;
}
const idsFor=backup=>Object.entries(backup.items).flatMap(([key,list])=>list.map(item=>key+':'+item.id));
const expiryFor=backup=>Date.parse(backup.deletedAt)+retentionMs;
function rememberDeletedGroups(state){
 const groups=state.lifecycle.deletedGroups;
 // 旧版备份没有分组墓碑；先补齐最小引用，清除载荷后仍可判断其他组持有的锁。
 for(const backup of state.lifecycle.trash)if(!groups.some(group=>group.id===backup.id))groups.push({id:backup.id,projectIds:backup.projectIds||[],deletedIds:idsFor(backup)});
}
function compactRecords(state){
 const recoverable=new Set(state.lifecycle.trash.map(backup=>backup.id));let changed=false;
 state.analyses=state.analyses.map(record=>{
  if(!record.deletedAt||!record.deletedBy||recoverable.has(record.deletedBy))return record;
  const minimal={id:record.id,deletedAt:record.deletedAt,deletedBy:record.deletedBy};
  if(Object.keys(record).some(key=>!Object.hasOwn(minimal,key)))changed=true;
  return minimal;
 });
 return changed;
}
function clearExpired(state,now){
 rememberDeletedGroups(state);
 const previous=state.lifecycle.trash.length;
 state.lifecycle.trash=state.lifecycle.trash.filter(backup=>expiryFor(backup)>now);
 const compacted=compactRecords(state);
 return previous!==state.lifecycle.trash.length||compacted;
}
function nodesFor(state){
 const nodes=[];
 const add=(kind,item,data,raw=false,active=true,parent=null,source={})=>nodes.push({key:kind+':'+item.id,kind,id:item.id,title:item.title||data?.title||'未命名项目',projectId:source.projectId||data?.projectId||item.projectId||null,sheetId:source.sheetId||data?.sourceSheetId||null,fingerprint:fingerprint(data,raw),active,parent,item});
 for(const record of state.analyses){const workspace=record.workspace||{},data=workspace.dataset||workspace.draft,source={projectId:workspace.source?.projectId||workspace.dataset?.projectId||workspace.draft?.projectId,sheetId:workspace.source?.sheetId||workspace.dataset?.sourceSheetId||workspace.draft?.sourceSheetId};add('analysis',record,data,false,!record.deletedAt,null,source);if(workspace.report)add('report',{id:record.id,title:workspace.report.result?.title||record.title},data,false,!record.deletedAt,'analysis:'+record.id,source);}
 for(const item of state.library.datasets)add('dataset',item,item.dataset);
 for(const item of state.library.items)add('chart',item,item.dataset);
 for(const item of state.sheets)add('sheet',item,item.table,true);
 return nodes;
}
function planFor(user,state,kind,id){
 if(!kinds.has(kind)||!uuid.test(id))throw fail('资源编号无效。',400);
 const nodes=nodesFor(state),target=nodes.find(node=>node.kind===kind&&node.id===id&&node.active);if(!target)throw fail('未找到当前账号的这项内容。',404);
 const projects=new Map();for(const node of nodes)if(node.fingerprint&&node.projectId){if(!projects.has(node.fingerprint))projects.set(node.fingerprint,new Set());projects.get(node.fingerprint).add(node.projectId);}
 // A sheet reference names the original sheet, never another snapshot with identical content.
 const unambiguous=fp=>['sheet','dataset'].every(kind=>new Set(nodes.filter(node=>node.kind===kind&&!node.sheetId&&node.fingerprint===fp).map(node=>node.projectId||node.key)).size<=1);
 const related=(a,b)=>{
  if(a.parent===b.key||b.parent===a.key)return true;
  if(a.projectId&&b.projectId)return a.projectId===b.projectId;
  if(a.sheetId&&b.kind==='sheet'&&a.sheetId===b.id||b.sheetId&&a.kind==='sheet'&&b.sheetId===a.id)return true;
  if(a.kind==='dataset'&&!a.projectId&&b.projectId===a.id||b.kind==='dataset'&&!b.projectId&&a.projectId===b.id)return true;
  return !a.sheetId&&!b.sheetId&&!!a.fingerprint&&a.fingerprint===b.fingerprint&&(projects.get(a.fingerprint)?.size||0)<=1&&unambiguous(a.fingerprint);
 };
 const selected=new Set([target.key]);let progress=true,legacyMatch=false;
 while(progress){progress=false;for(const node of nodes)if(!selected.has(node.key)&&nodes.some(other=>selected.has(other.key)&&related(node,other))){selected.add(node.key);progress=true;if(!node.projectId)legacyMatch=true;}}
 const group=nodes.filter(node=>selected.has(node.key)&&node.active),types={analysis:'analyses',chart:'charts',report:'reports',dataset:'datasets',sheet:'sheets'};
 const items={analyses:[],charts:[],reports:[],datasets:[],sheets:[]};for(const node of group)items[types[node.kind]].push({id:node.id,title:node.title});
 const counts=Object.fromEntries(Object.entries(items).map(([key,list])=>[key,list.length]));
 const token=hash(JSON.stringify([user.username.toLowerCase(),kind,id,group.map(node=>[node.key,node.item]).sort((a,b)=>a[0].localeCompare(b[0]))]));
 // 仅拦截本次实际删除的旧内容；歧义下仍存活的旧内容不能被指纹黑名单连带禁用。
 const legacyFingerprints=[...new Set(group.filter(node=>!node.projectId).map(node=>node.fingerprint).filter(Boolean))].filter(fp=>!nodes.some(node=>node.active&&!selected.has(node.key)&&!node.projectId&&node.fingerprint===fp));
 return {kind,id,title:target.title,counts,items,token,legacyMatch,legacyFingerprints,fingerprints:[...new Set(group.map(node=>node.fingerprint).filter(Boolean))],projectIds:[...new Set(group.map(node=>node.projectId).filter(Boolean))]};
}
export function createAssetLifecycle(overrides={},options={}) {
 const currentTime=()=>new Date(options.now?.()??Date.now()).getTime();
 const currentState=async files=>{
  const state=await load(files),now=currentTime();
  if(clearExpired(state,now))await commit(files,state,options);
  return {state,now};
 };
 return {
  preview:(user,kind,id)=>withAssetLock(user,async files=>planFor(user,(await currentState(files)).state,kind,id),overrides),
  trash:user=>withAssetLock(user,async files=>{
   const {state,now}=await currentState(files);
   const items=state.lifecycle.trash.map(backup=>({id:backup.id,title:backup.title,deletedAt:backup.deletedAt,expiresAt:new Date(expiryFor(backup)).toISOString(),remainingDays:Math.ceil((expiryFor(backup)-now)/day),counts:Object.fromEntries(Object.entries(backup.items).map(([key,list])=>[key,list.length])),items:backup.items})).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));
   return {items,retentionDays};
  },overrides),
  remove:(user,kind,id,token)=>withAssetLock(user,async files=>{
   const {state,now}=await currentState(files),plan=planFor(user,state,kind,id);
   if(!token||token!==plan.token)throw fail('关联内容已变化，请重新核对删除范围并确认。');
   const ids=Object.fromEntries(Object.entries(plan.items).map(([key,list])=>[key,new Set(list.map(item=>item.id))]));
   const deletionId=randomUUID(),deletedAt=new Date(now).toISOString();
   const backup={id:deletionId,title:plan.title,deletedAt,expiresAt:new Date(now+retentionMs).toISOString(),items:plan.items,projectIds:plan.projectIds,analyses:state.analyses.filter(item=>ids.analyses.has(item.id)),datasets:state.library.datasets.filter(item=>ids.datasets.has(item.id)),charts:state.library.items.filter(item=>ids.charts.has(item.id)),sheets:state.sheets.filter(item=>ids.sheets.has(item.id))};
   state.analyses=state.analyses.map(item=>ids.analyses.has(item.id)?{id:item.id,title:item.title,updatedAt:item.updatedAt,deletedAt,deletedBy:deletionId}:item);
   state.library.datasets=state.library.datasets.filter(item=>!ids.datasets.has(item.id));state.library.items=state.library.items.filter(item=>!ids.charts.has(item.id));
   if(ids.charts.size)state.library.boardRevision=(state.library.boardRevision||0)+1;
   state.sheets=state.sheets.filter(item=>!ids.sheets.has(item.id));
   state.lifecycle.deletedProjects=[...new Set([...state.lifecycle.deletedProjects,...plan.projectIds])];
   state.lifecycle.deletedIds=[...new Set([...state.lifecycle.deletedIds,...Object.entries(plan.items).flatMap(([key,list])=>list.map(item=>key+':'+item.id))])];
   state.lifecycle.deletedFingerprints=[...(state.lifecycle.deletedFingerprints||[]),...plan.legacyFingerprints.map(fingerprint=>({fingerprint,deletionId}))];
   state.lifecycle.trash.push(backup);rememberDeletedGroups(state);
   await commit(files,state,options);return {...plan,deletionId,canUndo:true};
  },overrides),
  restore:(user,deletionId)=>withAssetLock(user,async files=>{
   const {state}=await currentState(files),backup=state.lifecycle.trash.find(item=>item.id===deletionId);if(!backup)throw fail('撤销记录已失效。',404);
   if(backup.analyses.some(item=>state.analyses.some(other=>other.id===item.id&&!other.deletedAt)))throw fail('相同编号的分析已存在，无法覆盖恢复。');
   for(const [key,current] of [['datasets',state.library.datasets],['charts',state.library.items],['sheets',state.sheets]])if(backup[key].some(item=>current.some(other=>other.id===item.id)))throw fail('相同编号的内容已存在，无法覆盖恢复。');
   if(state.analyses.filter(item=>!item.deletedAt).length+backup.analyses.length>200||state.library.items.length+backup.charts.length>24||state.sheets.length+backup.sheets.length>20)throw fail('恢复后将超过保存数量上限，请先清理其他项目后再撤销。');
   state.analyses=state.analyses.filter(item=>!backup.analyses.some(old=>old.id===item.id)).concat(backup.analyses);
   state.library.datasets.push(...backup.datasets);state.library.items.push(...backup.charts);if(backup.charts.length)state.library.boardRevision=(state.library.boardRevision||0)+1;
   state.sheets.push(...backup.sheets);state.lifecycle.trash=state.lifecycle.trash.filter(item=>item.id!==deletionId);
   const removed=new Set(idsFor(backup));state.lifecycle.deletedGroups=state.lifecycle.deletedGroups.filter(group=>group.id!==deletionId);
   const heldIds=new Set(state.lifecycle.deletedGroups.flatMap(group=>group.deletedIds)),heldProjects=new Set(state.lifecycle.deletedGroups.flatMap(group=>group.projectIds));
   state.lifecycle.deletedIds=state.lifecycle.deletedIds.filter(key=>!removed.has(key)||heldIds.has(key));state.lifecycle.deletedProjects=state.lifecycle.deletedProjects.filter(id=>!backup.projectIds.includes(id)||heldProjects.has(id));
   state.lifecycle.deletedFingerprints=(state.lifecycle.deletedFingerprints||[]).filter(entry=>entry.deletionId!==deletionId);
   await commit(files,state,options);return {items:backup.items,projectIds:backup.projectIds,title:backup.title};
  },overrides),
  purge:(user,deletionId,confirm)=>withAssetLock(user,async files=>{
   if(confirm!==true)throw fail('请再次确认永久删除，这项操作无法恢复。',400);
   const {state}=await currentState(files),backup=state.lifecycle.trash.find(item=>item.id===deletionId);if(!backup)throw fail('回收站记录已失效。',404);
   state.lifecycle.trash=state.lifecycle.trash.filter(item=>item.id!==deletionId);compactRecords(state);
   await commit(files,state,options);return {id:backup.id,title:backup.title};
  },overrides),
 };
}
export async function assertAssetLive(user,data,kind,id,overrides={}) {
 const files=filesFor(user,rootsFor(overrides)),meta=JSON.parse(await textOrNull(files.lifecycle)||'{"deletedProjects":[],"deletedIds":[]}');
 if(data?.projectId&&meta.deletedProjects.includes(data.projectId)||kind&&id&&meta.deletedIds.includes(kind+':'+id))throw fail('这份关联内容已删除，不能由旧页面重新保存。请刷新后新建项目。');
 if(data&&!data.projectId&&(meta.deletedFingerprints||[]).some(entry=>entry.fingerprint===fingerprint(data,kind==='sheets')))throw fail('这份旧版快照已删除，不能换一个编号重新保存。请从原始文件重新导入。');
}
export function assetLifecycleRouter(overrides={},options={}){
 const router=Router(),service=createAssetLifecycle(overrides,options);
 router.use((req,res,next)=>{if(req.body?.owner!==req.user.username)return res.status(409).json({error:'登录账号已改变，请刷新后继续。'});next();});
 const route=handler=>async(req,res)=>{try{res.json(await handler(req));}catch(error){res.status(error.status||500).json({error:error.status?error.message:'关联内容操作失败，未应用未完成的删除，请重试。'});}};
 router.post('/preview-delete',route(req=>service.preview(req.user,req.body.kind,req.body.id)));
 router.post('/delete',route(async req=>({...(await service.remove(req.user,req.body.kind,req.body.id,req.body.token)),owner:req.user.username})));
 router.post('/restore',route(async req=>({...await service.restore(req.user,req.body.deletionId),owner:req.user.username})));
 router.post('/trash',route(req=>service.trash(req.user)));
 router.post('/purge',route(async req=>({...await service.purge(req.user,req.body.deletionId,req.body.confirm),owner:req.user.username})));
 return router;
}
