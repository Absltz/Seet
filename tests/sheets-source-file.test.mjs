import test from 'node:test';
import assert from 'node:assert/strict';

test('capture reads exact File bytes and refuses oversized files before reading',async t=>{
 const {captureSourceFile}=await import('../src/sheets/sourceFile.mjs');
 const bytes=Buffer.from([0,255,128,13,10]);let reads=0;
 class Reader {readAsDataURL(file){reads++;file.arrayBuffer().then(value=>{this.result='data:application/octet-stream;base64,'+Buffer.from(value).toString('base64');this.onload()})}}
 const previous=globalThis.FileReader;globalThis.FileReader=Reader;t.after(()=>{if(previous===undefined)delete globalThis.FileReader;else globalThis.FileReader=previous});
 const result=await captureSourceFile(new File([bytes],'原始.xlsx',{type:'application/octet-stream'}));
 assert.deepEqual(result,{name:'原始.xlsx',mediaType:'application/octet-stream',base64:bytes.toString('base64')});
 await assert.rejects(()=>captureSourceFile({name:'too-big.csv',size:20*1024*1024+1}),/20/);assert.equal(reads,1);
});
test('download uses account-scoped authenticated fetch and response attachment filename',async t=>{
 const {downloadSheetVersion}=await import('../src/sheets/sourceFile.mjs');
 const links=[],revoked=[];let request;
 t.mock.method(globalThis,'fetch',async(url,options)=>{request={url,options};return new Response('raw',{headers:{'Content-Type':'text/csv','Content-Disposition':"attachment; filename=original.csv; filename*=UTF-8''%E5%8E%9F%E7%A8%BF.csv"}})});
 t.mock.method(URL,'createObjectURL',()=> 'blob:test');t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 t.mock.method(globalThis,'setTimeout',callback=>{callback();return 0});
 const previous=globalThis.document;globalThis.document={createElement:()=>{const link={click:()=>links.push(link),remove(){}};return link},body:{append(){}}};t.after(()=>{globalThis.document=previous});
 await downloadSheetVersion('账户 A','sheet-id',7);
 assert.equal(request.url,'/api/sheets/sheet-id/download?version=7');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.headers['X-Workspace-Owner'],encodeURIComponent('账户 A'));assert.equal(links[0].download,'原稿.csv');assert.deepEqual(revoked,['blob:test']);
});
test('download surfaces API errors and rejects non-attachment responses without saving',async t=>{
 const {downloadSheetVersion}=await import('../src/sheets/sourceFile.mjs');
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({error:'记录不存在'}),{status:404,headers:{'Content-Type':'application/json'}}));
 await assert.rejects(()=>downloadSheetVersion('A','id','original'),/记录不存在/);
 globalThis.fetch=async()=>new Response('<html>not API</html>',{headers:{'Content-Type':'text/html'}});
 await assert.rejects(()=>downloadSheetVersion('A','id','latest'),/下载|附件/);
});
