import {useCallback, useEffect, useRef, useState} from 'react';
import {AlertTriangle, Archive, ChevronDown, Clock3, LoaderCircle, RefreshCw, RotateCcw, Trash2} from 'lucide-react';
import {apiRequest} from '../api.mjs';
import './trash-page.css';

const labels = {analyses:'分析记录', charts:'看板图表', reports:'分析报告', datasets:'数据集', sheets:'原始表格'};
const noop = () => {};
const day = 24 * 60 * 60 * 1000;

export function formatTrashDate(value) {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).format(date).replaceAll('/', '-');
}

export function getTrashCounts(entry) {
  return Object.fromEntries(Object.keys(labels).map(key => {
    const count = entry?.counts?.[key];
    return [key, Number.isFinite(count) && count >= 0
      ? Math.floor(count)
      : Array.isArray(entry?.items?.[key]) ? entry.items[key].length : 0];
  }));
}

export function getTrashRetention(entry, now = Date.now()) {
  const expires = entry?.expiresAt ? new Date(entry.expiresAt).getTime() : NaN;
  const days = Number.isFinite(expires)
    ? Math.max(0, Math.ceil((expires - now) / day))
    : Number.isFinite(entry?.remainingDays) ? Math.max(0, Math.ceil(entry.remainingDays)) : null;
  return {days, expired:days === 0, label:days === null ? '期限待确认' : days === 0 ? '已到期' : `剩余 ${days} 天`};
}

