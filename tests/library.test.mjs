import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataset = {
  title: "门店销量", source: "本地导入 sales.csv",
  metrics: [{ key: "销量", unit: "杯" }],
  dimensions: [{ key: "地区", type: "text" }],
  rows: [{ name: "周一", 地区: "东区", 销量: 120 }],
};
const view = { groupBy: "地区", granularity: "none", aggregation: "sum", filters: [] };
const boardItem = () => ({
  id: randomUUID(), title: "地区销售", note: "关注东区", size: "wide",
  dataset:{...dataset,projectId:randomUUID()}, view, metricKey: "销量", chart: "bar", sort: true,
  question: "哪个地区销量最高？", createdAt: "2026-11-02T01:00:00.000Z",
});
const reportResult = {
  pdf: Buffer.from("%PDF-1.7\nfixture\n%%EOF").toString("base64"),
  title: "门店分析报告", metric: "销量", mode: "rules", notice: "统计报告",
  createdAt: "2026-11-02T02:00:00.000Z", fileName: "report.pdf", pages: 2,
  chartCount: 1, model: "rules", questions: [],
  narrative: { mode: "rules", notice: "统计报告", summary: "销售概况", answer: "东区 120 杯",
    findings: [], chapters: [], nextSteps: [], limitations: [] },
};

