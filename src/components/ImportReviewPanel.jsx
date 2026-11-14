import {useEffect,useRef,useState} from 'react';
import {Check,Clock3,FileSpreadsheet,Info,LoaderCircle,RotateCcw,Table2} from 'lucide-react';
import DataProcessingFlow from './DataProcessingFlow.jsx';
import {importProgress} from './importProgress.mjs';
import './import-review.css';

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
  <DataProcessingFlow working={busy} className="import-flow"/>
  <div className="import-file-detail"><FileSpreadsheet size={20}/><span className="import-file-name" title={source}>{source}</span><span><strong>{job.table.rows.length.toLocaleString()}</strong> 行</span><span><strong>{job.table.headers.length}</strong> 列</span><span className="import-elapsed"><Clock3 size={13}/>{elapsed<60?`${elapsed} 秒`:`${Math.floor(elapsed/60)} 分 ${elapsed%60} 秒`}</span></div>
  <div className={`import-review-status${job.error?' failed':''}`} role="status" aria-live="polite">{busy?<LoaderCircle size={18} className="spin"/>:<Info size={18}/>}<div>{!busy&&<span className="import-status-label">{awaiting?'等待开始':'本次处理已暂停'}</span>}<strong title={activity}>{activity}</strong></div></div>
  <ol className="import-review-steps" aria-label="导入处理步骤">{stages.map((stage,index)=><li key={stage.key} className={`is-${stage.status}`}><span className="import-step-marker">{stage.status==='success'?<Check size={15}/>:stage.status==='running'?<LoaderCircle size={15} className="spin"/>:stage.status==='error'?<Info size={15}/>:index+1}</span><div><strong>{stage.label}<span>{({success:'已完成',running:'执行中',waiting:'等待模型',pending:'待处理',error:'待修正'})[stage.status]}</span></strong><small title={stage.summary}>{stage.summary}</small></div></li>)}</ol>
  <div className="import-review-bottom"><span>{completed} / {stages.length} 个步骤已确认</span><span>完整原表已读取 · 原始值保留</span></div>
  {!busy&&<div className="import-review-actions"><button className="primary-button" onClick={onRetry}><RotateCcw size={16}/>{awaiting?'开始 AI 分析':'重试 AI 整理'}</button><button className="secondary-button" onClick={onEdit}><Table2 size={16}/>在数据表格中编辑</button><button className="text-button" onClick={onCancel}>返回分析</button></div>}
 </section>;
}
