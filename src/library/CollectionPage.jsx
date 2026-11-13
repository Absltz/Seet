import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Columns3, FileSpreadsheet, History, LoaderCircle, Plus, Rows3, Search, Trash2, Upload, X } from 'lucide-react';
import { apiRequest } from '../api.mjs';
import { useAssetDeletion } from '../components/AssetDeletion.jsx';
import './collection-page.css';

const noop = () => {};
const itemKey = item => item.key || `${item.kind}:${item.id}`;
const analysisList = item => Array.isArray(item.analyses) ? item.analyses : [];
const hasAnalysis = item => item.status === 'analyzed';
const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN');
function updated(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '更新时间未记录';
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function CollectionCard({ item, activeId, selectedId, busy, onSelect, onOpen, onDelete }) {
  const analyses = analysisList(item);
  const analysisId = selectedId && analyses.some(analysis => analysis.id === selectedId)
    ? selectedId : item.analysisId || analyses[0]?.id;
  const analysis = analyses.find(value => value.id === analysisId);
  const current = !!activeId && (item.analysisId === activeId || analyses.some(value => value.id === activeId));
  const count = analyses.length || (item.analysisId ? 1 : 0);
  const hasSource = item.kind !== 'analysis' || !!item.sheetId || Number(item.rows) > 0 || Number(item.columns) > 0;
  const sourceLabel = item.sourceName || (item.kind === 'sheet' ? '原始表格' : item.kind === 'dataset' ? '已保存数据集' : '分析中的数据');
  const openItem = { ...item, analysisId };
  return <article className={`collection-card${current ? ' is-current' : ''}`}>
    <header className="collection-card-heading">
      <div className="collection-card-identity">
        <span className="collection-card-type"><FileSpreadsheet size={14} aria-hidden="true" />{item.kind === 'sheet' ? '原始表格' : item.kind === 'dataset' ? '数据集' : '数据与分析'}</span>
        <h2 title={item.title}>{item.title || '未命名数据'}</h2>
        <p className="collection-card-source" title={sourceLabel}>来源 · {sourceLabel}</p>
      </div>
      {current ? <span className="collection-badge is-current">当前分析</span> : <span className="collection-badge">{hasAnalysis(item) ? '已分析' : '待分析'}</span>}
    </header>
    <dl className="collection-card-stats">
      <div><dt><Rows3 size={14} aria-hidden="true" />数据行</dt><dd>{number(item.rows)}<small>行</small></dd></div>
      <div><dt><Columns3 size={14} aria-hidden="true" />字段</dt><dd>{number(item.columns)}<small>个</small></dd></div>
    </dl>
    <div className="collection-card-records">
      <div className="collection-card-record-summary"><span><History size={14} aria-hidden="true" />分析记录 <strong>{count}</strong> 份</span><span>报告 {number(item.reportCount ?? 0)} 份</span></div>
      {analyses.length > 1 ? <label className="collection-analysis-picker"><span>选择分析记录</span><select aria-label="选择分析记录" value={analysisId || ''} disabled={busy} onChange={event => onSelect(event.target.value)}>{!analyses.some(value => value.id === analysisId) && analysisId && <option value={analysisId}>最近的分析记录</option>}{analyses.map(value => <option key={value.id} value={value.id}>{value.title || '未命名分析'} · {updated(value.updatedAt)}</option>)}</select></label>
        : <p className="collection-analysis-note">{count ? `已保存 ${number(item.messageCount)} 条对话，可继续查看与分析` : '原始数据已保存，打开分析记录即可开始'}</p>}
      <p className="collection-card-updated">最近更新 <time dateTime={item.updatedAt || undefined}>{updated(item.updatedAt)}</time></p>
    </div>
    <footer className="collection-card-actions">
      <button type="button" className="collection-delete" disabled={busy} onClick={() => onDelete(item)} aria-label={`删除 ${item.title || '未命名数据'} 及关联内容`}><Trash2 size={14} aria-hidden="true" />删除</button>
      <div><button type="button" className="collection-source-action" disabled={busy || !hasSource} title={hasSource ? undefined : '这份分析尚未保存表格数据'} onClick={() => onOpen(openItem, 'source')}><FileSpreadsheet size={14} aria-hidden="true" />原始数据</button><button type="button" className="collection-analysis-action" disabled={busy} onClick={() => onOpen(openItem, 'analysis')}>打开分析记录<ArrowRight size={15} aria-hidden="true" /></button></div>
    </footer>
  </article>;
}

export default function CollectionPage({ user, activeId, onOpen, onUpload, onBusyChange = noop }) {
  const owner = user?.username || '';
  const { requestDeletion } = useAssetDeletion();
  const [data, setData] = useState({ owner, items: [], loading: !!owner, error: '' });
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  const generation = useRef(0), controller = useRef(null), operation = useRef(false), mounted = useRef(false), currentOwner = useRef(owner), reportBusy = useRef(onBusyChange);
  currentOwner.current = owner;
  reportBusy.current = onBusyChange;
  const load = useCallback(async () => {
    const token = ++generation.current;
    controller.current?.abort();
    if (!owner) { setData({ owner, items: [], loading: false, error: '' }); return; }
    const abort = new AbortController(); controller.current = abort;
    setData(previous => ({ owner, items: previous.owner === owner ? previous.items : [], loading: true, error: '' }));
    try {
      const result = await apiRequest('/api/collection', undefined, { headers: { 'X-Workspace-Owner': encodeURIComponent(owner) }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(50000)]) });
      if (mounted.current && generation.current === token && !abort.signal.aborted && currentOwner.current === owner) setData({ owner, items: Array.isArray(result.items) ? result.items : [], loading: false, error: '' });
    } catch (error) {
      if (mounted.current && generation.current === token && !abort.signal.aborted && currentOwner.current === owner) setData(previous => ({ ...previous, loading: false, error: error.message || '数据收集暂时无法读取，请重试。' }));
    }
  }, [owner]);
  useEffect(() => {
    mounted.current = true;
    setSearch(''); setFilter('all'); setSelected({}); setActionError(''); setBusy(false);
    load();
    const changed = event => { if (!event.detail?.owner || event.detail.owner === owner) load(); };
    window.addEventListener('seet:assets-changed', changed);
    return () => { mounted.current = false; ++generation.current; controller.current?.abort(); operation.current = false; reportBusy.current(false); window.removeEventListener('seet:assets-changed', changed); };
  }, [owner, load]);
  useEffect(() => { reportBusy.current(busy); }, [busy]);
  const items = data.owner === owner ? data.items : [];
  const loading = data.owner !== owner || data.loading;
  const error = data.owner === owner ? data.error : '';
  const counts = useMemo(() => ({ all: items.length, analyzed: items.filter(hasAnalysis).length, unanalysed: items.filter(item => !hasAnalysis(item)).length }), [items]);
  const shown = useMemo(() => items.filter(item => {
    const matches = `${item.title || ''} ${item.sourceName || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    return matches && (filter === 'all' || (filter === 'analyzed' ? hasAnalysis(item) : !hasAnalysis(item)));
  }), [items, search, filter]);
  async function runAction(action) {
    if (operation.current || !owner) return;
    const startedOwner = owner;
    operation.current = true; setBusy(true); setActionError('');
    try { await action(); }
    catch (failure) { if (mounted.current && currentOwner.current === startedOwner) setActionError(failure?.message || '暂时无法打开，请重试。'); }
    finally { if (mounted.current && currentOwner.current === startedOwner) { operation.current = false; setBusy(false); } }
  }
  const blocked = busy || !owner;
  return <main className="collection-page" aria-busy={busy || loading}><div className="collection-inner">
    <header className="collection-heading"><div><h1>数据集库</h1><p>每份数据与它的分析记录保存在一起，随时接着查看。</p></div><button type="button" className="collection-import" disabled={blocked} onClick={() => runAction(onUpload)}><Upload size={17} aria-hidden="true" />导入数据</button></header>
    <div className="collection-toolbar"><label className="collection-search"><Search size={17} aria-hidden="true" /><span className="collection-sr">搜索数据名称或来源</span><input type="search" placeholder="搜索数据名称或来源" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="清除搜索" onClick={() => setSearch('')}><X size={16} aria-hidden="true" /></button>}</label><div className="collection-filters" role="group" aria-label="按分析状态筛选">{[['all', '全部'], ['analyzed', '已分析'], ['unanalysed', '待分析']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{counts[value]}</span></button>)}</div><span className="collection-private">仅当前账户可见</span></div>
    {(error || actionError) && <div className="collection-error" role="alert"><span>{error || actionError}</span><button type="button" disabled={busy || loading} onClick={() => { setActionError(''); load(); }}>重新加载</button></div>}
    <div className="collection-list-heading"><span>{search.trim() || filter !== 'all' ? `${shown.length} 份匹配数据` : `全部数据 · ${items.length} 份`}</span>{loading && <span role="status"><LoaderCircle size={14} className="collection-spin" aria-hidden="true" />正在读取…</span>}{busy && <span role="status"><LoaderCircle size={14} className="collection-spin" aria-hidden="true" />正在打开…</span>}</div>
    {!owner ? <div className="collection-empty"><h2>登录后查看你的数据</h2><p>数据与分析记录按账户分别保存。</p></div> : <section className="collection-grid" aria-label="数据与对应分析记录">
      {shown.map(item => <CollectionCard key={itemKey(item)} item={item} activeId={activeId} selectedId={selected[itemKey(item)]} busy={blocked} onSelect={value => setSelected(previous => ({ ...previous, [itemKey(item)]: value }))} onOpen={(next, mode) => runAction(() => onOpen(next, mode))} onDelete={next => { if (!operation.current) requestDeletion({ owner, kind: next.kind, id: next.id, title: next.title }); }} />)}
      {!loading && !error && !shown.length && items.length > 0 && <div className="collection-empty collection-no-match"><h2>没有找到这份数据</h2><p>换个数据名称或来源试试。</p><button type="button" onClick={() => { setSearch(''); setFilter('all'); }}>清除筛选</button></div>}
      {!items.length&&!loading&&!error&&<button type="button" className="collection-add-card" disabled={blocked} onClick={() => runAction(onUpload)}><Plus size={26} strokeWidth={1.4} aria-hidden="true" /><strong>导入第一份数据</strong><span>上传表格，开始新的分析</span></button>}
    </section>}
  </div></main>;
}
