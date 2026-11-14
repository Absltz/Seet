// Server events confirm stage changes. Elapsed time never confirms completion.
export function reportProgress(progress = {}, statistical = false) {
 const text = progress.text || '';
 const isStatistical = statistical || /统计解读|统计结果/.test(text);
 const rawStage = Number.isFinite(progress.stage) ? Math.trunc(progress.stage) : 0;
 // Fallback announces stage 2 before statistical composition has completed.
 const stage = /正在整理统计结果/.test(text) ? 1 : Math.max(0, Math.min(2, rawStage));
 const labels = [
  {label: '核对数据与分析问题', detail: '保留完整数据，确认统计口径'},
  {label: isStatistical ? '整理统计结果与图表' : '分析数据并撰写解读', detail: isStatistical ? '依据确定性统计整理分析结论' : '围绕数据与已提出的问题展开分析'},
  {label: '排版并生成 PDF', detail: '核对报告图表，准备预览与导出'},
 ];
 return {
  statistical: isStatistical,
  modeLabel: isStatistical ? '统计报告' : progress.model || 'AI 分析报告',
  stage,
  completed: stage,
  steps: labels.map((step, index) => ({...step, status: index < stage ? 'complete' : index === stage ? 'current' : 'pending'})),
 };
}
