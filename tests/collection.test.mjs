import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collectionRouter} from '../server/collection.mjs';
import {createAssetLifecycle} from '../server/assetLifecycle.mjs';
import {versionMetadata} from '../server/sheetVersions.mjs';

const now='2026-11-12T02:00:00.000Z';
const dataset=(extra={})=>({title:'测试数据',source:'原文件.csv',dimensions:[{key:'地区',type:'text'}],metrics:[{key:'销量',unit:'杯'}],rows:[{name:'东',地区:'东',销量:12}],...extra});
const sheet=(extra={})=>({id:randomUUID(),title:'原始表',revision:1,createdAt:now,updatedAt:now,table:{title:'原始表',source:'原文件.csv',headers:['地区','销量（杯）'],rows:[['东',12]]},...extra});
const analysis=(data=dataset(),extra={})=>({id:randomUUID(),title:'分析记录',updatedAt:now,workspace:{dataset:data,draft:null,messages:[{role:'user',text:'分析一下'}],report:null},...extra});
const asset=(data=dataset())=>({id:randomUUID(),title:data.title,createdAt:now,updatedAt:now,dataset:data});

async function fixture(t,state={}) {
 const dir=await mkdtemp(path.join(tmpdir(),'seet-collection-'));
 const roots=Object.fromEntries(['analyses','sheets','library','lifecycle'].map(key=>[key,path.join(dir,key)]));
 const file=(key,user='A')=>path.join(roots[key],createHash('sha256').update(user.toLowerCase()).digest('hex')+'.json');
 const seed=async(key,value,user='A')=>{await mkdir(roots[key],{recursive:true});await writeFile(file(key,user),JSON.stringify(value));};
 for(const [key,value] of Object.entries(state))await seed(key,value);
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('test-user')!=='none')req.user={username:req.get('test-user')||'A'};next()});
 app.use('/api/collection',collectionRouter(roots));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const request=async(route='',body,user='A',headers={})=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/collection${route}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','test-user':user,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,...await response.json()};};
 return {roots,file,seed,request,records:async()=>JSON.parse(await readFile(file('analyses'),'utf8'))};
}

test('automatically groups a source and all its analyses, exposes lightweight current metadata',async t=>{
 const source=sheet(),projectId=source.id;source.table.projectId=projectId;
 source.originalFile={base64:'PRIVATE ATTACHMENT'};source.versions=[{table:{rows:[['HISTORICAL SECRET']]}}];
 const older=analysis(dataset({projectId,sourceSheetId:source.id}));
 const newer=analysis(dataset({projectId,sourceSheetId:source.id}),{updatedAt:'2026-11-12T03:00:00.000Z'});
 newer.workspace.report={result:{pdf:'PRIVATE PDF'}};
 const legacy=asset(dataset({projectId}));
 const orphan=sheet({title:'另一个导入',table:{...source.table,projectId:randomUUID(),rows:[['西',20]]}});
 const f=await fixture(t,{sheets:[source,orphan],analyses:[older,newer],library:{datasets:[legacy],items:[]}});
 const result=await f.request();assert.equal(result.status,200);assert.equal(result.items.length,2);
 const card=result.items.find(item=>item.id===source.id);assert.equal(card.kind,'sheet');assert.equal(card.key,'sheet:'+source.id);
 assert.equal(card.analysisId,newer.id);assert.deepEqual(card.analyses.map(item=>item.id),[newer.id,older.id]);
 assert.equal(card.rows,1);assert.equal(card.columns,2);assert.equal(card.reportCount,1);assert.equal(card.messageCount,2);
 assert.equal(card.sheetId,source.id);assert.equal(card.projectId,projectId);
 const serialized=JSON.stringify(result);for(const secret of ['PRIVATE ATTACHMENT','PRIVATE PDF','HISTORICAL SECRET','"workspace"','"table"','"dataset"'])assert.equal(serialized.includes(secret),false,secret);
 assert.equal((await f.request('/open',{owner:'A',kind:'sheet',id:source.id})).recordId,newer.id);
 assert.equal((await f.request('/open',{owner:'A',kind:'sheet',id:source.id,analysisId:older.id})).recordId,older.id);
 assert.equal((await f.request('/open',{owner:'A',kind:'sheet',id:orphan.id,analysisId:older.id})).status,404);
});

test('keeps old assets visible, resolves unique complete content, and never groups by title',async t=>{
 const source=sheet(),legacy=asset(),record=analysis();
 const unrelated=analysis(dataset({rows:[{name:'北',地区:'北',销量:8}]}));
 const missing=analysis(null,{workspace:{dataset:null,draft:null,messages:[],source:{sheetId:randomUUID(),title:'失去来源'}},title:'失去来源'});
 const f=await fixture(t,{sheets:[source],analyses:[record,unrelated,missing],library:{datasets:[legacy],items:[]}});
 const result=await f.request();assert.equal(result.items.length,3);
 assert.deepEqual(result.items.find(item=>item.id===source.id).analyses.map(item=>item.id),[record.id]);
 assert.ok(result.items.some(item=>item.id===unrelated.id));assert.ok(result.items.some(item=>item.id===missing.id));
 assert.equal((await f.request('/open',{kind:'analysis',id:missing.id})).recordId,missing.id);
});

