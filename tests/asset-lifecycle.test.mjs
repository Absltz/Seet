import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createAssetLifecycle,assertAssetLive,withAssetLock} from '../server/assetLifecycle.mjs';

async function fixture(options={}) {
 const dir=await mkdtemp(path.join(tmpdir(),'seet-linked-'));
 const roots={analyses:path.join(dir,'analyses'),library:path.join(dir,'library'),sheets:path.join(dir,'sheets'),lifecycle:path.join(dir,'lifecycle')};
 const user={username:'关联测试'},hash=createHash('sha256').update(user.username).digest('hex');
 const files=Object.fromEntries(Object.entries(roots).map(([key,root])=>[key,path.join(root,hash+'.json')]));
 const projectId=randomUUID(),otherId=randomUUID(),a=randomUUID(),b=randomUUID(),chart=randomUUID(),dataset=randomUUID(),sheet=randomUUID();
 const data={title:'成绩',source:'成绩.xlsx',projectId,dimensions:[{key:'姓名',type:'text'}],metrics:[{key:'成绩',unit:'分'}],rows:[{name:'甲',姓名:'甲',成绩:80}]};
 const state={analyses:[{id:a,title:'成绩分析',workspace:{dataset:data,report:{result:{title:'成绩报告'}}}},{id:b,title:'独立分析',workspace:{dataset:{...data,projectId:otherId}}}],library:{datasets:[{id:dataset,title:'成绩数据',dataset:data}],items:[{id:chart,title:'成绩图表',dataset:data}],boardRevision:3},sheets:[{id:sheet,title:'原始成绩',table:{title:'原始成绩',projectId,headers:['姓名','成绩'],rows:[['甲',80]]},revision:1}]};
 for(const key of ['analyses','library','sheets']){await mkdir(roots[key],{recursive:true});await writeFile(files[key],JSON.stringify(state[key]));}
 const service=createAssetLifecycle(roots,options);
 return {service,user,files,roots,state,ids:{a,b,chart,dataset,sheet,projectId},read:async key=>JSON.parse(await readFile(files[key],'utf8'))};
}

test('预览列出分析、图表、报告、数据集和原表，取消时不写入',async()=>{
 const f=await fixture(),before=await Promise.all(['analyses','library','sheets'].map(key=>readFile(f.files[key],'utf8')));
 const p=await f.service.preview(f.user,'analysis',f.ids.a);
 assert.deepEqual(p.counts,{analyses:1,charts:1,reports:1,datasets:1,sheets:1});assert.equal(p.items.analyses[0].id,f.ids.a);assert.ok(p.token);
 assert.deepEqual(await Promise.all(['analyses','library','sheets'].map(key=>readFile(f.files[key],'utf8'))),before);
});
test('确认删除整组，其他明确项目同内容仍独立；撤销恢复整组',async()=>{
 const f=await fixture(),p=await f.service.preview(f.user,'analysis',f.ids.a);
 const result=await f.service.remove(f.user,'analysis',f.ids.a,p.token);
 assert.equal((await f.read('analyses')).filter(r=>!r.deletedAt).length,1);assert.equal((await f.read('library')).items.length,0);assert.equal((await f.read('library')).datasets.length,0);assert.equal((await f.read('sheets')).length,0);
 assert.equal((await f.read('library')).boardRevision,4);
 await f.service.restore(f.user,result.deletionId);
 assert.equal((await f.read('analyses')).filter(r=>!r.deletedAt).length,2);assert.equal((await f.read('library')).items.length,1);assert.equal((await f.read('sheets')).length,1);
});
test('每种资源均可作为同组删除入口',async()=>{
 for(const [kind,key] of [['chart','chart'],['dataset','dataset'],['sheet','sheet'],['report','a']]){
  const f=await fixture(),p=await f.service.preview(f.user,kind,f.ids[key]);assert.equal(p.counts.analyses,1);assert.equal(p.counts.sheets,1);
 }
});
test('缺少确认、范围更新后的令牌或其他账号不能删除',async()=>{
 const f=await fixture();await assert.rejects(()=>f.service.remove(f.user,'analysis',f.ids.a,''),error=>error.status===409);
 const p=await f.service.preview(f.user,'analysis',f.ids.a);
 const library=await f.read('library');library.items.push({...library.items[0],id:randomUUID(),title:'新增图'});await writeFile(f.files.library,JSON.stringify(library));
 await assert.rejects(()=>f.service.remove(f.user,'analysis',f.ids.a,p.token),error=>error.status===409);
 await assert.rejects(()=>f.service.preview({username:'其他账号'},'analysis',f.ids.a),error=>error.status===404);
});
test('旧版用完整内容建立关联，重命名仍匹配，数据不同的同名不匹配',async()=>{
 const f=await fixture();delete f.state.analyses[0].workspace.dataset.projectId;delete f.state.library.items[0].dataset.projectId;
 f.state.library.items[0].dataset.title='改名的图表';
 // 第二项目的内容改为不同数据，避免故意存在的明确项目歧义。
 f.state.analyses[1].workspace.dataset.rows=[{name:'甲',姓名:'甲',成绩:99}];
 for(const key of ['analyses','library','sheets'])await writeFile(f.files[key],JSON.stringify(f.state[key]));
 const p=await f.service.preview(f.user,'analysis',f.ids.a);assert.equal(p.counts.charts,1);assert.equal(p.counts.analyses,1);assert.ok(p.legacyMatch);
});
test('跨文件写入失败回滚全部内容，不能只删除记录留下图表',async()=>{
 const f=await fixture({beforeWrite:(key,index)=>{if(index===1)throw new Error('模拟磁盘失败');}}),p=await f.service.preview(f.user,'analysis',f.ids.a);
 const before=await Promise.all(['analyses','library','sheets'].map(key=>readFile(f.files[key],'utf8')));
 await assert.rejects(()=>f.service.remove(f.user,'analysis',f.ids.a,p.token));
 assert.deepEqual(await Promise.all(['analyses','library','sheets'].map(key=>readFile(f.files[key],'utf8'))),before);
});

