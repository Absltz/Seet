import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {validateDataset} from '../src/data.mjs';
import {defaultView} from '../src/analysis.mjs';
import {projectContent} from '../src/projectLinks.mjs';
import {tableFromDataset} from '../src/rawTable.mjs';
import {withAssetLock,assertAssetLive} from './assetLifecycle.mjs';
import {snapshotFor} from './sheetVersions.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const newest=(a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||String(a.id).localeCompare(String(b.id));
const messageCount=record=>Array.isArray(record.workspace?.messages)?record.workspace.messages.length:0;
const datasetFor=record=>record.workspace?.dataset||record.workspace?.draft||null;
async function read(file,fallback) {
 try{return JSON.parse(await readFile(file,'utf8'));}
 catch(error){if(error.code==='ENOENT')return fallback;throw error;}
}
async function load(files) {
 const [analyses,sheets,library]=await Promise.all([read(files.analyses,[]),read(files.sheets,[]),read(files.library,{datasets:[],items:[]})]);
 if(!Array.isArray(analyses)||!Array.isArray(sheets)||!Array.isArray(library.datasets))throw new Error('Invalid asset store');
 return {analyses,sheets,datasets:library.datasets,library};
}

// Group only durable identity or unambiguous full content. Titles never create links.
function collection(state) {
 const nodes=[];
 const add=(kind,item,data,source={})=>nodes.push({kind,id:item.id,item,data,projectId:source.projectId||data?.projectId||item.projectId||null,sheetId:source.sheetId||data?.sourceSheetId||null,content:projectContent(data,kind==='sheet')});
 for(const item of state.sheets)if(!item.deletedAt)add('sheet',item,item.table);
 for(const item of state.datasets)if(!item.deletedAt)add('dataset',item,item.dataset);
 for(const item of state.analyses)if(!item.deletedAt){
  const workspace=item.workspace||{};
  add('analysis',item,datasetFor(item),{...workspace.source,
   sheetId:workspace.source?.sheetId||workspace.dataset?.sourceSheetId||workspace.draft?.sourceSheetId,
   projectId:workspace.source?.projectId||workspace.dataset?.projectId||workspace.draft?.projectId});
 }
 const parent=nodes.map((_,index)=>index),root=index=>{while(parent[index]!==index){parent[index]=parent[parent[index]];index=parent[index];}return index;};
 const join=(a,b)=>{parent[root(b)]=root(a);};
 const projectNodes=new Map(),sheets=new Map(nodes.map((node,index)=>[node.kind==='sheet'?node.id:null,index]));
 nodes.forEach((node,index)=>{
  if(node.projectId){if(projectNodes.has(node.projectId))join(index,projectNodes.get(node.projectId));else projectNodes.set(node.projectId,index);}
 });
 nodes.forEach((node,index)=>{
  if(node.sheetId&&sheets.has(node.sheetId)){
   const other=sheets.get(node.sheetId),source=nodes[other];
   if(!node.projectId||!source.projectId||node.projectId===source.projectId)join(index,other);
  }
  // Orphan legacy datasets get a stable project identity on first open without rewriting the asset.
  if(node.kind==='dataset'&&!node.projectId&&projectNodes.has(node.id))join(index,projectNodes.get(node.id));
 });
 const contents=new Map();
 nodes.forEach((node,index)=>{
  // An explicit source is authoritative even if its current content has changed.
  if(!node.content||node.sheetId)return;
  if(!contents.has(node.content))contents.set(node.content,[]);
  contents.get(node.content).push(index);
 });
 for(const indices of contents.values()){
  const sources=indices.filter(index=>nodes[index].kind!=='analysis');
  // Explicit source links already joined above remain authoritative during fallback.
  // Include their group identity even when the linked analysis skips content matching.
  const roots=new Set(indices.map(root));
  const projects=new Set(nodes.filter((_,index)=>roots.has(root(index))).map(node=>node.projectId).filter(Boolean));
  const sheetGroups=new Set(sources.filter(index=>nodes[index].kind==='sheet').map(root));
  const datasetGroups=new Set(sources.filter(index=>nodes[index].kind==='dataset').map(root));
  if(projects.size>1||sheetGroups.size>1||datasetGroups.size>1)continue;
  for(const index of indices)join(sources[0]??indices[0],index);
 }
 const groups=new Map();
 nodes.forEach((node,index)=>{const key=root(index);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);});
 return [...groups.values()].map(group=>{
  const byKind=kind=>group.filter(node=>node.kind===kind).sort((a,b)=>newest(a.item,b.item));
  const source=byKind('sheet')[0]||byKind('dataset')[0]||byKind('analysis')[0];
  const analyses=byKind('analysis'),latest=analyses[0],data=source.data||latest?.data;
  const sheet=byKind('sheet')[0];
  const columns=source.kind==='sheet'?(source.data?.headers?.length||0):(data?.metrics?.length||0)+(data?(data.dimensions?.length||1):0);
  const updatedAt=group.map(node=>node.item.updatedAt||node.item.createdAt||'').sort().at(-1)||'';
  const item={key:source.kind+':'+source.id,kind:source.kind,id:source.id,title:source.item.title||data?.title||'未命名数据',
   analysisId:latest?.id||null,sheetId:sheet?.id||null,projectId:source.projectId||latest?.projectId||null,
   rows:data?.rows?.length||0,columns,messageCount:analyses.reduce((sum,node)=>sum+messageCount(node.item),0),
   reportCount:analyses.filter(node=>node.item.workspace?.report).length,updatedAt,sourceName:data?.source||source.item.title||'',
   status:analyses.some(node=>node.data)?'analyzed':'ready',
   analyses:analyses.map(node=>({id:node.id,title:node.item.title||'新的分析',updatedAt:node.item.updatedAt||'',messageCount:messageCount(node.item)}))};
  return {item,nodes:group,source,analyses};
 }).sort((a,b)=>newest(a.item,b.item));
}

