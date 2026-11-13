export async function requestReport(input, onProgress, signal) {
  try {
    return await receiveReport(input, onProgress, signal);
  } catch (error) {
    if (signal?.aborted || input.allowStatistical === true || [400, 401, 403, 409, 413].includes(error.status)) throw error;
    onProgress({ type: "progress", stage: 2, text: "正在整理统计结果与图表，准备报告预览" });
    return receiveReport({ ...input, allowStatistical: true }, onProgress, signal);
  }
}

async function receiveReport(input, onProgress, signal) {
  const response = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("seet:auth-expired"));
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || "报告请求失败。"), { status: response.status });
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson"))
    throw new Error("报告服务未更新，请重启作品服务。");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    result;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop();
      if (done && pending.trim()) { lines.push(pending); pending = ""; }
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "progress" || event.type === "model") onProgress(event);
        if (event.type === "result") result = event.result;
      }
      if (done) break;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  if (!result) throw new Error("报告生成连接已中断，请重试。");
  const binary = atob(result.pdf),
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (!binary.startsWith("%PDF-")) throw new Error("报告文件未接收完整。");
  delete result.pdf;
  return { ...result, bytes };
}
