import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sheetsRouter} from '../server/sheets.mjs';
import {createAssetLifecycle} from '../server/assetLifecycle.mjs';
import {validateOriginalFile,sheetDownload} from '../server/sheetVersions.mjs';

const table={title:'收入表',source:'收入.xlsx',headers:['月份','收入'],rows:[['一月',12],['二月',null]]};
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'seet-versions-'));
 process.env.ANALYSIS_STORE=path.join(dir,'analyses');process.env.LIBRARY_STORE=path.join(dir,'library');process.env.ASSET_STORE=path.join(dir,'lifecycle');
 const root=path.join(dir,'sheets'),file=path.join(root,createHash('sha256').update('a').digest('hex')+'.json');
 const app=express();app.use(express.json({limit:'32mb'}));app.use((req,res,next)=>{if(req.get('test-user')!=='none')req.user={username:req.get('test-user')||'A'};next()});app.use('/api/sheets',sheetsRouter({root}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true})});
 const request=(route='',method='GET',body,user='A')=>fetch(`http://127.0.0.1:${server.address().port}/api/sheets${route}`,{method,headers:{'content-type':'application/json','test-user':user,'X-Workspace-Owner':user},...(body?{body:JSON.stringify(body)}:{})});
 const json=async(...args)=>{const r=await request(...args);return {status:r.status,...await r.json()}};
 return {root,file,request,json};
}
test('uploaded source stays byte exact and private; revisions remain downloadable with optimistic writes',async t=>{
 const f=await fixture(t),bytes=Buffer.from([0,255,13,10,34,128]),originalFile={name:'收入 原稿.xlsx',mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:bytes.toString('base64')};
 const created=await f.json('','POST',{owner:'A',table,originalFile});assert.equal(created.status,201);
 const {id}=created.item;assert.equal(created.item.source.origin,'imported');assert.deepEqual(created.item.source.originalFile,{name:originalFile.name,size:bytes.length,mediaType:originalFile.mediaType});
 assert.equal('originalFile' in created.item,false);assert.equal('tableVersions' in created.item,false);assert.equal(created.item.versions[0].revision,1);assert.equal('table' in created.item.versions[0],false);
 const download=await f.request(`/${id}/download?version=original`);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.match(download.headers.get('content-disposition'),/filename\*/);assert.match(decodeURIComponent(download.headers.get('content-disposition')),/收入 原稿.xlsx/);
 const revised={...table,title:'修订收入',rows:[['一月',99]]};
 const saved=await f.json('/'+id,'PUT',{owner:'A',table:revised,revision:1,originalFile:{...originalFile,base64:'YWJj'}});assert.equal(saved.item.revision,2);
 const parallel=await Promise.all([1,2].map(()=>f.json('/'+id,'PUT',{owner:'A',table:revised,revision:2})));assert.deepEqual(parallel.map(v=>v.status).sort(),[200,409]);
 const meta=await f.json(`/${id}/versions`);assert.equal(meta.currentRevision,3);assert.deepEqual(meta.versions.map(v=>v.revision),[1,2,3]);assert.equal(JSON.stringify(meta).includes('base64'),false);
 for(const version of meta.versions){const r=await f.request(`/${id}/download?version=${version.revision}`);assert.equal(r.status,200);const csv=await r.text();assert.match(csv,/月份,收入/);assert.match(csv,version.revision===1?/一月,12/:/一月,99/)}
 assert.match(await (await f.request(`/${id}/download?version=latest`)).text(),/一月,99/);
 assert.deepEqual(Buffer.from(await (await f.request(`/${id}/download?version=original`)).arrayBuffer()),bytes);
 assert.equal((await f.json(`/${id}/versions`,'GET',undefined,'B')).status,404);assert.equal((await f.json(`/${id}/download?version=original`,'GET',undefined,'B')).status,404);assert.equal((await f.json(`/${id}/download?version=99`)).status,404);assert.equal((await f.json(`/${id}/download?version=wat`)).status,400);
 for(const route of ['/'+id,'/resolve']){const item=route==='/resolve'?(await f.json(route,'POST',{owner:'A',dataset:{title:'收入',sourceSheetId:id,metrics:[{key:'收入'}],rows:[{name:'一月',收入:99}]}})).item:(await f.json(route)).item;assert.ok(item);assert.equal('tableVersions' in item,false);assert.equal('originalFile' in item,false)}
 const service=createAssetLifecycle({sheets:f.root}),plan=await service.preview({username:'A'},'sheet',id),deleted=await service.remove({username:'A'},'sheet',id,plan.token);
 assert.equal((await f.json(`/${id}/versions`)).status,404);await service.restore({username:'A'},deleted.deletionId);
 assert.deepEqual(Buffer.from(await (await f.request(`/${id}/download?version=original`)).arrayBuffer()),bytes);assert.equal((await f.json(`/${id}/versions`)).versions.length,3);
 const again=await service.preview({username:'A'},'sheet',id),removed=await service.remove({username:'A'},'sheet',id,again.token);await service.purge({username:'A'},removed.deletionId,true);assert.equal((await f.json(`/${id}/download?version=original`)).status,404);
});
test('old sheets expose earliest available snapshot honestly and retain it before editing',async t=>{
 const f=await fixture(t),created=await f.json('','POST',{owner:'A',table}),id=created.item.id;
 assert.equal(created.item.source.origin,'saved');
 const records=JSON.parse(await readFile(f.file,'utf8'));delete records[0].tableVersions;delete records[0].origin;delete records[0].originalFile;records[0].revision=7;await writeFile(f.file,JSON.stringify(records));
 const old=await f.json(`/${id}/versions`);assert.equal(old.source.origin,'legacy');assert.equal(old.source.originalFile,null);assert.deepEqual(old.versions.map(v=>v.revision),[7]);
 await f.json('/'+id,'PUT',{owner:'A',table:{...table,rows:[['一月',42]]},revision:7});
 const meta=await f.json(`/${id}/versions`);assert.deepEqual(meta.versions.map(v=>v.revision),[7,8]);assert.equal(meta.source.origin,'legacy');assert.match(await (await f.request(`/${id}/download?version=original`)).text(),/一月,12/);assert.match(await (await f.request(`/${id}/download?version=7`)).text(),/一月,12/);
});
test('source validation rejects malformed payload and over 20MiB; safe attachment names do not become paths',async t=>{
 const f=await fixture(t);
 for(const originalFile of [{name:'x.csv',base64:'bad*'},{name:'x.csv',base64:0},{name:'x.csv',mediaType:'text/plain\r\nX-Evil: yes',base64:'YQ=='}, {name:'x',base64:Buffer.alloc(20*1024*1024+1).toString('base64')}]){const r=await f.json('','POST',{owner:'A',table,originalFile});assert.equal(r.status,400)}
 const created=await f.json('','POST',{owner:'A',table,originalFile:{name:'../../evil\r\n.csv',mediaType:'text/csv',base64:'YQ=='}});assert.equal(created.status,201);assert.doesNotMatch(created.item.source.originalFile.name,/[\\/\r\n]/);
 const r=await f.request(`/${created.item.id}/download?version=original`);assert.equal(r.status,200);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('x-evil'),null);
 assert.equal((await f.json('/'+randomUUID()+'/versions','GET',undefined,'none')).status,401);
});
test('exactly 20MiB is accepted and CSV snapshots escape commas, quotes, newlines and nulls',()=>{
 const base64=Buffer.alloc(20*1024*1024,255).toString('base64'),file=validateOriginalFile({name:'large.xlsx',base64});assert.equal(file.size,20*1024*1024);assert.equal(file.base64,base64);
 const download=sheetDownload({title:'导出',revision:1,table:{headers:['列,一','列二'],rows:[['含"引号','换\n行'],[null,1]]}},'1');
 assert.equal(download.bytes.toString('utf8'),'\uFEFF"列,一",列二\r\n"含""引号","换\n行"\r\n,1');
});
test('normalized version CSV protects formula-like text but keeps numeric values and source bytes intact',()=>{
 const source='=SUM(1,2),original\r\n',item={title:'公式文本',revision:1,originalFile:{name:'original.csv',mediaType:'text/csv',base64:Buffer.from(source).toString('base64')},table:{headers:['=标题','值'],rows:[['=SUM(1,2)',-3],['+1',1],['-2',-2],['@cmd',0],['\tformula',2],['\rformula',3],['normal',null]]}};
 const csv=sheetDownload(item,'latest').bytes.toString('utf8');
 assert.equal(csv,'\uFEFF\'=标题,值\r\n"\'=SUM(1,2)",-3\r\n\'+1,1\r\n\'-2,-2\r\n\'@cmd,0\r\n\'\tformula,2\r\n"\'\rformula",3\r\nnormal,');
 assert.equal(sheetDownload(item,'original').bytes.toString('utf8'),source);
});
