import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAssetLifecycle,assetLifecycleRouter,assertAssetLive} from '../server/assetLifecycle.mjs';

const day=24*60*60*1000,start=Date.parse('2026-11-11T04:30:00.000Z');
async function fixture(t,{count=2,legacy=false,...options}={}) {
 const directory=await mkdtemp(path.join(tmpdir(),'seet-trash-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const roots=Object.fromEntries(['analyses','library','sheets','lifecycle'].map(key=>[key,path.join(directory,key)]));
 const user={username:'回收站账号'},clock={value:start};
 const files=Object.fromEntries(Object.entries(roots).map(([key,root])=>[key,path.join(root,createHash('sha256').update(user.username.toLowerCase()).digest('hex')+'.json')]));
 const groups=Array.from({length:count},(_,index)=>{
  const ids={analysis:randomUUID(),chart:randomUUID(),dataset:randomUUID(),sheet:randomUUID(),project:randomUUID()};
  const data={title:`保密项目${index}`,source:`原文件${index}.xlsx`,...(!legacy||index?{projectId:ids.project}:{}),dimensions:[{key:'姓名',type:'text'}],metrics:[{key:'成绩',unit:'分'}],rows:[{name:'甲',姓名:'甲',成绩:80+index}]};
  return {ids,data,analysis:{id:ids.analysis,title:`保密分析${index}`,updatedAt:new Date(start).toISOString(),workspace:{dataset:data,messages:[{role:'user',text:`原始问题${index}`}],report:{result:{title:`保密报告${index}`,pdf:`PDF_PAYLOAD_${index}`}}}},dataset:{id:ids.dataset,title:`保密数据${index}`,dataset:data},chart:{id:ids.chart,title:`保密图表${index}`,dataset:data},sheet:{id:ids.sheet,title:`保密原表${index}`,table:{title:`保密原表${index}`,...(!legacy||index?{projectId:ids.project}:{}),headers:['姓名','成绩'],rows:[['甲',80+index]]}}};
 });
 const state={analyses:groups.map(group=>group.analysis),library:{datasets:groups.map(group=>group.dataset),items:groups.map(group=>group.chart),boardRevision:3},sheets:groups.map(group=>group.sheet)};
 for(const key of Object.keys(state)){await mkdir(roots[key],{recursive:true});await writeFile(files[key],JSON.stringify(state[key]));}
 const service=createAssetLifecycle(roots,{now:()=>clock.value,...options});
 const read=async key=>JSON.parse(await readFile(files[key],'utf8'));
 const snapshot=()=>Promise.all(Object.values(files).map(file=>readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
 const remove=async(index=0)=>{const plan=await service.preview(user,'analysis',groups[index].ids.analysis);return service.remove(user,'analysis',groups[index].ids.analysis,plan.token);};
 return {roots,files,user,groups,state,service,clock,read,snapshot,remove};
}

test('七天内保留超过十组，并只列出整组名称与数量，不返回备份载荷',async t=>{
 const f=await fixture(t,{count:12}),deleted=[];
 for(let index=0;index<12;index++)deleted.push(await f.remove(index));
 assert.equal((await f.read('lifecycle')).trash.length,12);
 const listing=await f.service.trash(f.user);
 assert.equal(listing.retentionDays,7);assert.equal(listing.items.length,12);
 assert.deepEqual(new Set(listing.items.map(item=>item.id)),new Set(deleted.map(item=>item.deletionId)));
 const item=listing.items.find(item=>item.id===deleted[0].deletionId);
 assert.deepEqual(Object.keys(item).sort(),['id','title','deletedAt','expiresAt','remainingDays','counts','items'].sort());
 assert.equal(item.title,'保密分析0');assert.equal(item.deletedAt,new Date(start).toISOString());assert.equal(item.expiresAt,new Date(start+7*day).toISOString());assert.equal(item.remainingDays,7);
 assert.deepEqual(item.counts,{analyses:1,charts:1,reports:1,datasets:1,sheets:1});assert.deepEqual(item.items,deleted[0].items);
 assert.doesNotMatch(JSON.stringify(listing),/PDF_PAYLOAD|原始问题|原文件/);
 await f.service.restore(f.user,deleted[0].deletionId);
 assert.equal((await f.service.trash(f.user)).items.length,11);
});

test('旧版未存 expiresAt 的备份也按 deletedAt 精确计算七天边界',async t=>{
 const f=await fixture(t),removed=await f.remove();
 const lifecycle=await f.read('lifecycle');delete lifecycle.trash[0].expiresAt;delete lifecycle.deletedGroups;await writeFile(f.files.lifecycle,JSON.stringify(lifecycle));
 f.clock.value=start+7*day-1;
 const listing=await f.service.trash(f.user);
 assert.equal(listing.items.length,1);assert.equal(listing.items[0].remainingDays,1);assert.equal(listing.items[0].expiresAt,new Date(start+7*day).toISOString());
 const restored=await f.service.restore(f.user,removed.deletionId);
 assert.deepEqual(restored,{items:removed.items,projectIds:removed.projectIds,title:removed.title});
 assert.deepEqual((await f.read('analyses')).find(item=>item.id===f.groups[0].ids.analysis),f.groups[0].analysis);
});

test('达到七天立即拒绝恢复，清除载荷与墓碑明文并保留旧页面回写锁',async t=>{
 const f=await fixture(t),removed=await f.remove(),other=structuredClone(f.groups[1]);
 f.clock.value=start+7*day;
 await assert.rejects(()=>f.service.restore(f.user,removed.deletionId),error=>error.status===404);
 assert.deepEqual((await f.service.trash(f.user)).items,[]);
 const analyses=await f.read('analyses'),tombstone=analyses.find(item=>item.id===f.groups[0].ids.analysis);
 assert.deepEqual(Object.keys(tombstone).sort(),['id','deletedAt','deletedBy'].sort());
 assert.equal(tombstone.deletedBy,removed.deletionId);
 assert.deepEqual(analyses.find(item=>item.id===other.ids.analysis),other.analysis);
 assert.deepEqual((await f.read('library')).datasets,[other.dataset]);assert.deepEqual((await f.read('library')).items,[other.chart]);assert.deepEqual(await f.read('sheets'),[other.sheet]);
 const all=(await f.snapshot()).join('');
 assert.doesNotMatch(all,/保密分析0|保密项目0|保密报告0|保密数据0|保密图表0|保密原表0|原始问题0|PDF_PAYLOAD_0|原文件0/);
 await assert.rejects(()=>assertAssetLive(f.user,{projectId:f.groups[0].ids.project},null,null,f.roots),error=>error.status===409);
 await assert.rejects(()=>assertAssetLive(f.user,null,'analyses',f.groups[0].ids.analysis,f.roots),error=>error.status===409);
 await assertAssetLive(f.user,f.groups[1].data,'analyses',f.groups[1].ids.analysis,f.roots);
});

test('清理刚到期的一组时，较晚删除的整组仍保留完整恢复载荷',async t=>{
 const f=await fixture(t),first=await f.remove();f.clock.value=start+6*day;const second=await f.remove(1);
 f.clock.value=start+7*day;
 const listing=await f.service.trash(f.user);
 assert.deepEqual(listing.items.map(item=>item.id),[second.deletionId]);assert.equal(listing.items[0].remainingDays,6);
 assert.doesNotMatch((await f.snapshot()).join(''),/保密分析0|PDF_PAYLOAD_0/);
 await assert.rejects(()=>f.service.restore(f.user,first.deletionId),error=>error.status===404);
 await f.service.restore(f.user,second.deletionId);
 assert.deepEqual((await f.read('analyses')).find(item=>item.id===f.groups[1].ids.analysis),f.groups[1].analysis);
 assert.deepEqual((await f.read('library')).items,[f.groups[1].chart]);assert.deepEqual(await f.read('sheets'),[f.groups[1].sheet]);
});

test('过期的旧版无来源备份仍阻止换新编号回写，独立重导入不受影响',async t=>{
 const f=await fixture(t,{legacy:true});await f.remove();f.clock.value=start+7*day+1;
 await f.service.trash(f.user);
 await assert.rejects(()=>assertAssetLive(f.user,f.groups[0].data,'charts',randomUUID(),f.roots),error=>error.status===409);
 await assertAssetLive(f.user,{...f.groups[0].data,projectId:randomUUID()},'charts',randomUUID(),f.roots);
 assert.doesNotMatch((await f.snapshot()).join(''),/保密分析0|原始问题0|PDF_PAYLOAD_0/);
});

test('永久删除必须明确确认，按账号隔离，永久删除后不能恢复',async t=>{
 const f=await fixture(t),removed=await f.remove(),before=await f.snapshot(),otherUser={username:'另一账号'};
 for(const confirm of [undefined,false,'true',1])await assert.rejects(()=>f.service.purge(f.user,removed.deletionId,confirm),error=>error.status===400);
 assert.deepEqual(await f.snapshot(),before);
 assert.deepEqual(await f.service.trash(otherUser),{items:[],retentionDays:7});
 await assert.rejects(()=>f.service.purge(otherUser,removed.deletionId,true),error=>error.status===404);
 await assert.rejects(()=>f.service.restore(otherUser,removed.deletionId),error=>error.status===404);
 assert.deepEqual(await f.service.purge(f.user,removed.deletionId,true),{id:removed.deletionId,title:removed.title});
 await assert.rejects(()=>f.service.restore(f.user,removed.deletionId),error=>error.status===404);
 assert.deepEqual((await f.service.trash(f.user)).items,[]);
 assert.doesNotMatch((await f.snapshot()).join(''),/保密分析0|保密项目0|PDF_PAYLOAD_0|原始问题0/);
 await assert.rejects(()=>assertAssetLive(f.user,f.groups[0].data,'analyses',f.groups[0].ids.analysis,f.roots),error=>error.status===409);
 await assertAssetLive(f.user,f.groups[1].data,'analyses',f.groups[1].ids.analysis,f.roots);
});

test('永久删除跨文件失败后完整回滚，备份仍可恢复',async t=>{
 let fail=false;
 const f=await fixture(t,{beforeWrite:(_key,index)=>{if(fail&&index===3)throw new Error('模拟永久删除写入失败');}}),removed=await f.remove(),before=await f.snapshot();
 fail=true;await assert.rejects(()=>f.service.purge(f.user,removed.deletionId,true),/模拟永久删除写入失败/);
 assert.deepEqual(await f.snapshot(),before);
 await assert.rejects(()=>readFile(f.files.lifecycle+'.journal'),error=>error.code==='ENOENT');
 fail=false;await f.service.restore(f.user,removed.deletionId);
 assert.deepEqual((await f.read('analyses')).find(item=>item.id===f.groups[0].ids.analysis),f.groups[0].analysis);
});

test('过期清理跨文件失败会回滚，重试后整组清除',async t=>{
 let fail=false;
 const f=await fixture(t,{beforeWrite:(_key,index)=>{if(fail&&index===1)throw new Error('模拟过期清理写入失败');}});await f.remove();const before=await f.snapshot();
 f.clock.value=start+8*day;fail=true;
 await assert.rejects(()=>f.service.trash(f.user),/模拟过期清理写入失败/);
 assert.deepEqual(await f.snapshot(),before);
 fail=false;assert.deepEqual((await f.service.trash(f.user)).items,[]);
 assert.doesNotMatch((await f.snapshot()).join(''),/保密分析0|PDF_PAYLOAD_0/);
});

test('回收站读取先恢复中断事务，再进行期限判断',async t=>{
 const f=await fixture(t),removed=await f.remove(),before=await f.snapshot();
 await writeFile(f.files.lifecycle+'.journal',JSON.stringify({version:1,before:Object.keys(f.files).map((key,index)=>({key,text:before[index]}))}));
 await writeFile(f.files.analyses,'[]');await writeFile(f.files.lifecycle,JSON.stringify({deletedProjects:[],deletedIds:[],trash:[]}));
 assert.equal((await f.service.trash(f.user)).items[0].id,removed.deletionId);
 assert.deepEqual(await f.snapshot(),before);
});

test('恢复其他删除组不能提前解除永久删除组共享的来源锁',async t=>{
 const f=await fixture(t),first=await f.remove(),shared=f.groups[0].ids.project;
 const analyses=await f.read('analyses');analyses.find(item=>item.id===f.groups[1].ids.analysis).workspace.dataset.projectId=shared;
 await writeFile(f.files.analyses,JSON.stringify(analyses));
 const library=await f.read('library');library.datasets[0].dataset.projectId=shared;library.items[0].dataset.projectId=shared;await writeFile(f.files.library,JSON.stringify(library));
 const sheets=await f.read('sheets');sheets[0].table.projectId=shared;await writeFile(f.files.sheets,JSON.stringify(sheets));
 const second=await f.remove(1);
 await f.service.purge(f.user,first.deletionId,true);await f.service.restore(f.user,second.deletionId);
 await assert.rejects(()=>assertAssetLive(f.user,{projectId:shared},null,null,f.roots),error=>error.status===409);
 await assert.rejects(()=>assertAssetLive(f.user,null,'analyses',f.groups[0].ids.analysis,f.roots),error=>error.status===409);
 await assertAssetLive(f.user,null,'analyses',f.groups[1].ids.analysis,f.roots);
});

test('回收站HTTP协议核对账号并强制永久删除确认',async t=>{
 const f=await fixture(t),removed=await f.remove(),app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={username:req.get('test-user')||f.user.username};next();});
 app.use('/api/assets',assetLifecycleRouter(f.roots,{now:()=>f.clock.value}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const original=f.user.username;
 const requestAsOwner=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/assets/${route}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text()};};
 assert.equal((await requestAsOwner('trash',{owner:'错误账号'})).status,409);
 const listing=await requestAsOwner('trash',{owner:original});assert.equal(listing.status,200);assert.equal(listing.body.retentionDays,7);assert.equal(listing.body.items[0].id,removed.deletionId);
 assert.equal((await requestAsOwner('purge',{owner:original,deletionId:removed.deletionId})).status,400);
 assert.deepEqual(await requestAsOwner('purge',{owner:original,deletionId:removed.deletionId,confirm:true}),{status:200,body:{id:removed.deletionId,title:removed.title,owner:original}});
 assert.equal((await requestAsOwner('restore',{owner:original,deletionId:removed.deletionId})).status,404);
});

test('同账号同时永久删除与恢复同一组，只能有一个操作成功',async t=>{
 for(const first of ['purge','restore']){
  const f=await fixture(t),removed=await f.remove();
  const actions={purge:()=>f.service.purge(f.user,removed.deletionId,true),restore:()=>f.service.restore(f.user,removed.deletionId)};
  const results=await Promise.allSettled([actions[first](),actions[first==='purge'?'restore':'purge']()]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.status,404);
  assert.deepEqual((await f.service.trash(f.user)).items,[]);
  const record=(await f.read('analyses')).find(item=>item.id===f.groups[0].ids.analysis);
  if(first==='purge'){
   assert.equal(record.title,undefined);assert.ok(record.deletedAt);
   await assert.rejects(()=>assertAssetLive(f.user,f.groups[0].data,'analyses',record.id,f.roots),error=>error.status===409);
  }else{
   assert.deepEqual(record,f.groups[0].analysis);
   await assertAssetLive(f.user,f.groups[0].data,'analyses',record.id,f.roots);
  }
 }
});
