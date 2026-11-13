import { useEffect, useId, useRef, useState } from 'react';
import { Download, FileArchive, History, LoaderCircle, X } from 'lucide-react';
import { apiRequest } from '../api.mjs';
import { downloadSheetVersion } from './sourceFile.mjs';
import './source-versions.css';

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '保存时间未知' : date.toLocaleString('zh-CN', { hour12: false });
}
function sizeLabel(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SourceVersions({ owner, sheetId, onClose }) {
  const titleId = useId(), descriptionId = useId();
  const panel = useRef(null), closeButton = useRef(null), alive = useRef(false), downloadLock = useRef(false);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [downloading, setDownloading] = useState(null), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null); setNotice('');
    if (!owner || !sheetId) {
      setLoading(false); setError('请先打开当前账号的表格。');
      return () => { active = false; };
    }
    apiRequest(`/api/sheets/${encodeURIComponent(sheetId)}/versions`, undefined, {
      credentials: 'same-origin', headers: { 'X-Workspace-Owner': encodeURIComponent(owner) },
    }).then(result => {
      if (!Array.isArray(result?.versions)) throw new Error('版本信息不完整，请重新打开表格后重试。');
      if (active) setData(result);
    }).catch(reason => { if (active) setError(reason.message || '版本读取失败，请稍后重试。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner, sheetId, reload]);
  useEffect(() => {
    const previous = document.activeElement, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const containFocus = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = [...panel.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const redirectFocus = event => { if (panel.current && !panel.current.contains(event.target)) closeButton.current?.focus(); };
    document.addEventListener('keydown', containFocus, true);
    document.addEventListener('focusin', redirectFocus);
    return () => {
      document.removeEventListener('keydown', containFocus, true);
      document.removeEventListener('focusin', redirectFocus);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);
  async function download(version) {
    if (downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(String(version)); setNotice('');
    try {
      await downloadSheetVersion(owner, sheetId, version);
      if (alive.current) setNotice('下载已开始。');
    } catch (reason) {
      if (alive.current) setNotice(reason.message || '下载失败，请稍后重试。');
    } finally {
      downloadLock.current = false;
      if (alive.current) setDownloading(null);
    }
  }
  const versions = [...(data?.versions || [])].sort((a, b) => b.revision - a.revision);
  const earliest = versions.at(-1), original = data?.source?.originalFile;
  const downloadButton = (version, label, primary = false) => <button type="button" className={primary ? 'source-versions-download source-versions-primary' : 'source-versions-download'} disabled={downloading !== null} onClick={() => download(version)}>
    {downloading === String(version) ? <LoaderCircle size={15} className="source-versions-spin" /> : <Download size={15} />}
    {downloading === String(version) ? '正在下载…' : label}
  </button>;
  return <div className="source-versions-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="source-versions-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={loading || downloading !== null}>
      <header className="source-versions-header">
        <div><h2 id={titleId}>版本与下载</h2><p id={descriptionId}>查看留存来源，下载已保存的表格。</p></div>
        <button className="source-versions-close" type="button" ref={closeButton} onClick={onClose} aria-label="关闭版本与下载"><X size={19} /></button>
      </header>
      {loading ? <div className="source-versions-state" role="status"><LoaderCircle size={19} className="source-versions-spin" />正在读取版本…</div> : error ? <div className="source-versions-state"><p role="alert">{error}</p><button type="button" onClick={() => setReload(value => value + 1)}>重新读取</button></div> : data && <>
        <div className="source-versions-source">
          <FileArchive size={21} aria-hidden="true" />
          <div><h3>{original ? '导入时的原始文件' : data.source?.origin === 'saved' ? '最初保存的表格' : '最早留存的表格'}</h3>
            <p className="source-versions-file" title={original?.name || earliest?.title}>{original?.name || earliest?.title || data.title}</p>
            <p>{original ? `${sizeLabel(original.size)} · 保留导入时的文件格式` : data.source?.origin === 'saved' ? '未留存原始附件，可下载最初保存的表格（CSV）。' : '这份表格没有原始附件，仅能下载目前留存的表格版本（CSV）。'}</p>
          </div>
          {(original || earliest) && downloadButton(original ? 'original' : earliest.revision, original ? '下载原文件' : '下载表格')}
        </div>
        <div className="source-versions-list-heading"><h3><History size={16} aria-hidden="true" />已保存版本 <span>{versions.length}</span></h3>{downloadButton('latest', '下载最新版本', true)}</div>
        <div className="source-versions-list" tabIndex={0} aria-label="已保存版本列表">
          {versions.length ? versions.map(version => <article className="source-versions-row" key={version.revision}>
            <div className="source-versions-revision">V{version.revision}</div>
            <div className="source-versions-detail"><div><h4 title={version.title}>{version.title || data.title}</h4>{version.revision === data.currentRevision && <span className="source-versions-current">当前版本</span>}</div><p><time dateTime={version.createdAt}>{dateLabel(version.createdAt)}</time><span>{version.rows} 行 × {version.columns} 列</span></p></div>
            {downloadButton(version.revision, '下载')}
          </article>) : <p className="source-versions-empty">暂无可下载的保存版本。</p>}
        </div>
      </>}
      <footer className="source-versions-footer"><p role="status" aria-live="polite">{notice || '表格版本以 CSV 格式下载；未保存的修改不会包含在内。'}</p><button type="button" onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}
