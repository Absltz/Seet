import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {Info,LoaderCircle,RotateCcw,Trash2,X} from 'lucide-react';
import {apiRequest} from '../api.mjs';
import {projectContent} from '../projectLinks.mjs';
import './asset-deletion.css';

const Context=createContext(null),labels={analyses:'分析记录',charts:'看板图表',reports:'分析报告',datasets:'数据集',sheets:'原始表格'};
export const useAssetDeletion=()=>useContext(Context);
function DeletionToast({entry,restoring,error,onRestore,onDismiss}) {
 const [leaving,setLeaving]=useState(false),dismiss=useRef(onDismiss);dismiss.current=onDismiss;
 useEffect(()=>{
  if(restoring||error)return;
  const timer=setTimeout(()=>setLeaving(true),5000);
  return()=>clearTimeout(timer);
 },[entry.id,restoring,error]);
 useEffect(()=>{
  if(!leaving)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timer=setTimeout(()=>dismiss.current(),reduced?0:280);
  return()=>clearTimeout(timer);
 },[leaving]);
 return <div className={'asset-delete-toast'+(leaving?' is-leaving':'')} role="status">
  <span>已删除“{entry.title}”及关联内容</span>
  <button disabled={restoring||leaving} onClick={onRestore}><RotateCcw size={15}/>{restoring?'正在恢复…':'撤销整组删除'}</button>
  <button aria-label="关闭删除提示" disabled={restoring||leaving} onClick={()=>setLeaving(true)}><X size={15}/></button>
  {error&&<small role="alert">{error}</small>}
 </div>;
}
async function clearDeletedDraft(result) {
 try{
  const prefix='seet:sheet-draft:'+result.owner;
  for(const key of Object.keys(sessionStorage).filter(key=>key===prefix||key.startsWith(prefix+':'))){
  const value=JSON.parse(sessionStorage.getItem(key));if(!value)continue;
  let related=result.items.sheets.some(item=>item.id===value.record?.id)||result.projectIds.includes(value.table?.projectId);
  if(!related&&!value.table?.projectId&&result.fingerprints?.length){const content=projectContent(value.table,true);if(content){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));const digest=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');related=result.fingerprints.includes(digest);}}
  if(related)sessionStorage.removeItem(key);
  }
 }catch{/* 不能解析的旧草稿不作为删除其他项目的依据。 */}
}
export default function AssetDeletionProvider({children}) {
 const [target,setTarget]=useState(null),[plan,setPlan]=useState(null),[phase,setPhase]=useState(''),[error,setError]=useState(''),[undo,setUndo]=useState(null);
 const dialog=useRef(null),epoch=useRef(0),previousFocus=useRef(null);
 const close=()=>{if(phase==='deleting')return;epoch.current++;setTarget(null);setPlan(null);setError('');setPhase('');};
 useEffect(()=>{const changed=()=>{epoch.current++;setTarget(null);setPlan(null);setUndo(null);setPhase('');};window.addEventListener('seet:owner-change',changed);window.addEventListener('seet:auth-expired',changed);return()=>{window.removeEventListener('seet:owner-change',changed);window.removeEventListener('seet:auth-expired',changed);};},[]);
 useEffect(()=>{if(target){previousFocus.current=document.activeElement;dialog.current?.showModal();}return()=>previousFocus.current?.focus?.();},[target?.id,target?.kind]);
 async function loadPlan(value,beforePreview) {
  const token=++epoch.current;setTarget(value);setPlan(null);setPhase('loading');setError('');
  try{await beforePreview?.();const result=await apiRequest('/api/assets/preview-delete',{owner:value.owner,kind:value.kind,id:value.id});if(epoch.current===token){setPlan(result);setPhase('ready');}}
  catch(err){if(epoch.current===token){setError(err.message);setPhase('error');}}
 }
 const requestDeletion=(value,beforePreview)=>{if(phase==='deleting')return;loadPlan(value,beforePreview);};
 async function remove() {
  if(!target||!plan||phase!=='ready')return;
  const token=epoch.current,selected=target;setPhase('deleting');setError('');
  try{
   const result=await apiRequest('/api/assets/delete',{owner:selected.owner,kind:selected.kind,id:selected.id,token:plan.token});
   if(epoch.current!==token)return;
   await clearDeletedDraft(result);
   if(epoch.current!==token)return;
   window.dispatchEvent(new CustomEvent('seet:assets-changed',{detail:{...result,action:'delete'}}));
   setUndo({owner:selected.owner,id:result.deletionId,title:result.title});setTarget(null);setPlan(null);setPhase('');
  }catch(err){if(epoch.current!==token)return;if(err.status===409){await loadPlan(selected);setError('关联范围已变化，请核对更新后的清单，再次确认。');}else{setError(err.message);setPhase('ready');}}
 }
 async function restore() {
  const entry=undo;if(!entry||phase==='restoring')return;const token=epoch.current;setPhase('restoring');setError('');
  try{const result=await apiRequest('/api/assets/restore',{owner:entry.owner,deletionId:entry.id});if(epoch.current===token){window.dispatchEvent(new CustomEvent('seet:assets-changed',{detail:{...result,action:'restore'}}));setUndo(null);}}
  catch(err){if(epoch.current===token)setError(err.message);}finally{if(epoch.current===token)setPhase('');}
 }
 return <Context.Provider value={{requestDeletion}}>{children}
  {target&&<dialog className="asset-delete-dialog" ref={dialog} onCancel={event=>{event.preventDefault();close();}} aria-labelledby="asset-delete-title">
   <header><span className="asset-delete-icon"><Trash2 size={22}/></span><div><h2 id="asset-delete-title">删除全部关联内容？</h2><p>从“{target.title||plan?.title||'当前内容'}”发起删除</p></div><button aria-label="关闭删除确认" disabled={phase==='deleting'} onClick={close}><X size={19}/></button></header>
   {phase==='loading'?<div className="asset-delete-loading" role="status"><LoaderCircle size={20} className="spin"/>正在核对关联内容…</div>:plan&&<>
    <p className="asset-delete-intro">以下内容属于同一数据项目，确认后将一并删除。同一来源的其他分析也会列在其中。</p>
    <div className="asset-delete-counts">{Object.entries(labels).map(([key,label])=><span key={key}>{label}<strong>{plan.counts[key]}</strong></span>)}</div>
    <div className="asset-delete-list">{Object.entries(labels).filter(([key])=>plan.items[key].length).map(([key,label])=><section key={key}><h3>{label}</h3><ul>{plan.items[key].map(item=><li key={item.id}>{item.title}</li>)}</ul></section>)}</div>
    {plan.legacyMatch&&<p className="asset-delete-legacy"><Info size={14}/>部分旧版内容按完整数据内容匹配，请核对清单。</p>}
    <p className="asset-delete-note">删除后移入回收站，7 天内可整组恢复；到期后自动清除，也可在回收站永久删除。</p>
   </>}
   {error&&<p role="alert" className="asset-delete-error">{error}</p>}
   <footer><button className="secondary-button" disabled={phase==='deleting'} onClick={close}>取消</button><button className="asset-delete-confirm" disabled={!plan||phase!=='ready'} onClick={remove}>{phase==='deleting'?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>}确认删除全部关联内容</button></footer>
  </dialog>}
  {undo&&<DeletionToast key={undo.id} entry={undo} restoring={phase==='restoring'} error={!target?error:''} onRestore={restore} onDismiss={()=>setUndo(null)}/>}
 </Context.Provider>;
}