export default function TrashPage({user, onNotice = noop}) {
  const owner = typeof user?.username === 'string' ? user.username.trim() : '';
  const [view, setView] = useState(() => ({owner, items:[], retentionDays:7, loading:!!owner, error:''}));
  const [confirmation, setConfirmation] = useState(null);
  const [action, setAction] = useState(null);
  const [rowError, setRowError] = useState(null);
  const mounted = useRef(false), epoch = useRef(0), currentOwner = useRef(owner);
  const listSequence = useRef(0), pendingAction = useRef(null);
  currentOwner.current = owner;

  const isCurrent = useCallback(token => mounted.current && currentOwner.current === owner && epoch.current === token, [owner]);
  const load = useCallback(async (token = epoch.current) => {
    if (!owner || !isCurrent(token)) return;
    const sequence = ++listSequence.current;
    setView(previous => ({...previous, loading:true, error:''}));
    try {
      const result = await apiRequest('/api/assets/trash', {owner});
      if (!isCurrent(token) || sequence !== listSequence.current) return;
      setView({owner, items:Array.isArray(result.items) ? result.items : [], retentionDays:result.retentionDays || 7, loading:false, error:''});
    } catch (error) {
      if (!isCurrent(token) || sequence !== listSequence.current) return;
      setView(previous => ({...previous, loading:false, error:error.message || '回收站载入失败，请稍后重试。'}));
    }
  }, [owner, isCurrent]);

  useEffect(() => {
    mounted.current = true;
    const token = ++epoch.current;
    pendingAction.current = null;
    setView({owner, items:[], retentionDays:7, loading:!!owner, error:''});
    setAction(null);
    setConfirmation(null);
    setRowError(null);
    if (owner) load(token);
    return () => {
      mounted.current = false;
      epoch.current++;
      listSequence.current++;
      pendingAction.current = null;
    };
  }, [owner, load]);

  async function perform(kind, entry) {
    const token = epoch.current;
    if (!owner || !isCurrent(token) || pendingAction.current || view.loading || view.owner !== owner) return;
    if (kind === 'purge' && confirmation !== entry.id) return;
    if (kind === 'restore' && getTrashRetention(entry).expired) return;
    const operation = {kind, id:entry.id, owner, token};
    pendingAction.current = operation;
    setAction(operation);
    setRowError(null);
    try {
      const result = await apiRequest(`/api/assets/${kind}`, {
        owner, deletionId:entry.id, ...(kind === 'purge' ? {confirm:true} : {}),
      });
      if (!isCurrent(token) || pendingAction.current !== operation) return;
      setView(previous => ({...previous, items:previous.items.filter(item => item.id !== entry.id)}));
      setConfirmation(null);
      if (kind === 'restore') {
        window.dispatchEvent(new CustomEvent('seet:assets-changed', {detail:{...result, action:'restore'}}));
        onNotice(`已恢复“${result.title || entry.title || '未命名内容'}”及全部关联内容`);
      } else {
        onNotice(`已永久删除“${result.title || entry.title || '未命名内容'}”及全部关联内容`);
      }
      await load(token);
    } catch (error) {
      if (!isCurrent(token) || pendingAction.current !== operation) return;
      setRowError({
        id:entry.id,
        message:`${kind === 'restore' ? '整组恢复失败' : '永久删除失败'}：${error.message || '请稍后重试。'}`,
        stale:error.status === 404 || error.status === 410,
      });
    } finally {
      if (isCurrent(token) && pendingAction.current === operation) {
        pendingAction.current = null;
        setAction(null);
      }
    }
  }

  function refresh() {
    if (pendingAction.current) return;
    setConfirmation(null);
    setRowError(null);
    load();
  }

  const sameOwner = view.owner === owner;
  const items = sameOwner ? view.items : [];
  const loading = !!owner && (!sameOwner || view.loading);
  const busy = sameOwner && action?.owner === owner;
  const retentionDays = sameOwner ? view.retentionDays : 7;

  return <main className="trash-page">
    <div className="trash-content">
      <header className="trash-heading">
        <div><h1>回收站</h1><p>删除的内容保留 {retentionDays} 天，可在到期前恢复整组关联内容。</p></div>
        {owner && <button className="trash-button" onClick={refresh} disabled={loading || busy}>
          {loading ? <LoaderCircle className="trash-spin" size={16} aria-hidden="true"/> : <RefreshCw size={16} aria-hidden="true"/>}
          {loading ? '正在更新…' : '刷新列表'}
        </button>}
      </header>

      <div className="trash-list-heading"><h2>已删除的内容</h2><span>{owner && sameOwner && !loading ? `${items.length} 组内容` : '按整组管理关联内容'}</span></div>

      {!owner ? <div className="trash-empty"><Archive size={30} aria-hidden="true"/><h2>请先登录后查看回收站</h2><p>登录后可查看和恢复当前账号最近删除的内容。</p></div> : <>
        {sameOwner && view.error && <div className="trash-load-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true"/><p>{view.error}</p>
          <button className="trash-text-button" onClick={refresh} disabled={busy || loading}>重新载入</button>
        </div>}
        {loading && !items.length ? <div className="trash-loading" role="status"><LoaderCircle className="trash-spin" size={22} aria-hidden="true"/><p>正在载入回收站…</p></div> : !items.length && !view.error ?
          <div className="trash-empty"><Archive size={30} aria-hidden="true"/><h2>回收站是空的</h2><p>删除的分析及关联内容会在这里保留 {retentionDays} 天。</p></div> :
          <div className="trash-list" aria-busy={loading || busy}>
            {items.map(entry => {
              const counts = getTrashCounts(entry), retention = getTrashRetention(entry);
              const title = entry.title || '未命名内容';
              const restoring = busy && action.id === entry.id && action.kind === 'restore';
              const purging = busy && action.id === entry.id && action.kind === 'purge';
              const confirming = confirmation === entry.id;
              const error = rowError?.id === entry.id ? rowError : null;
              return <article className="trash-group" key={entry.id}>
                <div className="trash-group-top">
                  <div className="trash-group-title"><h3>{title}</h3><p>删除于 <time>{formatTrashDate(entry.deletedAt)}</time></p></div>
                  <span className={`trash-deadline${retention.expired || retention.days === 1 ? ' trash-deadline-urgent' : ''}`} title={`到期时间：${formatTrashDate(entry.expiresAt)}`}><Clock3 size={14} aria-hidden="true"/>{retention.label}</span>
                </div>
                <div className="trash-group-bottom">
                  <dl className="trash-counts">{Object.entries(labels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{counts[key]}</dd></div>)}</dl>
                  <div className="trash-actions">
                    <button className="trash-button trash-restore" onClick={() => perform('restore', entry)} disabled={busy || loading || retention.expired} title={retention.expired ? '此组内容已到期，无法恢复' : `恢复“${title}”及全部关联内容`}>
                      {restoring ? <LoaderCircle className="trash-spin" size={16} aria-hidden="true"/> : <RotateCcw size={16} aria-hidden="true"/>}{restoring ? '正在恢复…' : '恢复整组'}
                    </button>
                    <button className="trash-text-button trash-danger-link" onClick={() => {setConfirmation(entry.id); setRowError(null);}} disabled={busy || loading || confirming} aria-expanded={confirming} aria-controls={`trash-confirm-${entry.id}`}><Trash2 size={15} aria-hidden="true"/>永久删除</button>
                  </div>
                </div>
                <details className="trash-details">
                  <summary><ChevronDown size={15} aria-hidden="true"/><span>查看整组内容</span><span className="trash-details-note">恢复或永久删除将作用于以下全部内容</span></summary>
                  <div className="trash-item-lists">
                    {Object.entries(labels).filter(([key]) => counts[key] || entry.items?.[key]?.length).map(([key, label]) => <section key={key}>
                      <h4>{label}<span>{counts[key]}</span></h4>
                      <ul>{Array.isArray(entry.items?.[key]) && entry.items[key].length
                        ? entry.items[key].map((item, index) => <li key={item.id || index}>{item.title || '未命名内容'}</li>)
                        : <li className="trash-missing-name">暂无具体名称</li>}</ul>
                    </section>)}
                    {!Object.values(counts).some(Boolean) && <p className="trash-missing-name">此组暂无关联内容清单。</p>}
                  </div>
                </details>
                <div className={`trash-confirm-reveal${confirming ? " is-open" : ""}`} id={`trash-confirm-${entry.id}`} inert={!confirming} aria-hidden={!confirming}><div className="trash-confirm-clip"><div className="trash-confirm" role="group" aria-labelledby={`trash-confirm-title-${entry.id}`}>
                  <AlertTriangle size={19} aria-hidden="true"/>
                  <div className="trash-confirm-copy"><h4 id={`trash-confirm-title-${entry.id}`}>永久删除整组内容？</h4><p>将永久删除“{title}”及全部关联内容，删除后无法恢复。</p></div>
                  <div className="trash-confirm-actions"><button className="trash-button" disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button className="trash-button trash-purge" disabled={busy || loading} onClick={() => perform('purge', entry)}>{purging && <LoaderCircle className="trash-spin" size={16} aria-hidden="true"/>}{purging ? '正在永久删除…' : '确认永久删除'}</button></div>
                </div></div></div>
                {error && <div className="trash-row-error" role="alert"><AlertTriangle size={16} aria-hidden="true"/><div><p>{error.message}</p><span>{error.stale ? '这组内容可能已到期或已被处理，请重新载入后核对。' : '此组内容仍保留在列表中，请处理提示的问题后重试。'}</span>{error.stale && <button className="trash-text-button" onClick={refresh} disabled={loading || busy}>重新载入回收站</button>}</div></div>}
              </article>;
            })}
          </div>}
      </>}
      <p className="trash-footnote">到期后内容将自动清除；永久删除后无法恢复。</p>
    </div>
  </main>;
}
