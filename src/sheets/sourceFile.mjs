export const MAX_SOURCE_FILE_BYTES=20*1024*1024;
export async function captureSourceFile(file) {
 if(!file||typeof file.name!=='string'||!Number.isSafeInteger(file.size)||file.size<0)throw new Error('请选择有效的原始文件。');
 if(file.size>MAX_SOURCE_FILE_BYTES)throw new Error('原始文件最多支持 20 MiB，请拆分后导入。');
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('原始文件读取失败，请重新选择文件。'));
  reader.onabort=()=>reject(new Error('原始文件读取已取消。'));
  reader.onload=()=>{
   const result=reader.result,index=typeof result==='string'?result.indexOf(';base64,'):-1;
   if(index<0)return reject(new Error('原始文件读取失败，请重新选择文件。'));
   resolve({name:file.name,mediaType:file.type||'application/octet-stream',base64:result.slice(index+8)});
  };
  reader.readAsDataURL(file);
 });
}
function attachmentFilename(disposition) {
 let name;
 const extended=disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
 if(extended)try{name=decodeURIComponent(extended[1].trim())}catch{}
 if(!name){const plain=disposition.match(/filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i);name=plain?.[1]?.replace(/\\(.)/g,'$1')||plain?.[2]?.trim()}
 return (name||'数据表格.csv').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f<>:"|?*]/g,'_').replace(/[. ]+$/g,'').slice(0,180)||'数据表格.csv';
}
export async function downloadSheetVersion(owner,id,version='latest') {
 if(typeof owner!=='string'||!owner||typeof id!=='string'||!id)throw new Error('请先打开当前账号的表格。');
 const selected=String(version);
 if(!['original','latest'].includes(selected)&&!(/^[1-9]\d*$/.test(selected)&&Number.isSafeInteger(Number(selected))))throw new Error('下载版本格式不正确。');
 let response;
 try{response=await fetch(`/api/sheets/${encodeURIComponent(id)}/download?version=${encodeURIComponent(selected)}`,{credentials:'same-origin',headers:{'X-Workspace-Owner':encodeURIComponent(owner)},signal:AbortSignal.timeout(50000)})}
 catch{throw new Error('无法下载文件，请检查服务连接后重试。')}
 if(!response.ok){
  if(response.status===401&&typeof window!=='undefined')window.dispatchEvent(new Event('seet:auth-expired'));
  let result;try{result=await response.json()}catch{}
  const error=new Error(result?.error||'文件下载失败，请重新打开表格后重试。');error.status=response.status;throw error;
 }
 const disposition=response.headers.get('content-disposition')||'';
 if(!/^attachment(?:;|$)/i.test(disposition))throw new Error('下载接口未返回有效附件，请重启作品服务后重试。');
 const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
 try{link.href=url;link.download=attachmentFilename(disposition);document.body.append(link);link.click()}
 finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
