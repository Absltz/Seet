import { Router } from "express";
import { prepareReportBundle } from "./snapshot.mjs";
import { composeReport } from "./compose.mjs";
import { renderReportPdf } from "./pdf.mjs";
import {textModel} from '../provider.mjs';
export function reportRouter({ compose = composeReport, renderPdf = renderReportPdf, aiTimeoutMs = 150000 } = {}) {
  const router = Router();
  let active = 0;
  router.post("/", async (req, res) => {
    if (req.body?.owner && req.body.owner !== req.user.username)
      return res.status(409).json({ error: "账号已改变，请刷新后重试。" });
    if (active >= 2)
      return res.status(429).json({ error: "报告正在生成，请稍后重试。" });
    let bundle, statistical = req.body?.allowStatistical === true;
    try {
      bundle = prepareReportBundle(req.body);
    } catch {
      // 用户问题或当前视图不可用时，仍可核算有效原始数据的整体统计。
      try {
        bundle = prepareReportBundle({ ...req.body, view: undefined, history: [], questionHistory: [] });
        statistical = true;
      } catch {
        return res.status(400).json({ error: "请先确认有效数据、指标及筛选条件。" });
      }
    }
    active++;
    const controller = new AbortController(), aiController = new AbortController();
    const timer = setTimeout(() => aiController.abort(new DOMException("报告分析超时", "TimeoutError")), aiTimeoutMs);
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    res.set({
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.flushHeaders();
    const emit = (e) => {
      if (!res.destroyed) res.write(JSON.stringify(e) + "\n");
    };
    try {
      emit({ type: "progress", stage: 0, text: "已核对当前数据与统计口径" });
      emit({
        type: "progress",
        stage: 1,
        text: process.env.AI_API_KEY && !statistical
          ? "千问 正在撰写分析解读"
          : "正在整理统计解读",
      });
      const build = async (useStatistics) => {
        controller.signal.throwIfAborted();
        const source = useStatistics ? structuredClone(bundle) : bundle;
        const { snapshot, narrative } = await compose(source, {
          statistical: useStatistics,
          signal: useStatistics ? controller.signal : AbortSignal.any([controller.signal, aiController.signal]),
          onFailure: failure => {
            console.warn("[report]", JSON.stringify({ recordId: typeof req.body.recordId === "string" ? req.body.recordId.slice(0, 64) : undefined, scope: failure.scope, kind: failure.kind, reason: failure.kind === "ZodError" ? "invalid-report-structure" : failure.reason, violation: failure.violation, fields: failure.fields, unsupportedTokenCount: failure.tokens?.length, attempt: failure.attempt }));
          },
          onProgress: text => emit({ type: "progress", stage: 1, text }),
          onModel: event => emit(event),
        });
        controller.signal.throwIfAborted();
        if (!useStatistics && (aiController.signal.aborted || narrative.mode !== "ai" || narrative.questionSection && narrative.questionSection.mode !== "ai")) {
          throw new Error(narrative.failureCode || "report-incomplete");
        }
        emit({
          type: "progress", stage: 2,
          text: narrative.mode === "ai" ? "AI 解读已完成，正在排版 PDF" : "正在将统计解读排版为 PDF",
        });
        const pdf = await renderPdf(snapshot, narrative);
        if (!pdf?.bytes?.length || pdf.bytes.subarray(0, 5).toString() !== "%PDF-" || !(pdf.pages > 0)) throw new Error("invalid-report-pdf");
        return { snapshot, narrative, pdf };
      };
      // 保留统计快照，避免模型查询规划原地改变专题后污染重试。
      const statisticalBundle = structuredClone(bundle);
      let generated;
      try {
        generated = await build(statistical);
      } catch (error) {
        if (controller.signal.aborted || res.destroyed) return;
        if (statistical) throw error;
        clearTimeout(timer);
        aiController.abort();
        bundle = statisticalBundle;
        statistical = true;
        emit({ type: "progress", stage: 2, text: "正在整理统计结果与图表，准备报告预览" });
        generated = await build(true);
      }
      const { snapshot, narrative, pdf } = generated;
      if (controller.signal.aborted) return;
      emit({
        type: "result",
        result: {
          pdf: pdf.bytes.toString("base64"),
          pages: pdf.pages,
          title: snapshot.title,
          reportScope: "overall",
          metric: snapshot.metric.key,
          mode: narrative.mode,
          notice: narrative.notice,
          createdAt: snapshot.createdAt,
          narrative,
          questions: snapshot.questionSection?.questions || [],
          model: narrative.mode==='ai' ? narrative.model || textModel() : '程序统计',
          models: narrative.models || [],
          chartCount: narrative.chapters.length + Math.min(2, narrative.questionSection?.chapters.length || 0),
          fileName:
            snapshot.title.replace(/[\\/:*?"<>|]/g, "_") + "-分析报告.pdf",
        },
      });
    } catch {
      emit({
        type: "error",
        error: controller.signal.aborted
          ? "报告生成已停止或超时，请重试。"
          : "PDF 报告生成失败，请稍后重试。",
      });
    } finally {
      active--;
      clearTimeout(timer);
      aiController.abort();
      res.end();
    }
  });
  return router;
}
