// Payloads stay inside the sheet asset so delete/restore transactions include every version.
export const MAX_SOURCE_FILE_BYTES=20*1024*1024;
const invalid=message=>Object.assign(new Error(message),{status:400});
export function safeFilename(value,fallback='数据表格') {
 const name=String(value||'').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f<>:"|?*]/g,'_').trim().replace(/[. ]+$/g,'').slice(0,180);
 return name||fallback;
}
export function validateOriginalFile(value) {
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||typeof value.name!=='string'||!value.name.trim()||typeof value.base64!=='string')throw invalid('原始文件格式不正确，请重新导入。');
 const mediaType=value.mediaType||'application/octet-stream';
 if(typeof mediaType!=='string'||mediaType.length>150||!/^[-\w!#$&^.+]+\/[-\w!#$&^.+]+$/.test(mediaType))throw invalid('原始文件类型不正确，请重新导入。');
 const base64=value.base64;
 if(base64.length>Math.ceil(MAX_SOURCE_FILE_BYTES/3)*4)throw invalid('原始文件最多支持 20 MiB，请拆分后导入。');
 const expectedSize=base64.length/4*3-(base64.endsWith('==')?2:base64.endsWith('=')?1:0);
 if(expectedSize>MAX_SOURCE_FILE_BYTES)throw invalid('原始文件最多支持 20 MiB，请拆分后导入。');
 if(base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw invalid('原始文件编码不正确，请重新导入。');
 const bytes=Buffer.from(base64,'base64');
 if(bytes.length>MAX_SOURCE_FILE_BYTES)throw invalid('原始文件最多支持 20 MiB，请拆分后导入。');
 if(bytes.toString('base64')!==base64)throw invalid('原始文件编码不正确，请重新导入。');
 return {name:safeFilename(value.name,'原始文件'),mediaType,size:bytes.length,base64};
}
export function snapshotFor(item) {
 return {revision:item.revision,title:item.title,createdAt:item.updatedAt||item.createdAt,table:item.table};
}
export function sheetSnapshots(item) {
 const snapshots=Array.isArray(item.tableVersions)?item.tableVersions:[];
 return (snapshots.some(value=>value.revision===item.revision)?snapshots:[...snapshots,snapshotFor(item)]).slice().sort((a,b)=>a.revision-b.revision);
}
export function versionMetadata(item) {
 const original=item.originalFile;
 return {id:item.id,title:item.title,currentRevision:item.revision,source:{origin:original?'imported':item.origin==='saved'?'saved':'legacy',originalFile:original?{name:original.name,size:original.size,mediaType:original.mediaType}:null},versions:sheetSnapshots(item).map(value=>({revision:value.revision,title:value.title,createdAt:value.createdAt,rows:value.table.rows.length,columns:value.table.headers.length}))};
}
export function publicSheet(item) {
 if(!item)return null;
 return {id:item.id,title:item.title,table:item.table,revision:item.revision,createdAt:item.createdAt,updatedAt:item.updatedAt,...versionMetadata(item)};
}
export function sheetDownload(item,version='latest') {
 if(version==='original'&&item.originalFile)return {name:item.originalFile.name,mediaType:item.originalFile.mediaType,bytes:Buffer.from(item.originalFile.base64,'base64')};
 if(!['original','latest'].includes(version)&&!(/^[1-9]\d*$/.test(version)&&Number.isSafeInteger(Number(version))))throw invalid('下载版本格式不正确。');
 const snapshots=sheetSnapshots(item),selected=version==='original'?snapshots[0]:snapshots.find(value=>value.revision===(version==='latest'?item.revision:Number(version)));
 if(!selected)throw Object.assign(new Error('未找到这份表格版本。'),{status:404});
 const cell=value=>{let text=value===null||value===undefined?'':String(value);if(typeof value==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text};
 const csv='\uFEFF'+[selected.table.headers,...selected.table.rows].map(row=>row.map(cell).join(',')).join('\r\n');
 return {name:safeFilename(selected.title)+`-v${selected.revision}.csv`,mediaType:'text/csv; charset=utf-8',bytes:Buffer.from(csv,'utf8')};
}
