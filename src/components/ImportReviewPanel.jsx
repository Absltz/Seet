import {useEffect,useRef,useState} from 'react';
import {Check,Clock3,FileSpreadsheet,Info,LoaderCircle,RotateCcw,Table2} from 'lucide-react';
import {useGSAP} from '@gsap/react';
import gsap from 'gsap';
import {importProgress} from './importProgress.mjs';
import './import-review.css';

gsap.registerPlugin(useGSAP);
function ImportFlow({working}) {
 const root=useRef(null);
 useGSAP(()=>{
  if(!working)return;
  const media=gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)',()=>{
   gsap.to('.import-flow-orbit',{rotation:360,svgOrigin:'240 80',duration:14,repeat:-1,ease:'none'});
   gsap.fromTo('.import-flow-packet',{x:0,opacity:0},{x:98,opacity:1,duration:1.8,repeat:-1,stagger:.6,ease:'power1.inOut',yoyo:true});
  });
  return()=>media.revert();
 },{scope:root,dependencies:[working],revertOnUpdate:true});
 return <div ref={root} className="import-flow" aria-hidden="true"><svg viewBox="0 0 480 160" fill="none">
  <path d="M104 80H202M278 80H376" stroke="currentColor" strokeOpacity=".17" strokeDasharray="3 6"/>
  <g><rect x="33" y="40" width="62" height="81" rx="7" fill="var(--surface)" stroke="currentColor" strokeOpacity=".2" transform="rotate(-8 64 80)"/><rect x="42" y="35" width="62" height="81" rx="7" fill="var(--surface)" stroke="currentColor" strokeOpacity=".35"/><path d="M54 55H90M54 66H90M54 77H90M54 88H90M66 55V98M79 55V98" stroke="currentColor" strokeOpacity=".3"/></g>
  <circle cx="240" cy="80" r="39" fill="var(--raised)" stroke="currentColor" strokeOpacity=".16"/><circle cx="240" cy="80" r="28" fill="var(--surface)" stroke="currentColor" strokeOpacity=".1"/>
  <g className="import-flow-orbit"><ellipse cx="240" cy="80" rx="54" ry="23" stroke="#b9a971" strokeWidth="1.4" transform="rotate(-26 240 80)"/><circle cx="287" cy="57" r="4" fill="#b9a971"/></g>
  <text x="240" y="86" textAnchor="middle" fill="currentColor" fontSize="19" fontWeight="600">AI</text>
  <g><rect x="376" y="35" width="73" height="81" rx="7" fill="var(--surface)" stroke="currentColor" strokeOpacity=".3"/><path d="M388 101H438" stroke="currentColor" strokeOpacity=".2"/><rect x="389" y="78" width="10" height="22" rx="2" fill="currentColor" fillOpacity=".35"/><rect x="407" y="62" width="10" height="38" rx="2" fill="currentColor" fillOpacity=".6"/><rect x="425" y="48" width="10" height="52" rx="2" fill="currentColor" fillOpacity=".9"/></g>
  <circle className="import-flow-packet" cx="112" cy="80" r="3" fill="currentColor"/><circle className="import-flow-packet" cx="279" cy="80" r="3" fill="#b9a971"/>
 </svg></div>;
}

export default function ImportReviewPanel({job,busy,status,steps,onRetry,onEdit,onCancel}) {
 const initialStart=useRef(Date.now()),start=job.startedAt||initialStart.current;
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{
  const update=()=>setElapsed(Math.max(0,Math.floor((Date.now()-start)/1000)));update();
  if(!busy)return;const timer=setInterval(update,1000);return()=>clearInterval(timer);
 },[busy,start]);
 const {stages,completed}=importProgress(steps,busy);
 const active=stages.find(stage=>['running','waiting','error'].includes(stage.status));
 const running=steps.findLast(step=>step.status==='running');
 const latest=steps.at(-1);
 const awaiting=job.awaiting&&!busy&&!job.error;
 const activity=awaiting?'原始文件与表格已保存，尚未调用 AI':job.error||running?.label||(latest?.status==='success'&&active?`已完成上一步，等待千问${active.label}`:status)||'等待 AI 解释字段与选择图表';
 const source=job.table.source?.replace(/^(原始文件|本地文件)[：:]\s*/,'')||job.table.title;
 return <section className={'import-review'+(!busy?' is-paused':'')} aria-label="AI 导入进度" aria-busy={busy}>
  <div className="import-review-intro"><span className="import-review-eyebrow"><span className={busy?'import-live-dot':''}/>千问 · 数据理解</span><h2>{busy?'正在把原始数据，整理成答案':awaiting?'原始数据已保存，开始一次分析':'原表已保留，可以继续整理'}</h2><p>{busy?'按真实工具执行进度更新，完成后展示图表与分析。':awaiting?'可以先查看原始表格，或交给千问整理字段并选择图表。':'查看下方原因后重试，或先修改原始表格。'}</p></div>
  <ImportFlow working={busy}/>
  <div className="import-file-detail"><FileSpreadsheet size={20}/><span className="import-file-name" title={source}>{source}</span><span><strong>{job.table.rows.length.toLocaleString()}</strong> 行</span><span><strong>{job.table.headers.length}</strong> 列</span><span className="import-elapsed"><Clock3 size={13}/>{elapsed<60?`${elapsed} 秒`:`${Math.floor(elapsed/60)} 分 ${elapsed%60} 秒`}</span></div>
  <div className={`import-review-status${job.error?' failed':''}`} role="status" aria-live="polite">{busy?<LoaderCircle size={18} className="spin"/>:<Info size={18}/>}<div>{!busy&&<span className="import-status-label">{awaiting?'等待开始':'本次处理已暂停'}</span>}<strong title={activity}>{activity}</strong></div></div>
  <ol className="import-review-steps" aria-label="导入处理步骤">{stages.map((stage,index)=><li key={stage.key} className={`is-${stage.status}`}><span className="import-step-marker">{stage.status==='success'?<Check size={15}/>:stage.status==='running'?<LoaderCircle size={15} className="spin"/>:stage.status==='error'?<Info size={15}/>:index+1}</span><div><strong>{stage.label}<span>{({success:'已完成',running:'执行中',waiting:'等待模型',pending:'待处理',error:'待修正'})[stage.status]}</span></strong><small title={stage.summary}>{stage.summary}</small></div></li>)}</ol>
  <div className="import-review-bottom"><span>{completed} / {stages.length} 个步骤已确认</span><span>完整原表已读取 · 原始值保留</span></div>
  {!busy&&<div className="import-review-actions"><button className="primary-button" onClick={onRetry}><RotateCcw size={16}/>{awaiting?'开始 AI 分析':'重试 AI 整理'}</button><button className="secondary-button" onClick={onEdit}><Table2 size={16}/>在数据表格中编辑</button><button className="text-button" onClick={onCancel}>返回分析</button></div>}
 </section>;
}