async function atomicText(file,text) {
 await mkdir(path.dirname(file),{recursive:true});
 const temporary=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(temporary,text,{mode:0o600});await rename(temporary,file);}
 finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

// Use the lifecycle journal format so the shared account lock can recover interrupted writes.
async function commit(files,updates) {
 const before=await Promise.all(Object.keys(updates).map(async key=>{
  try{return {key,text:await readFile(files[key],'utf8')};}
  catch(error){if(error.code==='ENOENT')return {key,text:null};throw error;}
 }));
 const journal=files.lifecycle+'.journal';
 await atomicText(journal,JSON.stringify({version:1,before}));
 try{
  for(const [key,value] of Object.entries(updates))await atomicText(files[key],JSON.stringify(value));
  await unlink(journal);
 }catch(error){
  for(const entry of before){if(entry.text===null)await unlink(files[entry.key]).catch(error=>{if(error.code!=='ENOENT')throw error;});else await atomicText(files[entry.key],entry.text);}
  await unlink(journal);throw error;
 }
}

async function assertNodeLive(user,node,roots) {
 await assertAssetLive(user,node.data,{analysis:'analyses',sheet:'sheets',dataset:'datasets'}[node.kind],node.id,roots);
 if(node.kind==='analysis'&&node.item.workspace?.source)await assertAssetLive(user,node.item.workspace.source,'analyses',node.id,roots);
 if(node.sheetId)await assertAssetLive(user,null,'sheets',node.sheetId,roots);
}