test('does not guess between ambiguous content or contradictory project identities',async t=>{
 const first=sheet(),second=sheet();
 const record=analysis();const a=analysis(dataset({projectId:randomUUID()}));
 const f=await fixture(t,{sheets:[first,second],analyses:[record,a]});
 assert.equal((await f.request()).items.length,4);
});

test('legacy analyses without a separate source remain one card after raw-table migration and delete together',async t=>{
 const data={title:'旧分析',metrics:[{key:'销量',unit:'杯'}],rows:[{name:'周一',销量:12}]};
 const first=analysis(data),second=analysis(data),chart={id:randomUUID(),title:'旧图表',dataset:data};
 const f=await fixture(t,{analyses:[first,second],library:{datasets:[],items:[chart]}});
 let result=await f.request();assert.equal(result.items.length,1);assert.equal(result.items[0].analyses.length,2);
 const opened=await f.request('/open',{kind:'analysis',id:first.id,target:'source'});assert.equal(opened.status,200);
 result=await f.request();assert.equal(result.items.length,1);assert.equal(result.items[0].sheetId,opened.sheetId);assert.equal(result.items[0].analyses.length,2);
 const saved=await f.records();assert.ok(saved.every(record=>record.workspace.source.sheetId===opened.sheetId));
 const plan=await createAssetLifecycle(f.roots).preview({username:'A'},'sheet',opened.sheetId);
 assert.equal(plan.counts.analyses,2);assert.equal(plan.counts.sheets,1);assert.equal(plan.counts.charts,1);
 assert.equal(JSON.parse(await readFile(f.file('library'),'utf8')).boardRevision,1,'migration invalidates stale board writes');
});

test('prefers workspace source identity and also finds draft source metadata behind an older dataset',async t=>{
 const first=sheet(),second=sheet({table:{title:'另表',headers:['别名','数量'],rows:[['西',20]]}});
 const record=analysis(dataset({sourceSheetId:first.id}),{workspace:{dataset:dataset({sourceSheetId:first.id}),draft:null,messages:[],source:{sheetId:second.id,title:second.title}}});
 const fromDraft=analysis(dataset({rows:[{name:'其他',地区:'其他',销量:99}]}));
 fromDraft.workspace.draft=dataset({sourceSheetId:first.id});
 const f=await fixture(t,{sheets:[first,second],analyses:[record,fromDraft]});
 const result=await f.request();assert.equal(result.items.length,2);
 assert.deepEqual(result.items.find(item=>item.id===second.id).analyses.map(item=>item.id),[record.id]);
 assert.deepEqual(result.items.find(item=>item.id===first.id).analyses.map(item=>item.id),[fromDraft.id]);
});

test('content fallback cannot bridge distinct projects through a legacy sheet without project metadata',async t=>{
 const source=sheet(),bound=analysis(dataset({projectId:randomUUID(),sourceSheetId:source.id})),other=analysis(dataset({projectId:randomUUID()}));
 const f=await fixture(t,{sheets:[source],analyses:[bound,other]});const result=await f.request();
 assert.equal(result.items.length,2);assert.deepEqual(result.items.find(item=>item.id===source.id).analyses.map(item=>item.id),[bound.id]);
});

test('concurrent first opens persist one source-only analysis and preserve old sheet bytes',async t=>{
 const source=sheet(),f=await fixture(t,{sheets:[source]});
 const before=await readFile(f.file('sheets'),'utf8');
 const results=await Promise.all(Array.from({length:10},()=>f.request('/open',{owner:'A',kind:'sheet',id:source.id})));
 assert.ok(results.every(result=>result.status===200));assert.equal(new Set(results.map(result=>result.recordId)).size,1);
 const records=await f.records();assert.equal(records.length,1);assert.equal(records[0].workspace.dataset,null);assert.equal(records[0].workspace.draft,null);
 assert.deepEqual(records[0].workspace.source,{sheetId:source.id,projectId:source.id,title:source.title});
 assert.match(records[0].workspace.messages[0].text,/原始|原表/);assert.equal(await readFile(f.file('sheets'),'utf8'),before);
 assert.equal((await f.request()).items.length,1);
});

test('opens legacy datasets once using a recoverable validated snapshot without changing assets',async t=>{
 const source=asset(),f=await fixture(t,{library:{datasets:[source],items:[]}});
 const before=await readFile(f.file('library'),'utf8');
 const first=await f.request('/open',{kind:'dataset',id:source.id});assert.equal(first.status,200);
 const second=await f.request('/open',{kind:'dataset',id:source.id});assert.equal(second.recordId,first.recordId);
 const record=(await f.records())[0];assert.equal(record.workspace.dataset.projectId,source.id);assert.equal(record.workspace.metricKey,'销量');assert.ok(record.workspace.view);
 assert.equal(await readFile(f.file('library'),'utf8'),before);assert.equal((await f.request()).items.length,1);
});

