import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAssetLifecycle } from '../server/assetLifecycle.mjs';
import { sheetsRouter } from '../server/sheets.mjs';
const table={title:'原始学生表',source:'测试',headers:['学号','成绩'],rows:[['001',90],['002',null]]};
test('account isolation, owner guards, optimistic writes, and reload recovery', async () => {
 const directory=await mkdtemp(path.join(tmpdir(),'seet-sheets-'));
 process.env.ANALYSIS_STORE=path.join(directory,'analyses');process.env.LIBRARY_STORE=path.join(directory,'library');process.env.ASSET_STORE=path.join(directory,'lifecycle');
 const app=express(); app.use(express.json({limit:'2mb'}));
 app.use((req,res,next)=>{req.user={username:req.get('test-user')||'A'};next()});
 app.use('/api/sheets',sheetsRouter({root:directory}));
 const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/api/sheets`;
 const request=async(route='',method='GET',body,user='A',extra={})=>{const r=await fetch(base+route,{method,headers:{'content-type':'application/json','test-user':user,...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};};
 try {
  const saved=await request('','POST',{owner:'A',table}); assert.equal(saved.status,201); assert.deepEqual(saved.item.table,{...table,projectId:saved.item.id});
  const id=saved.item.id; assert.equal(saved.item.revision,1);
  const sourceData={title:'原始学生表',projectId:id,sourceSheetId:id,dimensions:[{key:'学号',type:'text'}],metrics:[{key:'成绩',unit:'分'}],rows:[{name:'001',学号:'001',成绩:90}]};
  assert.equal((await request('/resolve','POST',{owner:'A',dataset:sourceData})).item.id,id);
  assert.equal((await request('/resolve','POST',{owner:'B',dataset:sourceData},'B')).item,null);
  assert.equal((await request('/resolve','POST',{owner:'B',dataset:sourceData})).status,409);
  assert.equal((await request('','GET',null,'B')).items.length,0);
  assert.equal((await request('/'+id,'GET',null,'B')).status,404);
  assert.equal((await request('/'+id,'DELETE',null,'B')).status,404);
  assert.equal((await request('','POST',{owner:'B',table})).status,409);
  assert.equal((await request('','GET',null,'A',{'X-Workspace-Owner':'B'})).status,409);
  const listing=await request(); assert.equal(listing.items.length,1); assert.equal('table' in listing.items[0],false);
  const updated=await request('/'+id,'PUT',{owner:'A',table:{...table,title:'修订'},revision:1}); assert.equal(updated.item.revision,2); assert.equal(updated.item.table.projectId,id);
  assert.equal((await request('/'+id,'PUT',{owner:'A',table,revision:1})).status,409);
  const parallel=await Promise.all([1,2].map(()=>request('/'+id,'PUT',{owner:'A',table,revision:2})));
  assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409]);
  const fresh=express(); fresh.use((req,res,next)=>{req.user={username:'A'};next()}); fresh.use('/api/sheets',sheetsRouter({root:directory}));
  const second=fresh.listen(0,'127.0.0.1'); await new Promise(resolve=>second.once('listening',resolve));
  try { const r=await fetch(`http://127.0.0.1:${second.address().port}/api/sheets/${id}`); assert.deepEqual((await r.json()).item.table,{...table,projectId:id}); } finally {await new Promise(resolve=>second.close(resolve));}
  assert.equal((await request('/bad')).status,404);
  assert.equal((await request('/'+id,'DELETE')).status,409);
  const plan=await createAssetLifecycle({sheets:directory}).preview({username:'A'},'sheet',id);
  assert.equal((await request('/'+id,'DELETE',{owner:'A',token:plan.token})).status,200); assert.equal((await request()).items.length,0);
  assert.match((await readdir(directory)).find(name=>name.endsWith('.json')),/^[a-f0-9]{64}\.json$/);
 } finally {await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