test('同一来源的多次分析一起删除，旧页面不能重新写回；撤销后解锁',async()=>{
 const f=await fixture();
 const rows=await f.read('analyses');rows.push({...rows[0],id:randomUUID(),title:'第二次分析'});await writeFile(f.files.analyses,JSON.stringify(rows));
 const plan=await f.service.preview(f.user,'sheet',f.ids.sheet);assert.equal(plan.counts.analyses,2);assert.equal(plan.counts.reports,2);
 const deleted=await f.service.remove(f.user,'sheet',f.ids.sheet,plan.token);
 await assert.rejects(()=>withAssetLock(f.user,()=>assertAssetLive(f.user,{projectId:f.ids.projectId},null,null,f.roots),f.roots),e=>e.status===409);
 await assert.rejects(()=>assertAssetLive(f.user,null,'analyses',f.ids.a,f.roots),e=>e.status===409);
 await f.service.restore(f.user,deleted.deletionId);
 await assertAssetLive(f.user,{projectId:f.ids.projectId},'analyses',f.ids.a,f.roots);
 assert.equal((await f.read('analyses')).filter(item=>!item.deletedAt).length,3);
});

test('多个明确来源内容相同，旧版无来源图表不擅自归属',async()=>{
 const f=await fixture();delete f.state.library.items[0].dataset.projectId;
 // fixture 共享了 data 对象，因此显式恢复其他节点的来源。
 f.state.analyses[0].workspace.dataset={...f.state.analyses[0].workspace.dataset,projectId:f.ids.projectId};
 f.state.library.datasets[0].dataset={...f.state.library.datasets[0].dataset,projectId:f.ids.projectId};
 for(const key of ['analyses','library'])await writeFile(f.files[key],JSON.stringify(f.state[key]));
 const plan=await f.service.preview(f.user,'analysis',f.ids.a);assert.equal(plan.counts.analyses,1);assert.equal(plan.counts.charts,0);
});

test('启动时恢复中断的跨文件提交，读取前先回滚',async()=>{
 const f=await fixture(),before=[];
 for(const key of ['analyses','library','sheets'])before.push({key,text:await readFile(f.files[key],'utf8')});
 before.push({key:'lifecycle',text:null});
 await mkdir(f.roots.lifecycle,{recursive:true});
 await writeFile(f.files.lifecycle+'.journal',JSON.stringify({version:1,before}));
 await writeFile(f.files.analyses,'[]');
 const service=createAssetLifecycle(f.roots);
 const plan=await service.preview(f.user,'analysis',f.ids.a);assert.equal(plan.counts.charts,1);assert.equal(plan.counts.reports,1);
 assert.equal(await readFile(f.files.analyses,'utf8'),before[0].text);
});

test('旧版相同数值但单位或括号中的字段含义不同，不能一起删除',async()=>{
 const f=await fixture(),data={title:'一元',metrics:[{key:'收入',unit:'元'}],rows:[{name:'一月',收入:1}]};
 f.state.analyses=[{id:f.ids.a,title:'一元分析',workspace:{dataset:data}}];
 f.state.library={datasets:[{id:f.ids.dataset,title:'一元',dataset:data},{id:randomUUID(),title:'一万元',dataset:{...data,metrics:[{key:'收入',unit:'万元'}]}}],items:[]};
 f.state.sheets=[];
 for(const key of ['analyses','library','sheets'])await writeFile(f.files[key],JSON.stringify(f.state[key]));
 const plan=await f.service.preview(f.user,'analysis',f.ids.a);assert.equal(plan.counts.datasets,1);
 const ds={...data,dimensions:[{key:'地区（北京）',type:'text'}],rows:[{name:'一月','地区（北京）':'东区',收入:1}]};
 f.state.analyses[0].workspace.dataset=ds;f.state.library.datasets=[{id:f.ids.dataset,title:'上海',dataset:{...ds,dimensions:[{key:'地区（上海）',type:'text'}],rows:[{name:'一月','地区（上海）':'东区',收入:1}]}}];
 for(const key of ['analyses','library'])await writeFile(f.files[key],JSON.stringify(f.state[key]));
 assert.equal((await f.service.preview(f.user,'analysis',f.ids.a)).counts.datasets,0);
});