test('opening an orphan legacy dataset directly as source binds its newly created analysis to the persisted sheet',async t=>{
 const source=asset({title:'旧数据',metrics:[{key:'销售额',unit:'元'}],rows:[{name:'周一',销售额:100}]}),f=await fixture(t,{library:{datasets:[source],items:[]}});
 const opened=await f.request('/open',{kind:'dataset',id:source.id,target:'source'});assert.equal(opened.status,200);assert.ok(opened.sheetId);
 const record=(await f.records())[0];assert.equal(record.id,opened.recordId);assert.equal(record.workspace.source.sheetId,opened.sheetId);
 const items=(await f.request()).items;assert.equal(items.length,1);assert.equal(items[0].sheetId,opened.sheetId);assert.equal(items[0].analyses.length,1);
 assert.equal(versionMetadata(JSON.parse(await readFile(f.file('sheets'),'utf8'))[0]).versions.length,1);
});

test('isolates accounts and rejects absent auth, stale owners, bad or missing IDs',async t=>{
 const source=sheet(),f=await fixture(t,{sheets:[source]});
 assert.equal((await f.request('',undefined,'none')).status,401);
 assert.deepEqual((await f.request('',undefined,'B')).items,[]);
 for(const owner of ['B','',null,false])assert.equal((await f.request('/open',{owner,kind:'sheet',id:source.id})).status,409);
 assert.equal((await f.request('',undefined,'A',{'X-Workspace-Owner':'B'})).status,409);
 assert.equal((await f.request('',undefined,'A',{'X-Workspace-Owner':'%bad'})).status,400);
 for(const id of [source.id,randomUUID(),'bad'])assert.equal((await f.request('/open',{kind:'sheet',id},'B')).status,404);
 assert.equal((await f.request('/open',{kind:'report',id:source.id})).status,400);
});

test('does not revive deleted analyses, projects or source IDs; concurrent lifecycle deletion shares lock',async t=>{
 const source=sheet();source.table.projectId=source.id;
 const deleted=analysis(dataset({projectId:source.id}),{deletedAt:now});
 const f=await fixture(t,{sheets:[source],analyses:[deleted]});
 assert.equal((await f.request('/open',{kind:'analysis',id:deleted.id})).status,404);
 const service=createAssetLifecycle(f.roots),user={username:'A'};
 const plan=await service.preview(user,'sheet',source.id);await service.remove(user,'sheet',source.id,plan.token);
 assert.equal((await f.request('/open',{kind:'sheet',id:source.id})).status,404);
 // Even stale files cannot resurrect a project protected by its lifecycle tombstone.
 await f.seed('sheets',[source]);assert.equal((await f.request('/open',{kind:'sheet',id:source.id})).status,409);
});

test('enforces 200 live analyses when an orphan needs its first workspace',async t=>{
 const source=sheet(),records=Array.from({length:200},()=>analysis(null));
 const f=await fixture(t,{sheets:[source],analyses:records});
 assert.equal((await f.request('/open',{kind:'sheet',id:source.id})).status,409);assert.equal((await f.records()).length,200);
});

test('source opens reconstruct a labelled legacy snapshot once and persist the analysis source',async t=>{
 const record=analysis(),f=await fixture(t,{analyses:[record]});
 const results=await Promise.all(Array.from({length:5},()=>f.request('/open',{kind:'analysis',id:record.id,target:'source'})));
 assert.ok(results.every(result=>result.status===200));assert.equal(new Set(results.map(result=>result.sheetId)).size,1);assert.ok(results[0].sheetId);
 const sheets=JSON.parse(await readFile(f.file('sheets'),'utf8'));assert.equal(sheets.length,1);const source=sheets[0];
 assert.equal(source.revision,1);assert.equal(source.origin,'legacy');assert.equal(source.originalFile,undefined);assert.match(source.table.source,/历史分析.*重建/);
 assert.equal(versionMetadata(source).source.origin,'legacy');assert.equal(versionMetadata(source).versions.length,1);
 assert.deepEqual(source.table.rows,[['东',12]]);assert.deepEqual((await f.records())[0].workspace.source,{sheetId:source.id,projectId:record.id,title:source.title});
 assert.equal((await f.request()).items.length,1);
});

test('source opens return an existing sheet and reject deleted source identity behind an analysis',async t=>{
 const source=sheet(),record=analysis(dataset({sourceSheetId:source.id}));
 const f=await fixture(t,{sheets:[source],analyses:[record]});
 assert.equal((await f.request('/open',{kind:'sheet',id:source.id,target:'source'})).sheetId,source.id);
 assert.equal((await f.records())[0].workspace.source.sheetId,source.id);
 await f.seed('lifecycle',{deletedProjects:[],deletedIds:['sheets:'+source.id]});
 assert.equal((await f.request('/open',{kind:'analysis',id:record.id})).status,409);
});
