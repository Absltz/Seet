function validDraftTable(table) {
  // 编辑中的草稿允许暂时空白或重复的表头。
  if(!table||typeof table.title!=='string'||typeof table.source!=='string'||!Array.isArray(table.headers)||table.headers.length<1||table.headers.length>56||table.headers.some(v=>typeof v!=='string'||v.length>60)||!Array.isArray(table.rows)||table.rows.length<1||table.rows.length>50000||table.rows.length*table.headers.length>500000)return false;
  if(table.rows.some(row=>!Array.isArray(row)||row.length!==table.headers.length||row.some(v=>!(v===null||typeof v==='string'&&v.length<=2000||typeof v==='number'&&Number.isFinite(v)))))return false;
 return true;
}
const key=(owner,scope)=>'seet:sheet-draft:'+owner+(scope?':'+scope:'');
export function readDraft(storage,owner,scope) {
 try {
  const value=JSON.parse(storage.getItem(key(owner,scope))),table=value?.table;
  if(!validDraftTable(table))return null;
  // 复用同一校验，防止把损坏的保存基线恢复进编辑器。
  const baseline=value.baseline?(validDraftTable(value.baseline)?value.baseline:null):null;
  return {table,record:value.record||null,dirty:!!value.dirty,seenIncomingId:value.seenIncomingId||null,...(baseline?{baseline}:{})};
 }catch{return null}
}
export function writeDraft(storage,owner,value,scope) {storage.setItem(key(owner,scope),JSON.stringify(value))}
export function recoverSourceDraft(storage,owner,scope,source) {
 const saved=readDraft(storage,owner,scope);
 if(saved&&(!source||saved.dirty&&saved.table.projectId===source.table.projectId&&saved.record?.id===source.item?.id))return saved;
 let detachedScope=scope?scope+':detached':null;
 if(source&&saved?.dirty&&detachedScope){
  const base=detachedScope,content=JSON.stringify([saved.table,saved.record]);let suffix=1,existing=readDraft(storage,owner,detachedScope);
  while(existing&&JSON.stringify([existing.table,existing.record])!==content){detachedScope=base+':'+suffix++;existing=readDraft(storage,owner,detachedScope);}
  try{if(!existing)writeDraft(storage,owner,saved,detachedScope)}
  catch{return {...saved,recoveryError:'草稿空间不足，已优先保留未保存的表格。请先保存，再返回当前分析。'};}
 }
 if(detachedScope&&!readDraft(storage,owner,detachedScope))detachedScope=listDrafts(storage,owner).find(item=>item.scope?.startsWith(scope+':detached'))?.scope||null;
 return source?{table:source.table,record:source.item?{id:source.item.id,revision:source.item.revision,updatedAt:source.item.updatedAt}:null,dirty:false,...(detachedScope&&readDraft(storage,owner,detachedScope)?.dirty?{detachedScope}:{})}:null;
}
export function listDrafts(storage,owner) {
 const prefix='seet:sheet-draft:'+owner;
 return Object.keys(storage).filter(key=>key===prefix||key.startsWith(prefix+':')).flatMap(key=>{const scope=key===prefix?undefined:key.slice(prefix.length+1),draft=readDraft(storage,owner,scope);return draft?.dirty?[{scope,...draft}]:[];});
}
