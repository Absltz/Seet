import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,Download,FilePlus2,FolderOpen,LoaderCircle,Save,Sparkles,Trash2,Undo2,Upload,X} from 'lucide-react';
import Papa from 'papaparse';
import {apiRequest} from '../api.mjs';
import {useAssetDeletion} from '../components/AssetDeletion.jsx';
import {validateRawTable,tableFromDataset} from '../rawTable.mjs';
import {reportKeyFor} from '../reportState.mjs';
import {rawCategories,filteredIndexes,visibleSelection} from './categories.mjs';
import CategoryFilters from './CategoryFilters.jsx';
import {applyPaste,columnLetter,commitHistory,editedCell,emptyTable,makeHistory,redoHistory,undoHistory} from './edit.mjs';
import {readSheetFile} from './import.mjs';
import {captureSourceFile} from './sourceFile.mjs';
import SourceVersions from './SourceVersions.jsx';
import {readDraft,writeDraft,recoverSourceDraft,listDrafts} from './draft.mjs';
import './sheets.css';

const noop=()=>{},PAGE_SIZE=100;
function recover(owner,scope,source) {
 try {const saved=recoverSourceDraft(sessionStorage,owner,scope,source);if(saved)return saved}catch{}
 return source?{table:source.table,record:source.item?{id:source.item.id,revision:source.item.revision,updatedAt:source.item.updatedAt}:null,dirty:false}:{table:emptyTable(),record:null,dirty:false};
}
const isInput=target=>target instanceof HTMLElement&&!!target.closest('input,textarea,select');
function SheetWorkspace({user,onAnalyze,onNotice,onBusyChange,incomingTable,source,aiDataset,draftScope}) {
 const {requestDeletion}=useAssetDeletion();
 const owner=user.username,initial=useRef(null);
 if(!initial.current)initial.current=recover(owner,draftScope,source);
 const [history,setHistory]=useState(()=>makeHistory(initial.current.table));
 const [record,setRecord]=useState(initial.current.record),[dirty,setDirty]=useState(initial.current.dirty);
 const [categoryData,setCategoryData]=useState(()=>!source||initial.current.table.projectId===source.table.projectId&&initial.current.record?.id===source.item?.id?aiDataset:null),[selections,setSelections]=useState({});
 const [detachedScope,setDetachedScope]=useState(initial.current.detachedScope),[drafts,setDrafts]=useState([]);
 const restoredScope=useRef(null),baseline=useRef(initial.current.baseline||(!initial.current.dirty?initial.current.table:source?.table)||null);
 const [selection,setSelection]=useState({row:0,col:0}),[anchor,setAnchor]=useState({row:0,col:0});
 const [editing,setEditing]=useState(null),[page,setPage]=useState(0),[textQuery,setTextQuery]=useState('');
 const [busy,setBusy]=useState(''),[error,setError]=useState(initial.current.recoveryError||''),[library,setLibrary]=useState(null),[reading,setReading]=useState(false),[pending,setPending]=useState(null),[versionsOpen,setVersionsOpen]=useState(false);
 const live=useRef(true),operation=useRef(false),version=useRef(0),seenIncoming=useRef(initial.current.seenIncomingId||null),fileInput=useRef(null),grid=useRef(null),dialog=useRef(null);
 const callbacks=useRef({onNotice,onBusyChange});callbacks.current={onNotice,onBusyChange};
 const table=history.present,tableRef=useRef(table);tableRef.current=table;
 const blocked=!!busy||reading;
 const fields=useMemo(()=>rawCategories(table,categoryData),[table,categoryData]);
 const indexes=useMemo(()=>filteredIndexes(table,fields,selections,textQuery),[table,fields,selections,textQuery]);
 const visibleIndexSet=useMemo(()=>new Set(indexes),[indexes]);
 const filtered=!!textQuery.trim()||fields.some(field=>selections[field.key]?.length);
 const pages=Math.max(1,Math.ceil(indexes.length/PAGE_SIZE));
 useEffect(()=>{setPage(0);setEditing(null);if(indexes.length&&!indexes.includes(selection.row)){setSelection(s=>({...s,row:indexes[0]}));setAnchor(s=>({...s,row:indexes[0]}))}},[indexes]);
 useEffect(()=>{live.current=true;return()=>{live.current=false;callbacks.current.onBusyChange(false)}},[]);
 useEffect(()=>{
  try {writeDraft(sessionStorage,owner,{table,record,dirty,baseline:baseline.current,seenIncomingId:seenIncoming.current},draftScope)}
  catch {setError('浏览器草稿空间不足，请保存表格以保留修改。')}
 },[owner,table,record,dirty]);
 useEffect(()=>{
  if(library===null)return;
  const previous=document.activeElement,root=dialog.current;
  root?.querySelector('button')?.focus();
  const trap=event=>{if(event.key!=='Tab'||!root)return;const items=[...root.querySelectorAll('button:not(:disabled),input:not(:disabled)')];if(!items.length)return;const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};
  root?.addEventListener('keydown',trap);
  return()=>{root?.removeEventListener('keydown',trap);if(previous instanceof HTMLElement)previous.focus()};
 },[library!==null]);
 useEffect(()=>{const warn=event=>{if(dirty){event.preventDefault();event.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
 useEffect(()=>{setPage(p=>Math.min(p,pages-1));setSelection(s=>({row:Math.min(s.row,table.rows.length-1),col:Math.min(s.col,table.headers.length-1)}));setAnchor(s=>({row:Math.min(s.row,table.rows.length-1),col:Math.min(s.col,table.headers.length-1)}))},[pages,table.rows.length,table.headers.length]);
 const notify=message=>{if(live.current)callbacks.current.onNotice(message)};
 const reportError=err=>{if(live.current&&err.name!=='AbortError')setError(err.message||'操作未成功，请重试。')};
 const request=useCallback(async(route='',method='GET',body)=>{
  const result=await apiRequest('/api/sheets'+route,body===undefined?undefined:{...body,owner},{method,headers:{'X-Workspace-Owner':encodeURIComponent(owner),...(body===undefined?{}:{'Content-Type':'application/json'})}});
  if(!live.current)throw new DOMException('页面已关闭','AbortError');
  return result;
 },[owner]);
 const replace=(next,item=null)=>{baseline.current=next;setCategoryData(null);setSelections({});setTextQuery('');setHistory(makeHistory(next));setRecord(item?{id:item.id,revision:item.revision,updatedAt:item.updatedAt}:null);setDirty(false);setSelection({row:0,col:0});setAnchor({row:0,col:0});setPage(0);setEditing(null);setError('');version.current++};
 const loadIncoming=()=>{try{replace(validateRawTable(pending.table));setDirty(true);setPending(null)}catch(err){reportError(err)}};
 useEffect(()=>{
  if(!incomingTable?.id||seenIncoming.current===incomingTable.id)return;
  seenIncoming.current=incomingTable.id;
  if(dirty||busy||reading){setPending(incomingTable);return}
  try {replace(validateRawTable(incomingTable.table));setDirty(true)}catch(err){reportError(err)}
 },[incomingTable?.id]);
 const commit=next=>{setHistory(h=>commitHistory(h,next));setDirty(true);setError('');version.current++};
 const editCell=(row,col,value)=>{if(value===String(table.rows[row]?.[col]??''))return;const rows=table.rows.map((r,i)=>i===row?r.map((v,c)=>c===col?editedCell(value,v):v):r);commit({...table,rows})};
 const choose=(row,col,extend=false)=>{const next={row,col};setSelection(next);if(!extend)setAnchor(next);setEditing(null);setPage(Math.floor(Math.max(0,indexes.indexOf(row))/PAGE_SIZE))};
 const safeAction=fn=>{try{fn()}catch(err){reportError(err)}};
 async function run(label,fn) {
  if(operation.current)return;
  operation.current=true;setBusy(label);setError('');callbacks.current.onBusyChange(true);
  try {await fn()}catch(err){reportError(err)}finally{operation.current=false;if(live.current){setBusy('');callbacks.current.onBusyChange(false)}}
 }
 const allowReplace=()=>!dirty||window.confirm('当前表格有未保存修改。继续打开会替换当前草稿，是否继续？');
 const newTable=()=>{if(allowReplace()){replace(emptyTable());setDirty(false)}};
 const refreshLibrary=async()=>{setReading(true);setError('');try{setDrafts(listDrafts(sessionStorage,owner));setLibrary((await request()).items)}catch(err){reportError(err)}finally{if(live.current)setReading(false)}};
 const restoreDraft=scope=>{if(!allowReplace())return;const value=readDraft(sessionStorage,owner,scope);if(!value){setError('这份草稿已不存在。');return;}replace(value.table,value.record);baseline.current=value.baseline||(!value.dirty?value.table:null);setDirty(true);restoredScope.current={scope};setDetachedScope(null);setLibrary(null)};
 const open=async item=>{
  if(!allowReplace())return;
  const startVersion=version.current;setReading(true);setError('');
  try {const result=await request('/'+item.id);if(startVersion!==version.current&&!allowReplace())return;replace(result.item.table,result.item);setLibrary(null)}catch(err){reportError(err)}finally{if(live.current)setReading(false)}
 };
 const save=(asNew=false)=>run('正在保存',async()=>{
  const snapshot=validateRawTable(tableRef.current),startVersion=version.current;
  if(asNew)delete snapshot.projectId;
  const result=await request(!asNew&&record?'/'+record.id:'',!asNew&&record?'PUT':'POST',{table:snapshot,...(!asNew&&record?{revision:record.revision}:{})});
  if(!live.current)return;
  baseline.current=result.item.table;setRecord({id:result.item.id,revision:result.item.revision,updatedAt:result.item.updatedAt});
  if(startVersion===version.current){setDirty(false);setHistory(h=>({...h,present:result.item.table}));if(restoredScope.current){const scope=restoredScope.current.scope;sessionStorage.removeItem('seet:sheet-draft:'+owner+(scope?':'+scope:''));restoredScope.current=null}}
  notify(asNew?'已另存为新表格。':'表格已保存。');
 });
 const resetChanges=()=>{
  if(blocked||!dirty||!baseline.current)return;
  setHistory(makeHistory(baseline.current));setDirty(false);setEditing(null);setSelections({});setTextQuery('');setPage(0);setSelection({row:0,col:0});setAnchor({row:0,col:0});setError('');version.current++;
  notify('已撤销未保存修改，恢复到最近保存或打开的原表。');
 };
 const remove=item=>requestDeletion({owner,kind:'sheet',id:item.id,title:item.title});
 const importFile=file=>{if(!file||!allowReplace())return;run('正在保存原始文件',async()=>{
  const next=await readSheetFile(file),originalFile=await captureSourceFile(file);
  if(!live.current)return;
  const result=await request('','POST',{table:next,originalFile});
  replace(result.item.table,result.item);notify('原始文件和表格已保存到数据集库，可继续编辑或分析。');
 })};
 const paste=text=>safeAction(()=>{
  if(filtered)throw new Error('请先清除筛选后再粘贴，避免覆盖未显示的记录。');
  const next=applyPaste(table,selection,text);if(next.rows.length!==table.rows.length||next.headers.length!==table.headers.length)throw new Error('粘贴范围超出原表，请选择现有单元格范围。');commit(next);
 });
 const exportCSV=()=>safeAction(()=>{
  const valid=validateRawTable(table),csv=Papa.unparse([valid.headers,...(filtered?indexes.map(index=>valid.rows[index]):valid.rows)],{escapeFormulae:true});
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=(valid.title.replace(/[<>:"/\\|?*]/g,'_')||'数据表格')+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify('CSV 已导出；以 =、+、-、@ 开头的文本加了安全引号。');
 });
 const clearSelection=()=>{const lo=Math.min(anchor.row,selection.row),hi=Math.max(anchor.row,selection.row),c0=Math.min(anchor.col,selection.col),c1=Math.max(anchor.col,selection.col);commit({...table,rows:table.rows.map((r,i)=>!visibleIndexSet.has(i)||i<lo||i>hi?r:r.map((v,c)=>c<c0||c>c1?v:null))})};
 const travel=redo=>{setHistory(h=>redo?redoHistory(h):undoHistory(h));setDirty(true);setEditing(null);version.current++};
 const keyDown=event=>{
  if(blocked||!indexes.length||library!==null||versionsOpen||isInput(event.target))return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();travel(event.shiftKey);return}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();travel(true);return}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();return}
  const directions={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],Tab:[0,event.shiftKey?-1:1]};
  if(directions[event.key]){event.preventDefault();const [r,c]=directions[event.key];choose(indexes[Math.max(0,Math.min(indexes.length-1,indexes.indexOf(selection.row)+r))],Math.max(0,Math.min(table.headers.length-1,selection.col+c)),event.shiftKey&&event.key!=='Tab');return}
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();clearSelection();return}
  if(event.key==='Enter'||event.key==='F2'){event.preventDefault();setEditing({...selection,value:String(table.rows[selection.row]?.[selection.col]??'')});return}
  if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setEditing({...selection,value:event.key})}
 };
 const analyze=()=>run('AI 正在分析',async()=>{
  const valid=validateRawTable(tableRef.current);
  const result=await request(record?'/'+record.id:'',record?'PUT':'POST',{table:valid,...(record?{revision:record.revision}:{})});
  const saved={id:result.item.id,revision:result.item.revision,updatedAt:result.item.updatedAt};
  baseline.current=result.item.table;setRecord(saved);setDirty(false);setHistory(h=>({...h,present:result.item.table}));
  writeDraft(sessionStorage,owner,{table:result.item.table,baseline:result.item.table,record:saved,dirty:false,seenIncomingId:seenIncoming.current},draftScope);
  await onAnalyze(result.item.table,{sheetId:result.item.id});
 });
 const date=value=>new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 return <main className="sheet-page" onKeyDown={keyDown}>
  <header className="sheet-heading"><div><h1>数据表格</h1><p>{source?'跟随工作台当前数据 · 按 AI 识别的分类筛选原始记录':'保留原始数据，整理好再开始分析。'}</p></div><button className="sheet-primary" disabled={blocked} onClick={analyze}>{busy==='AI 正在分析'?<LoaderCircle className="sheet-spin" size={17}/>:<Sparkles size={17}/>}交给 AI 分析</button></header>
  {error&&<div className="sheet-alert" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={()=>setError('')}><X size={16}/></button></div>}
  {detachedScope&&<div className="sheet-pending"><span>上次自行打开的表格还有未保存草稿，已单独保留。当前展示工作台对应的原表。</span><button disabled={blocked} onClick={()=>restoreDraft(detachedScope)}>恢复未保存草稿</button></div>}
  {pending&&<div className="sheet-pending"><span>有一份传入表格等待打开。当前草稿保留在此页。</span><button disabled={blocked} onClick={()=>{if(allowReplace())loadIncoming()}}>打开传入表格</button><button aria-label="忽略传入表格" onClick={()=>setPending(null)}><X size={16}/></button></div>}
  <section className="sheet-document" aria-label="表格编辑器">
   <div className="sheet-document-bar"><div className="sheet-name"><input aria-label="表格名称" key={'title:'+table.title} defaultValue={table.title} maxLength={80} disabled={blocked} onBlur={e=>{const title=e.target.value.trim()||'未命名表格';if(title!==table.title)commit({...table,title})}} onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}}/><span className={dirty?'sheet-unsaved':''}>{busy?<><LoaderCircle className="sheet-spin" size={13}/>{busy}</>:dirty?'未保存修改':record?<><Check size={13}/>已保存 {date(record.updatedAt)}</>:'账号专属草稿'}</span></div><div className="sheet-file-actions"><button disabled={blocked} onClick={newTable}><FilePlus2 size={16}/>新建</button><button disabled={blocked} onClick={refreshLibrary}><FolderOpen size={16}/>打开</button><button disabled={blocked} onClick={()=>fileInput.current?.click()}><Upload size={16}/>导入</button><button disabled={blocked} onClick={exportCSV}><Download size={16}/>{filtered?'导出筛选 CSV':'导出 CSV'}</button><button disabled={blocked||!record} onClick={()=>setVersionsOpen(true)}><Download size={16}/>版本与下载</button><span className="sheet-separator"/><button title="恢复到最近保存或打开的原表" disabled={blocked||!dirty||!baseline.current} onClick={resetChanges}><Undo2 size={16}/>撤销修改</button><button className="sheet-save" disabled={blocked} onClick={()=>save()}><Save size={16}/>保存</button><button disabled={blocked} onClick={()=>save(true)}>另存</button></div><input hidden type="file" ref={fileInput} accept=".xlsx,.csv,.tsv,.json" onChange={e=>{const file=e.target.files?.[0];e.target.value='';importFile(file)}}/></div>
   <CategoryFilters fields={fields} selections={selections} onChange={setSelections} textQuery={textQuery} onTextQueryChange={setTextQuery} disabled={blocked} count={indexes.length} total={table.rows.length}/>
   {source?.fallback&&<div className="sheet-source-note">这条历史分析未留存可明确匹配的原文件，当前展示已保存的逐行记录。</div>}
   <div ref={grid} className={'sheet-grid'+(blocked?' sheet-grid-busy':'')} tabIndex={0} role="region" aria-label="数据网格，单击选择，双击或回车编辑，Shift 加单击选择区域，Ctrl+C 复制，Ctrl+V 粘贴" onPaste={event=>{if(blocked||isInput(event.target))return;event.preventDefault();paste(event.clipboardData.getData('text/plain'))}} onCopy={event=>{if(isInput(event.target))return;event.preventDefault();event.clipboardData.setData('text/plain',visibleSelection(table,indexes,anchor,selection))}}>
    <table aria-label={table.title}><thead><tr className="sheet-letters"><th className="sheet-corner" scope="col"/><>{table.headers.map((_,col)=><th scope="col" key={col} className={col===selection.col?'sheet-column-selected':''} onClick={()=>{choose(selection.row,col);grid.current?.focus()}}>{columnLetter(col)}</th>)}</></tr><tr className="sheet-headers"><th className="sheet-row-index" scope="row">字段</th>{table.headers.map((header,col)=><th scope="col" key={col}><input aria-label={`${columnLetter(col)} 列表头`} title={header} key={header} defaultValue={header} disabled={blocked} maxLength={60} onFocus={()=>{setSelection(s=>({...s,col}));setAnchor(s=>({...s,col}))}} onBlur={e=>{const text=e.target.value.trim();if(text!==header)commit({...table,headers:table.headers.map((v,c)=>c===col?text:v)})}} onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}}/></th>)}</tr></thead><tbody>{indexes.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(rowIndex=>{const row=table.rows[rowIndex];return <tr key={rowIndex}><th scope="row" className="sheet-row-index" onClick={()=>{setAnchor({row:rowIndex,col:0});setSelection({row:rowIndex,col:table.headers.length-1});grid.current?.focus()}}>{rowIndex+1}</th>{row.map((cell,col)=>{const selected=selection.row===rowIndex&&selection.col===col,inRange=rowIndex>=Math.min(anchor.row,selection.row)&&rowIndex<=Math.max(anchor.row,selection.row)&&col>=Math.min(anchor.col,selection.col)&&col<=Math.max(anchor.col,selection.col),isEditing=editing?.row===rowIndex&&editing?.col===col;return <td data-cell={`${rowIndex}:${col}`} key={col} className={(selected?'sheet-cell-selected ':'')+(inRange?'sheet-cell-range ':'')+(typeof cell==='number'?'sheet-cell-number':'')} title={String(cell??'')} onClick={e=>{if(!blocked&&!isEditing){choose(rowIndex,col,e.shiftKey);grid.current?.focus()}}} onDoubleClick={()=>{if(!blocked)setEditing({row:rowIndex,col,value:String(cell??'')})}}>{isEditing?<input aria-label={`编辑 ${columnLetter(col)}${rowIndex+1}`} autoFocus defaultValue={editing.value} maxLength={2000} onFocus={e=>{e.target.selectionStart=e.target.value.length}} onBlur={e=>{editCell(rowIndex,col,e.target.value);setEditing(null)}} onKeyDown={e=>{if(e.key==='Escape'){setEditing(null);grid.current?.focus()}else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();e.currentTarget.blur();choose(indexes[Math.min(indexes.length-1,indexes.indexOf(rowIndex)+(e.key==='Enter'?1:0))],Math.min(table.headers.length-1,col+(e.key==='Tab'?1:0)));grid.current?.focus()}}}/>:<span>{cell??''}</span>}</td>})}</tr>})}{!indexes.length&&<tr><td className="sheet-filter-empty" colSpan={table.headers.length+1}>没有符合当前筛选条件的记录，可调整文字或清除筛选后查看全部数据。</td></tr>}</tbody></table>
   </div>
   <footer className="sheet-footer"><div><strong>{indexes.length.toLocaleString('zh-CN')}</strong> 行{filtered&&<small> / 全部 {table.rows.length.toLocaleString()} 行</small>}<span>×</span><strong>{table.headers.length}</strong> 列<span className="sheet-footer-tip">Shift + 单击选择区域 · 双击编辑 · Ctrl+V 粘贴</span></div><nav aria-label="数据分页"><button disabled={page===0||blocked} aria-label="上一页" onClick={()=>{setPage(p=>p-1);grid.current?.scrollTo(0,0)}}><ChevronLeft size={16}/></button><span>第 {page+1} / {pages} 页</span><button disabled={page>=pages-1||blocked} aria-label="下一页" onClick={()=>{setPage(p=>p+1);grid.current?.scrollTo(0,0)}}><ChevronRight size={16}/></button><small>每页 100 行</small></nav></footer>
  </section>
  {versionsOpen&&record&&<SourceVersions owner={owner} sheetId={record.id} onClose={()=>setVersionsOpen(false)}/>}
  {reading&&library===null&&<div className="sheet-read-status" role="status"><LoaderCircle className="sheet-spin" size={16}/>正在读取账号表格…</div>}
  {library!==null&&<div className="sheet-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!blocked)setLibrary(null)}}><section ref={dialog} className="sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="sheet-open-title" onKeyDown={e=>{if(e.key==='Escape'&&!blocked)setLibrary(null)}}><header><div><h2 id="sheet-open-title">打开表格</h2><p>仅显示 {owner} 保存的原始表格。</p></div><button autoFocus aria-label="关闭表格列表" disabled={blocked} onClick={()=>setLibrary(null)}><X size={19}/></button></header>{drafts.length>0&&<section className="sheet-local-drafts"><h3>未保存的草稿</h3>{drafts.map(item=><button key={item.scope||'default'} disabled={blocked} aria-label={`恢复草稿：${item.table.title}`} onClick={()=>restoreDraft(item.scope)}><strong>{item.table.title}</strong><span>{item.table.rows.length} 行 · {item.table.headers.length} 列 · 仅此浏览器</span></button>)}</section>}{!library.length?<div className="sheet-library-empty"><FolderOpen size={30}/><h3>还没有保存的表格</h3><p>新建或导入一份表格，点击「保存」留在当前账号。</p></div>:<div className="sheet-file-list">{library.map(item=><div key={item.id}><button className="sheet-file-open" disabled={blocked} onClick={()=>open(item)}><strong>{item.title}</strong><span>{item.rows} 行 · {item.columns} 列<span>更新于 {date(item.updatedAt)}</span></span></button><button title="删除表格" aria-label={`删除 ${item.title}`} disabled={blocked} onClick={()=>remove(item)}><Trash2 size={17}/></button></div>)}</div>}<footer><span>最多保存 20 份表格</span><button disabled={blocked} onClick={()=>setLibrary(null)}>完成</button></footer></section></div>}
 </main>;
}
function LinkedSpreadsheet({user,activeSource,onBack,...props}) {
 const dataset=activeSource.dataset,sheetId=activeSource.sheetId,identity=useMemo(()=>activeSource.id+':'+(sheetId||reportKeyFor({dataset})),[activeSource.id,sheetId,dataset]);
 const [state,setState]=useState({key:'',loading:true});
 useEffect(()=>{let live=true;setState({key:identity,loading:true});
  const request=sheetId?apiRequest('/api/sheets/'+encodeURIComponent(sheetId),undefined,{headers:{'X-Workspace-Owner':encodeURIComponent(user.username)}}):apiRequest('/api/sheets/resolve',{owner:user.username,dataset});
  request.then(result=>{
   if(!live)return;const item=result.item;setState({key:identity,loading:false,source:{table:item?.table||{...tableFromDataset(dataset),projectId:dataset.projectId||activeSource.id},item,fallback:!item}});
  }).catch(error=>{if(live)setState({key:identity,loading:false,error:error.message})});
  return()=>{live=false};
 },[identity,dataset,sheetId,user.username]);
 if(state.key!==identity||state.loading)return <main className="sheet-page"><div className="sheet-source-loading" role="status"><LoaderCircle className="sheet-spin" size={22}/>正在打开工作台对应的原始数据…</div></main>;
 if(state.error)return <main className="sheet-page"><div className="sheet-alert" role="alert">{state.error}<button onClick={onBack}>返回工作台</button></div></main>;
 return <SheetWorkspace key={identity} user={user} {...props} incomingTable={null} source={state.source} aiDataset={dataset} draftScope={identity}/>;
}
export default function SpreadsheetPage({user,onAnalyze=noop,onNotice=noop,onBusyChange=noop,incomingTable,activeSource,onBack=noop}) {
 if(!user?.username)return <main className="sheet-page"><h1>数据表格</h1><p>请先登录。</p></main>;
 const props={onAnalyze,onNotice,onBusyChange,incomingTable};
 if(activeSource?.dataset||activeSource?.sheetId)return <LinkedSpreadsheet user={user} activeSource={activeSource} onBack={onBack} {...props}/>;
 if(!incomingTable)return <main className="sheet-page"><div className="sheet-source-empty"><Sparkles size={34}/><h1>原始数据，随分析一起打开</h1><p>先在工作台导入或打开一份数据，AI 识别的分类和对应原始记录会出现在这里。</p><button className="sheet-primary" onClick={onBack}>返回 AI 分析</button></div></main>;
 return <SheetWorkspace key={user.username} user={user} {...props}/>;
}