test("library APIs protect, validate and persist account assets", async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "seet-library-"));
  const listener = http.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PORT: String(port), USER_STORE: path.join(temp, "users.json"),
        LIBRARY_STORE: path.join(temp, "library"), ANALYSIS_STORE: path.join(temp, "analyses"), SHEETS_STORE:path.join(temp,"sheets"),
        AI_API_KEY: "", AI_MODEL: "" }, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("server startup timed out")), 15000);
      child.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`server exited ${code}`)); });
    });
  };
  const stop = async () => {
    if (child?.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill(); await exited;
    }
  };
  t.after(async () => { await stop(); await rm(temp, { recursive: true, force: true }); });
  await start();
  const req = (route, method = "GET", body, cookie, headers = {}) => fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const signup = async username => {
    const response = await req("/api/auth/register", "POST", { username, password: "Library-test-2026!" });
    assert.equal(response.status, 201); return response.headers.get("set-cookie");
  };
  let a = await signup("library_a");
  const b = await signup("library_b");
  await t.test("requires authentication on every library endpoint", async () => {
    for (const [route, method, body] of [
      ["/datasets"], ["/datasets", "POST", { dataset }], ["/datasets/" + randomUUID()],
      ["/datasets/" + randomUUID(), "PATCH", { title: "改名" }], ["/datasets/" + randomUUID(), "DELETE"],
      ["/board"], ["/board", "PUT", { items: [] }], ["/reports"],
    ]) assert.equal((await req("/api/library" + route, method, body)).status, 401, route);
  });
  await t.test("starts empty and rejects stale body/header owners including falsy values", async () => {
    for (const route of ["datasets", "board", "reports"]) {
      const response = await req("/api/library/" + route, "GET", undefined, a);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), route === "reports" ? { reports: [] } : route === "board" ? { items: [], revision: 0 } : { items: [] });
      assert.equal((await req("/api/library/" + route, "GET", undefined, a, { "X-Workspace-Owner": "library_b" })).status, 409);
    }
    for (const owner of ["library_b", "", null, false]) {
      assert.equal((await req("/api/library/datasets", "POST", { owner, dataset }, a)).status, 409);
      assert.equal((await req("/api/library/board", "PUT", { owner, items: [] }, a)).status, 409);
    }
    assert.equal((await req("/api/library/board", "GET", undefined, a, { "X-Workspace-Owner": "%broken" })).status, 400);
    const chinese = await signup("数据账号甲");
    assert.equal((await req("/api/library/board", "GET", undefined, chinese, { "X-Workspace-Owner": encodeURIComponent("数据账号甲") })).status, 200);
  });
  const deleteAsset = async (owner,cookie,kind,id) => {
    const plan = await (await req('/api/assets/preview-delete','POST',{owner,kind,id},cookie)).json();
    return req('/api/assets/delete','POST',{owner,kind,id,token:plan.token},cookie);
  };
  await t.test("board revisions reject stale clients without erasing newer cards", async () => {
    const clientA = await signup("library_cas");
    const login = await req("/api/auth/login", "POST", { username: "library_cas", password: "Library-test-2026!" });
    const clientB = login.headers.get("set-cookie");
    const snapshotA = await (await req("/api/library/board", "GET", undefined, clientA)).json();
    const snapshotB = await (await req("/api/library/board", "GET", undefined, clientB)).json();
    assert.deepEqual(snapshotA, { items: [], revision: 0 });
    assert.deepEqual(snapshotB, snapshotA);
    const newer = boardItem();
    const saved = await req("/api/library/board", "PUT", { revision: snapshotB.revision, items: [newer] }, clientB);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { items: [newer], revision: 1 });
    const stale = await req("/api/library/board", "PUT", { revision: snapshotA.revision, items: [] }, clientA);
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: "看板已在其他页面更新，请重新载入后再保存。" });
    assert.deepEqual(await (await req("/api/library/board", "GET", undefined, clientA)).json(), { items: [newer], revision: 1 });
    for (const revision of [undefined, null, -1, 0.5, "1", true]) {
      assert.equal((await req("/api/library/board", "PUT", { revision, items: [] }, clientA)).status, 400);
    }
    const contenders = [boardItem(), boardItem()];
    const responses = await Promise.all(contenders.map((item, index) => req("/api/library/board", "PUT", { revision: 1, items: [newer,item] }, index ? clientB : clientA)));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const winner = contenders[responses.findIndex(response => response.status === 200)];
    assert.deepEqual(await (await req("/api/library/board", "GET", undefined, clientA)).json(), { items: [newer,winner], revision: 2 });
  });
  await t.test("dataset CRUD exposes metadata only in lists and isolates both accounts", async () => {
    const response = await req("/api/library/datasets", "POST", { owner: "library_a", dataset, category: "业务" }, a);
    assert.equal(response.status, 201);
    const { item } = await response.json();
    assert.match(item.id, /^[a-f0-9-]{36}$/i);
    assert.equal(item.dataset.source, dataset.source);
    const listed = (await (await req("/api/library/datasets", "GET", undefined, a)).json()).items;
    assert.deepEqual(listed, [{ id: item.id, title: dataset.title, category: "业务", rows: 1, metrics: 1, dimensions: 1,
      createdAt: item.createdAt, updatedAt: item.updatedAt }]);
    assert.equal((await req("/api/library/datasets/" + item.id, "GET", undefined, b)).status, 404);
    assert.equal((await req("/api/library/datasets/" + item.id, "PATCH", { title: "偷改" }, b)).status, 404);
    assert.equal((await req("/api/library/datasets/" + item.id, "DELETE", undefined, b)).status, 404);
    assert.equal((await req("/api/library/datasets/" + item.id, "PATCH", { owner: "library_b", title: "旧账号" }, a)).status, 409);
    assert.equal((await req("/api/library/datasets/" + item.id, "DELETE", { owner: "library_b" }, a)).status, 409);
    const patched = await req("/api/library/datasets/" + item.id, "PATCH", { owner: "library_a", title: "更新销量", category: "运营" }, a);
    assert.equal(patched.status, 200);
    const updated = (await patched.json()).item;
    assert.equal(updated.title, "更新销量"); assert.equal(updated.dataset.title, updated.title);
    assert.equal(updated.category, "运营"); assert.equal(updated.createdAt, item.createdAt);
    assert.deepEqual((await (await req("/api/library/datasets/" + item.id, "GET", undefined, a)).json()).item, updated);
    assert.equal((await req("/api/library/datasets/" + item.id, "DELETE", undefined, a)).status,409);
    assert.equal((await deleteAsset('library_a',a,'dataset',item.id)).status,200);
    assert.equal((await req("/api/library/datasets/" + item.id, "GET", undefined, a)).status, 404);
  });
  await t.test("rejects invalid dataset, category, patch and board values without overwriting assets", async () => {
    for (const value of [null, {}, { ...dataset, rows: [] }, { ...dataset, rows: [{ name: "a", 销量: "bad" }] },
      { ...dataset, title: "长".repeat(81) }, { ...dataset, source: "长".repeat(301) }]) {
      assert.equal((await req("/api/library/datasets", "POST", { dataset: value }, a)).status, 400);
    }
    assert.equal((await req("/api/library/datasets", "POST", { dataset, category: "长".repeat(41) }, a)).status, 400);
    const created = (await (await req("/api/library/datasets", "POST", { dataset:{...dataset,projectId:randomUUID()} }, a)).json()).item;
    for (const patch of [{ title: "" }, { title: 3 }, { category: {} }, {}])
      assert.equal((await req("/api/library/datasets/" + created.id, "PATCH", patch, a)).status, 400);
    const item = boardItem();
    const { revision } = await (await req("/api/library/board", "GET", undefined, a)).json();
    assert.equal((await req("/api/library/board", "PUT", { items: [item], revision }, a)).status, 200);
    for (const patch of [{ id: "not-uuid" }, { title: "长".repeat(81) }, { note: "长".repeat(2001) },
      { size: "huge" }, { dataset: null }, { view: { ...view, groupBy: "unknown" } },
      { view: { ...view, filters: [{ field: "地区", op: "eq", value: "长".repeat(201) }] } },
      { metricKey: "missing" }, { chart: "scatter" }, { sort: "yes" },
      { question: "长".repeat(12001) }, { createdAt: "bad-date" }]) {
      assert.equal((await req("/api/library/board", "PUT", { items: [{ ...item, ...patch }], revision: revision + 1 }, a)).status, 400, JSON.stringify(Object.keys(patch)));
    }
    for (const items of [null, Array.from({ length: 25 }, boardItem), [item, item]])
      assert.equal((await req("/api/library/board", "PUT", { items, revision: revision + 1 }, a)).status, 400);
    assert.deepEqual(await (await req("/api/library/board", "GET", undefined, a)).json(), { items: [item], revision: revision + 1 });
    assert.equal((await req("/api/library/board", "PUT", { items: [], revision: revision + 1 }, a)).status,409);
    assert.equal((await deleteAsset('library_a',a,'chart',item.id)).status,200);
  });
  await t.test("serializes simultaneous writes and keeps dataset/board state after restart", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => req("/api/library/datasets", "POST", { dataset: { ...dataset, projectId:randomUUID(), title: `数据 ${i}` } }, a)));
    assert.ok(results.every(response => response.status === 201));
    const items = [boardItem(), { ...boardItem(), size: "normal", chart: "line", sort: false }];
    const { revision } = await (await req("/api/library/board", "GET", undefined, a)).json();
    assert.deepEqual(await (await req("/api/library/board", "PUT", { owner: "library_a", items, revision }, a)).json(), { items, revision: revision + 1 });
    assert.deepEqual(await (await req("/api/library/board", "GET", undefined, b)).json(), { items: [], revision: 0 });
    const extra = (await (await req("/api/library/datasets", "POST", { dataset:{...dataset,projectId:randomUUID()} }, a)).json()).item;
    await req("/api/library/datasets/" + extra.id, "PATCH", { title: "保留版本" }, a);
    assert.equal((await deleteAsset('library_a',a,'dataset',extra.id)).status,200);
    assert.deepEqual(await (await req("/api/library/board", "GET", undefined, a)).json(), { items, revision: revision + 1 });
    const before = await (await req("/api/library/datasets", "GET", undefined, a)).json();
    assert.equal(before.items.length, 9);
    await stop(); await start();
    const login = await req("/api/auth/login", "POST", { username: "LIBRARY_A", password: "Library-test-2026!" });
    a = login.headers.get("set-cookie");
    assert.deepEqual(await (await req("/api/library/datasets", "GET", undefined, a)).json(), before);
    assert.deepEqual(await (await req("/api/library/board", "GET", undefined, a)).json(), { items, revision: revision + 1 });
  });
  await t.test("indexes only valid nondeleted reports without returning PDF payloads", async () => {
    const id = randomUUID();
    const workspace = { dataset:{...dataset,projectId:randomUUID()}, view, messages: [], chart: "bar", metricKey: "销量", sort: false,
      report: { key: "1234567890abcdef", result: reportResult } };
    const saved = await req("/api/analyses/" + id, "PUT", { workspace, owner: "library_a" }, a);
    assert.equal(saved.status, 200);
    const { updatedAt } = await saved.json();
    const hash = createHash("sha256").update("library_a").digest("hex");
    const file = path.join(temp, "analyses", hash + ".json");
    const records = JSON.parse(await readFile(file, "utf8"));
    records.push({ ...records[0], id: randomUUID(), deletedAt: updatedAt });
    records.push({ ...records[0], id: randomUUID(), workspace: { ...workspace, report: null } });
    records.push({ ...records[0], id: randomUUID(), workspace: { ...workspace, report: { key: "1234567890abcdef", result: { ...reportResult, pdf: "invalid" } } } });
    await writeFile(file, JSON.stringify(records));
    const indexed = await (await req("/api/library/reports", "GET", undefined, a)).json();
    assert.deepEqual(indexed, { reports: [{ id, title: reportResult.title, createdAt: reportResult.createdAt,
      updatedAt, mode: "rules", pages: 2, chartCount: 1, model: "rules" }] });
    assert.ok(!JSON.stringify(indexed).includes(reportResult.pdf));
    const detail = await req("/api/analyses/" + id, "GET", undefined, a);
    assert.equal((await detail.json()).record.workspace.report.result.pdf, reportResult.pdf);
    const loginB = await req("/api/auth/login", "POST", { username: "library_b", password: "Library-test-2026!" });
    assert.deepEqual(await (await req("/api/library/reports", "GET", undefined, loginB.headers.get("set-cookie"))).json(), { reports: [] });
  });
  await t.test("serves direct library page URLs with the application document", async () => {
    for (const route of ["/datasets", "/boards", "/reports"]) {
      const response = await req(route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type"), /text\/html/);
      assert.match(await response.text(), /id="root"/);
    }
  });
});