export function collectionRouter(options={}) {
 // withAssetLock resolves the same environment/default roots as all other asset routes.
 const roots=options.roots||options;
 const router=Router();
 router.use((req,res,next)=>{
  if(!req.user?.username)return res.status(401).json({error:'请先登录，再使用数据集库。'});
  let owner=req.get('X-Workspace-Owner');
  try{if(owner!==undefined)owner=decodeURIComponent(owner);}catch{return res.status(400).json({error:'账号请求格式不正确。'});}
  if(owner!==undefined&&owner!==req.user.username||Object.hasOwn(req.body||{},'owner')&&req.body.owner!==req.user.username)
   return res.status(409).json({error:'登录账号已改变，请刷新页面后继续。'});
  next();
 });
 const safe=handler=>async(req,res)=>{try{res.set('Cache-Control','no-store');res.json(await handler(req));}
  catch(error){res.status(error.status||500).json({error:error.status?error.message:'数据集库暂时无法读取或打开，请稍后重试。'});}};
 router.get('/',safe(req=>withAssetLock(req.user,async files=>({items:collection(await load(files)).map(group=>group.item)}),roots)));
 router.post('/open',safe(async req=>{
  const {kind,id,analysisId,target}=req.body||{};
  if(!['analysis','sheet','dataset'].includes(kind))throw fail('资源类型无效。');
  if(target!==undefined&&!['source','analysis'].includes(target))throw fail('打开方式无效。');
  if(!uuid.test(id||'')||analysisId!==undefined&&!uuid.test(analysisId||''))throw fail('未找到当前账号的这项内容。',404);
  return withAssetLock(req.user,async files=>{
   const state=await load(files),groups=collection(state);
   const group=groups.find(group=>group.nodes.some(node=>node.kind===kind&&node.id===id));
   if(!group)throw fail('未找到当前账号的这项内容。',404);
   const targetNode=group.nodes.find(node=>node.kind===kind&&node.id===id);
   await assertNodeLive(req.user,targetNode,roots);
   if(analysisId!==undefined&&!group.analyses.some(node=>node.id===analysisId))throw fail('这条分析记录不属于当前数据。',404);
   const existing=analysisId|| (kind==='analysis'?id:group.item.analysisId);
   let record,changed=false;
   if(existing){
    const node=group.analyses.find(node=>node.id===existing);
    await assertNodeLive(req.user,node,roots);record=node.item;
   }else{
    if(state.analyses.filter(record=>!record.deletedAt).length>=200)throw fail('当前账号已达到 200 条分析记录上限。',409);
    const source=group.source,recordId=randomUUID(),projectId=source.projectId||source.id;
   // Check the original data before assigning identity, so legacy fingerprint tombstones still apply.
   await assertAssetLive(req.user,source.data,source.kind==='sheet'?'sheets':'datasets',source.id,roots);
   const rawSheet=group.nodes.find(node=>node.kind==='sheet');
   const sourceMetadata={...(rawSheet?{sheetId:rawSheet.id}:{}),projectId,title:source.item.title||source.data?.title||'已导入数据'};
   let data=null;
   if(source.kind==='dataset'){
    try{data={...validateDataset(source.data),source:typeof source.data.source==='string'?source.data.source.slice(0,300):'已保存数据',projectId};}
    catch{throw fail('这份旧数据无法直接恢复分析，请重新导入原始文件。',409);}
   }
   const workspace={source:sourceMetadata,dataset:data,draft:null,view:data?defaultView(data):null,
    messages:[{role:'assistant',text:data?'已恢复保存的数据，可以继续分析。':'原始数据已保留，可以继续整理并开始分析。'}],
    chart:'bar',metricKey:data?.metrics[0]?.key||'',tab:data?'chart':'data',sort:false,report:null};
    record={id:recordId,title:sourceMetadata.title,updatedAt:new Date().toISOString(),workspace};
    state.analyses.push(record);changed=true;
   }
   let sheetId=group.item.sheetId,sheetsChanged=false,libraryChanged=false,boardChanged=false;
   if(target==='source'&&sheetId){
    const source=state.sheets.find(item=>item.id===sheetId);
    await assertAssetLive(req.user,source.table,'sheets',source.id,roots);
    const metadata={sheetId,projectId:source.table.projectId||record.workspace.source?.projectId||datasetFor(record)?.projectId||source.id,title:source.title};
    if(JSON.stringify(record.workspace.source)!==JSON.stringify(metadata)){record.workspace.source=metadata;changed=true;}
   }
   if(target==='source'&&!sheetId&&datasetFor(record)){
    if(state.sheets.filter(item=>!item.deletedAt).length>=20)throw fail('每个账号最多保存 20 份表格，请先删除不再使用的表格。',409);
    const data=datasetFor(record),projectId=record.workspace.source?.projectId||data.projectId||group.source.projectId||group.source.id;
    let table;
    try{table=tableFromDataset({...data,projectId,source:'历史分析留存表格（由已保存分析重建）'});}
    catch{throw fail('这条历史分析无法重建表格，请重新导入原始文件。',409);}
    await assertAssetLive(req.user,table,null,null,roots);
    const timestamp=new Date().toISOString();sheetId=randomUUID();
    const source={id:sheetId,title:table.title,table,revision:1,createdAt:timestamp,updatedAt:timestamp,origin:'legacy'};
    source.tableVersions=[snapshotFor(source)];state.sheets.push(source);
    // The entire legacy group was already matched unambiguously. Persist that identity
    // before converting its implicit `name` column into a labelled raw table.
    record.workspace.source={sheetId,projectId,title:source.title};
    for(const node of group.analyses)node.item.workspace.source={sheetId,projectId,title:source.title};
    for(const node of group.nodes.filter(node=>node.kind==='dataset')){
     node.item.dataset={...node.item.dataset,projectId};libraryChanged=true;
    }
    const fingerprints=new Set(group.nodes.map(node=>node.content).filter(Boolean));
    for(const item of state.library.items||[]){
     const content=projectContent(item.dataset);
     if(!item.dataset?.projectId&&content&&fingerprints.has(content)&&groups.filter(candidate=>candidate.nodes.some(node=>node.content===content)).length===1){
      item.dataset={...item.dataset,projectId};libraryChanged=true;boardChanged=true;
     }
    }
    changed=true;sheetsChanged=true;
   }
   if(boardChanged)state.library.boardRevision=(state.library.boardRevision||0)+1;
   if(changed)await commit(files,{...(sheetsChanged?{sheets:state.sheets}:{}),...(libraryChanged?{library:state.library}:{}),analyses:state.analyses});
   return {recordId:record.id,...(target==='source'?{sheetId:sheetId||null}:{})};
  },roots);
 }));
 return router;
}