test('被删除的旧版无来源快照不能换新 ID 回写，独立新来源仍能重导入',async()=>{
 const f=await fixture();
 f.state.analyses=[{...f.state.analyses[0],workspace:{dataset:{title:'旧数据',metrics:[{key:'收入',unit:'元'}],rows:[{name:'一月',收入:1}]}}}];
 f.state.library={datasets:[],items:[]};f.state.sheets=[];
 for(const key of ['analyses','library','sheets'])await writeFile(f.files[key],JSON.stringify(f.state[key]));
 const data=f.state.analyses[0].workspace.dataset,p=await f.service.preview(f.user,'analysis',f.ids.a),deleted=await f.service.remove(f.user,'analysis',f.ids.a,p.token);
 await assert.rejects(()=>assertAssetLive(f.user,data,'charts',randomUUID(),f.roots),e=>e.status===409);
 await assertAssetLive(f.user,{...data,projectId:randomUUID()},'charts',randomUUID(),f.roots);
 await f.service.restore(f.user,deleted.deletionId);await assertAssetLive(f.user,data,'charts',randomUUID(),f.roots);
});

test('仅来源元数据的分析随原表删除并完整恢复版本附件',async()=>{
 const f=await fixture();
 const source={projectId:f.ids.projectId,sheetId:f.ids.sheet,title:'原始成绩'};
 f.state.analyses[0].workspace={source,dataset:null,draft:null,report:{result:{title:'来源报告'}}};
 f.state.sheets[0].tableVersions=[{revision:1,table:f.state.sheets[0].table}];
 f.state.sheets[0].attachments=[{name:'原始文件.xlsx',content:'保留附件'}];
 for(const key of ['analyses','sheets'])await writeFile(f.files[key],JSON.stringify(f.state[key]));
 const plan=await f.service.preview(f.user,'sheet',f.ids.sheet);
 assert.deepEqual(plan.counts,{analyses:1,charts:1,reports:1,datasets:1,sheets:1});
 const removed=await f.service.remove(f.user,'sheet',f.ids.sheet,plan.token);
 assert.equal((await f.read('analyses')).find(item=>item.id===f.ids.a).workspace,undefined);
 await assert.rejects(()=>assertAssetLive(f.user,source,'analyses',f.ids.a,f.roots),e=>e.status===409);
 await f.service.restore(f.user,removed.deletionId);
 assert.deepEqual((await f.read('analyses'))[1].workspace,f.state.analyses[0].workspace);
 assert.deepEqual((await f.read('sheets'))[0],f.state.sheets[0]);
});

test('sourceSheetId只引用原表，冲突来源和同内容其他原表不串组',async()=>{
 const f=await fixture();
 delete f.state.sheets[0].table.projectId;
 f.state.analyses=[{id:f.ids.a,workspace:{dataset:null,draft:null,source:{sheetId:f.ids.sheet}}}];
 const otherSheet=randomUUID(),conflict=randomUUID();
 f.state.sheets.push({...f.state.sheets[0],id:otherSheet});
 f.state.library={datasets:[],items:[{id:f.ids.chart,dataset:{...f.state.library.items[0].dataset,projectId:null,sourceSheetId:otherSheet}}]};
 f.state.analyses.push({id:conflict,workspace:{source:{sheetId:otherSheet},dataset:{...f.state.library.items[0].dataset,sourceSheetId:f.ids.sheet}}});
 for(const key of ['analyses','library','sheets'])await writeFile(f.files[key],JSON.stringify(f.state[key]));
 const plan=await f.service.preview(f.user,'sheet',f.ids.sheet);
 assert.deepEqual(plan.counts,{analyses:1,charts:0,reports:0,datasets:0,sheets:1});
 const other=await f.service.preview(f.user,'sheet',otherSheet);
 assert.equal(other.counts.analyses,1);assert.equal(other.counts.charts,1);
});

test('原表引用不能覆盖相互冲突的明确项目身份',async()=>{
 const f=await fixture();
 f.state.analyses[1].workspace={source:{sheetId:f.ids.sheet,projectId:f.state.analyses[1].workspace.dataset.projectId},dataset:null,draft:null};
 await writeFile(f.files.analyses,JSON.stringify(f.state.analyses));
 const plan=await f.service.preview(f.user,'sheet',f.ids.sheet);
 assert.equal(plan.counts.analyses,1);assert.equal(plan.items.analyses[0].id,f.ids.a);
});
