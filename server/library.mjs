import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateDataset } from "../src/data.mjs";
import { validateView } from "../src/analysis.mjs";
import { validateStoredReport } from "./report/storage.mjs";
import { withAssetLock, assertAssetLive, createAssetLifecycle } from './assetLifecycle.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
function invalid(message = "资产内容格式不正确。", status = 400) {
  return Object.assign(new Error(message), { status });
}
function text(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()))
    throw invalid();
  return value;
}
function datasetFor(value) {
  if (value?.title !== undefined) text(value.title, 80, true);
  if (value?.source !== undefined) text(value.source, 300);
  return { ...validateDataset(value), source: value.source ?? "已保存数据" };
}
function boardFor(items) {
  if (!Array.isArray(items) || items.length > 24) throw invalid("看板最多保存 24 张图表。");
  const ids = new Set();
  return items.map(item => {
    if (!uuid.test(item?.id) || ids.has(item.id.toLowerCase()) ||
        !["wide", "normal"].includes(item.size) ||
        !["bar", "line", "pie"].includes(item.chart) || typeof item.sort !== "boolean" ||
        !item.view || typeof item.view !== "object" || Array.isArray(item.view)) throw invalid();
    ids.add(item.id.toLowerCase());
    const dataset = datasetFor(item.dataset);
    const view = validateView(dataset, item.view);
    for (const filter of view.filters) {
      for (const value of Array.isArray(filter.value) ? filter.value : [filter.value]) {
        if (typeof value === "string") text(value, 200);
        else if (!Number.isFinite(value)) throw invalid();
      }
    }
    if (!dataset.metrics.some(metric => metric.key === item.metricKey)) throw invalid("看板指标不在数据集中。");
    const createdAt = text(item.createdAt, 40, true);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) throw invalid();
    return {
      id: item.id, title: text(item.title, 80, true), note: text(item.note, 2000), size: item.size,
      dataset, view, metricKey: item.metricKey, chart: item.chart, sort: item.sort,
      question: text(item.question, 12000), createdAt,
    };
  });
}
const metadata = ({ id, title, category, dataset, createdAt, updatedAt }) => ({
  id, title, category, rows: dataset.rows.length, metrics: dataset.metrics.length,
  dimensions: dataset.dimensions?.length || 0, createdAt, updatedAt,
});
const detail = item => ({ ...metadata(item), dataset: item.dataset });

export function libraryRouter() {
  const router = Router(), queues = new Map();
  const root = process.env.LIBRARY_STORE || fileURLToPath(new URL("../.data/library", import.meta.url));
  const analyses = process.env.ANALYSIS_STORE || fileURLToPath(new URL("../.data/analyses", import.meta.url));
  const fileFor = (directory, user) => path.join(directory,
    createHash("sha256").update(user.username.toLowerCase()).digest("hex") + ".json");
  async function read(file, fallback) {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
  }
  async function load(user) {
    const file = fileFor(root, user);
    await queues.get(file);
    return withAssetLock(user,()=>read(file, { datasets: [], items: [] }));
  }
  async function change(user, update) {
    const file = fileFor(root, user);
    const operation = (queues.get(file) || Promise.resolve()).catch(() => {}).then(() => withAssetLock(user,async () => {
      const state = await read(file, { datasets: [], items: [] });
      const result = await update(state);
      await mkdir(root, { recursive: true });
      await writeFile(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
      await rename(file + ".tmp", file);
      return result;
    }));
    queues.set(file, operation.catch(() => {}));
    return operation;
  }
  const handle = (action, status = 200) => async (req, res) => {
    try { res.status(status).json(await action(req)); }
    catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.message : "资产暂时无法保存或读取，请稍后重试。" });
    }
  };
  router.use((req, res, next) => {
    let owner = req.get("X-Workspace-Owner");
    try { if (owner !== undefined) owner = decodeURIComponent(owner); }
    catch { return res.status(400).json({ error: "账号请求格式不正确。" }); }
    if ((owner !== undefined && owner !== req.user.username) ||
        (owns(req.body, "owner") && req.body.owner !== req.user.username))
      return res.status(409).json({ error: "登录账号已改变，请刷新页面后继续。" });
    next();
  });
  router.get("/datasets", handle(async req => ({
    items: (await load(req.user)).datasets.map(metadata).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  })));
  router.post("/datasets", handle(async req => {
    let dataset, category;
    try { dataset = datasetFor(req.body?.dataset); category = text(req.body?.category ?? "未分类", 40); }
    catch { throw invalid("数据集格式或分类不正确，请完成数据核对后重试。"); }
    return change(req.user, async state => {
      await assertAssetLive(req.user,dataset);
      const now = new Date().toISOString();
      const item = { id: randomUUID(), title: dataset.title, category, dataset, createdAt: now, updatedAt: now };
      state.datasets.push(item);
      return { item: detail(item) };
    });
  }, 201));
  router.get("/datasets/:id", handle(async req => {
    const item = (await load(req.user)).datasets.find(item => item.id === req.params.id);
    if (!item) throw invalid("没有找到该账号的数据集。", 404);
    return { item: detail(item) };
  }));
  router.patch("/datasets/:id", handle(async req => {
    if (!owns(req.body, "title") && !owns(req.body, "category")) throw invalid();
    if (owns(req.body, "title")) text(req.body.title, 80, true);
    if (owns(req.body, "category")) text(req.body.category, 40);
    return change(req.user, state => {
      const item = state.datasets.find(item => item.id === req.params.id);
      if (!item) throw invalid("没有找到该账号的数据集。", 404);
      if (owns(req.body, "title")) item.dataset.title = item.title = req.body.title;
      if (owns(req.body, "category")) item.category = req.body.category;
      item.updatedAt = new Date().toISOString();
      return { item: detail(item) };
    });
  }));
  router.delete('/datasets/:id', handle(req => createAssetLifecycle().remove(req.user,'dataset',req.params.id,req.body?.token)));
  router.get("/board", handle(async req => {
    const state = await load(req.user);
    return { items: state.items, revision: state.boardRevision || 0 };
  }));
  router.put("/board", handle(async req => {
    const revision = req.body?.revision;
    if (!Number.isInteger(revision) || revision < 0) throw invalid("看板版本格式不正确，请重新载入后再保存。");
    let items;
    try { items = boardFor(req.body?.items); }
    catch { throw invalid("看板内容格式不正确，最多保存 24 张图表。"); }
    return change(req.user, async state => {
      if (revision !== (state.boardRevision || 0))
        throw invalid("看板已在其他页面更新，请重新载入后再保存。", 409);
      if (state.items.some(previous => !items.some(item => item.id === previous.id)))
        throw invalid('移除图表前需要核对关联内容，请使用图表的删除按钮确认。',409);
      for(const item of items)await assertAssetLive(req.user,item.dataset,'charts',item.id);
      state.items = items;
      state.boardRevision = revision + 1;
      return { items, revision: state.boardRevision };
    });
  }));
  router.get("/reports", handle(async req => {
    const records = await withAssetLock(req.user,()=>read(fileFor(analyses, req.user), []));
    const reports = [];
    for (const record of records) {
      if (record.deletedAt || !uuid.test(record.id) || !record.workspace?.report) continue;
      try {
        const { result } = validateStoredReport(record.workspace.report);
        if (typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) continue;
        const { title, createdAt, mode, pages, chartCount, model } = result;
        reports.push({ id: record.id, title, createdAt, updatedAt: record.updatedAt, mode, pages, chartCount, model });
      } catch { /* Older or malformed reports do not belong in the index. */ }
    }
    return { reports: reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }));
  return router;
}
