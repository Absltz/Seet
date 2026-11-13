import { FileText, ArrowUpRight, Trash2 } from "lucide-react";
export default function AnalysisHistory({ records, busy, onOpen, onDelete }) {
  return (
    <main className={`history-page${records.records.length ? "" : " history-page-empty"}`}>
      <div className="records-page-heading">
        <h1>分析记录</h1>
        <p>{records.records.length} 条记录，保存在当前账号</p>
      </div>
      <section className="records-page-list" aria-label="已保存的分析记录">
        <div className="records-column-heading" aria-hidden="true">
          <span>分析名称</span>
          <span>更新时间</span>
          <span>数据规模</span>
          <span />
        </div>
        {records.records.length ? (
          records.records.map((record) => (
            <div className="records-page-item" key={record.id}>
              <button
                className="records-page-row"
                disabled={busy || records.loading}
                aria-label={"打开分析：" + record.title}
                onClick={() => onOpen(record.id)}
              >
                <span className="records-page-title">
                  <FileText size={19} />
                  <strong>{record.title}</strong>
                </span>
                <time dateTime={record.updatedAt}>
                  {new Date(record.updatedAt).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <span className="records-page-size">
                  {record.rows} 行 / {record.metrics} 个指标
                </span>
                <ArrowUpRight size={17} />
              </button>
              <div className="record-row-actions">
                  <button
                    className="record-delete-button"
                    aria-label={"删除分析：" + record.title}
                    title="删除记录及关联内容"
                    disabled={busy || records.loading}
                    onClick={() => onDelete(record)}
                  >
                    <Trash2 size={17} />
                  </button>
              </div>
            </div>
          ))
        ) : (
          <div className="records-page-empty">
            <FileText size={30} />
            <div>
              <h2>还没有分析记录</h2>
              <p>添加数据后，分析会自动保存，方便下次继续。</p>
            </div>
          </div>
        )}
      </section>
      {records.error && (
        <p className="save-error" role="alert">
          {records.error}
        </p>
      )}
    </main>
  );
}
