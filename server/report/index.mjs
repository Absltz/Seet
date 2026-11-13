import { Router } from "express";
import { prepareReportBundle } from "./snapshot.mjs";
import { reportFailureMessage } from "./narrative.mjs";
import { composeReport } from "./compose.mjs";
import { renderReportPdf } from "./pdf.mjs";
import {textModel} from '../provider.mjs';
export function reportRouter() {
  const router = Router();
  let active = 0;
  router.post("/", async (req, res) => {
    if (req.body?.owner && req.body.owner !== req.user.username)
      return res.status(409).json({ error: "账号已改变，请刷新后重试。" });
    if (active >= 2)
      return res.status(429).json({ error: "报告正在生成，请稍后重试。" });
    let bundle;
    try {
      bundle = prepareReportBundle(req.body);
    } catch (error) {
      return res
        .status(error.code === "history_too_long" ? 413 : 400)
        .json({ ...(error.code === "history_too_long" ? { code: error.code } : {}), error: error.code === "history_too_long" ? error.message : "请先确认有效数据、指标及筛选条件。" });
    }
    active++;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 300000);
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
        text: process.env.AI_API_KEY && req.body.allowStatistical !== true
          ? "千问 正在撰写分析解读"
          : "正在整理统计解读",
      });
      const { snapshot, narrative } = await composeReport(bundle, {
        statistical: req.body.allowStatistical === true,
        signal: controller.signal,
        onFailure: failure => {
          console.warn("[report]", JSON.stringify({ recordId: typeof req.body.recordId === "string" ? req.body.recordId.slice(0, 64) : undefined, scope: failure.scope, kind: failure.kind, reason: failure.reason, violation: failure.violation, unsupportedTokenCount: failure.tokens?.length, attempt: failure.attempt }));
        },
        onProgress: text => emit({ type: "progress", stage: 1, text }),
        onModel: event => emit(event),
      });
      if (controller.signal.aborted) return;
      if ((narrative.mode !== "ai" || narrative.questionSection && narrative.questionSection.mode !== "ai") && req.body.allowStatistical !== true) {
        emit({ type: "error", code: narrative.failureCode, error: reportFailureMessage(narrative.failureCode, narrative.failureModel || narrative.model) });
        return;
      }
      emit({
        type: "progress",
        stage: 2,
        text:
          narrative.mode === "ai"
            ? "AI 解读已完成，正在排版 PDF"
            : "正在将统计解读排版为 PDF",
      });
      const pdf = await renderReportPdf(snapshot, narrative);
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
      res.end();
    }
  });
  return router;
}
