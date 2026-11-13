import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reportKeyFor } from "../src/reportState.mjs";
test("authenticated records are durable and isolated across accounts", async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "seet-records-"));
  const s = http.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  const startServer = () => spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      USER_STORE: path.join(temp, "users.json"),
      ANALYSIS_STORE: path.join(temp, "records"),
      LIBRARY_STORE:path.join(temp,"library"),SHEETS_STORE:path.join(temp,"sheets"),
      AI_API_KEY: "",
      AI_MODEL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let child = startServer();
  t.after(async () => {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    await rm(temp, { recursive: true, force: true });
  });
  await new Promise((r) => child.stdout.once("data", r));
  const base = `http://127.0.0.1:${port}`;
  const req = (route, method = "GET", body, cookie) =>
    fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await req("/api/analyses")).status, 401);
  assert.equal((await req('/api/report','POST',{})).status,401);
  assert.equal(
    (await req("/api/speech", "POST", { audio: "invalid" })).status,
    401,
  );
  assert.equal(
    (await req("/api/chat", "POST", { text: "转换成饼状图" })).status,
    401,
  );
  const signup = async (username) => {
    const r = await req("/api/auth/register", "POST", {
      username,
      password: "Record-test-2026!",
    });
    assert.equal(r.status, 201);
    return r.headers.get("set-cookie");
  };
  const a = await signup("records_a"),
    b = await signup("records_b");
  const workspace = {
    dataset: {
      title: "甲的销售",
      metrics: [{ key: "销量", unit: "杯" }],
      rows: [{ name: "周一", 销量: 120 }],
    },
    draft: null,
    messages: [{ role: "user", text: "甲的私有记录" }],
    chart: "pie",
    metricKey: "销量",
    tab: "chart",
    sort: false,
    view: {
      groupBy: "",
      granularity: "none",
      aggregation: "auto",
      filters: [],
    },
  };
  const id = "11111111-1111-4111-8111-111111111111";
  const reportResponse = await req("/api/report", "POST", { ...workspace, owner: "records_a" }, a);
  const reportEvents = (await reportResponse.text()).trim().split("\n").map(line => JSON.parse(line));
  assert.ok(!reportEvents.some(e => e.type === "error"));
  assert.equal(reportEvents.find(e => e.type === "result")?.result.mode, "rules");
  const statistical = await req("/api/report", "POST", { ...workspace, owner: "records_a", allowStatistical: true }, a);
  const statisticalEvents = (await statistical.text()).trim().split("\n").map(line => JSON.parse(line));
  const reportResult = statisticalEvents.find(e => e.type === "result")?.result;
  assert.equal(reportResult.mode, "rules");
  assert.ok(reportResult.narrative.answer.includes("统计"));
  assert.equal(Buffer.from(reportResult.pdf, "base64").subarray(0, 5).toString(), "%PDF-");
  workspace.questionHistory=Array.from({length:125},(_,i)=>`第${i+1}个完整用户问题`);
  workspace.report = { key: reportKeyFor(workspace), result: reportResult };
  let r = await req("/api/analyses/" + id, "PUT", { workspace }, a);
  assert.equal(r.status, 200);
  assert.equal(
    (await (await req("/api/analyses", "GET", null, a)).json()).records.length,
    1,
  );
  assert.equal(
    (await (await req("/api/analyses", "GET", null, b)).json()).records.length,
    0,
  );
  assert.equal((await req("/api/analyses/" + id, "GET", null, b)).status, 404);
  const restored = (
    await (await req("/api/analyses/" + id, "GET", null, a)).json()
  ).record;
  assert.equal(restored.workspace.chart, "pie");
  assert.deepEqual(restored.workspace.questionHistory,workspace.questionHistory);
  assert.equal(restored.workspace.dataset.rows[0].销量, 120);
  assert.deepEqual(restored.workspace.view, workspace.view);
  assert.equal(restored.workspace.report.result.pdf, reportResult.pdf);
  assert.equal(restored.workspace.report.result.narrative.summary, reportResult.narrative.summary);
  assert.equal(restored.workspace.report.key, reportKeyFor(restored.workspace));
  const relogin = await req("/api/auth/login", "POST", { username: "records_a", password: "Record-test-2026!" });
  const freshCookie = relogin.headers.get("set-cookie");
  assert.equal((await (await req("/api/analyses/" + id, "GET", null, freshCookie)).json()).record.workspace.report.result.pdf, reportResult.pdf);
  const badReport = { ...workspace, report: { ...workspace.report, result: { ...reportResult, pdf: "not-a-pdf" } } };
  assert.equal((await req("/api/analyses/" + id, "PUT", { workspace: badReport }, a)).status, 400);
  assert.equal(
    (await req("/api/agent", "POST", { text: "分析数据" })).status,
    401,
  );
  await req(
    "/api/analyses/" + id,
    "PUT",
    {
      workspace: {
        ...workspace,
        report: null,
        dataset: { ...workspace.dataset, title: "乙的独立记录" },
      },
    },
    b,
  );
  assert.equal(
    (await (await req("/api/analyses/" + id, "GET", null, a)).json()).record
      .workspace.dataset.title,
    "甲的销售",
  );
  assert.equal((await (await req("/api/analyses/" + id, "GET", null, b)).json()).record.workspace.report, null);
  const chinese = await signup("记录账号甲");
  const unicodeRead = await fetch(base + "/api/analyses", {
    headers: {
      Cookie: chinese,
      "X-Workspace-Owner": encodeURIComponent("记录账号甲"),
    },
  });
  assert.equal(unicodeRead.status, 200);
  const mismatch = await fetch(base + "/api/analyses", {
    headers: { Cookie: b, "X-Workspace-Owner": "records_a" },
  });
  assert.equal(mismatch.status, 409);
  const deleteGroup = async (owner,cookie) => {
    const plan=await (await req('/api/assets/preview-delete','POST',{owner,kind:'analysis',id},cookie)).json();
    const r=await req('/api/assets/delete','POST',{owner,kind:'analysis',id,token:plan.token},cookie);
    assert.equal(r.status,200);return r.json();
  };
  assert.equal((await req('/api/analyses/'+id,'DELETE',{},b)).status,409);
  await deleteGroup('records_b',b);
  assert.equal((await req('/api/analyses/'+id,'GET',null,a)).status,200);
  assert.equal((await req('/api/analyses/'+id,'GET',null,b)).status,404);
  const deleted=await deleteGroup('records_a',a);
  assert.equal((await (await req('/api/analyses','GET',null,a)).json()).records.length,0);
  assert.equal((await req('/api/analyses/'+id,'PUT',{workspace},a)).status,409);
  assert.equal((await req('/api/analyses/'+id+'/restore','POST',{},a)).status,409);
  assert.equal((await req('/api/assets/restore','POST',{owner:'records_a',deletionId:deleted.deletionId},a)).status,200);
  assert.equal((await req('/api/analyses/'+id,'GET',null,a)).status,200);
  const recovered = (await (await req('/api/analyses/'+id,'GET',null,a)).json()).record;
  assert.equal(recovered.workspace.report.result.pdf, reportResult.pdf);
  const stopped = new Promise(resolve => child.once("exit", resolve));
  child.kill();
  await stopped;
  child = startServer();
  await new Promise(resolve => child.stdout.once("data", resolve));
  const afterRestartLogin = await req("/api/auth/login", "POST", { username: "records_a", password: "Record-test-2026!" });
  assert.equal(afterRestartLogin.status, 200);
  const afterRestart = (await (await req("/api/analyses/" + id, "GET", null, afterRestartLogin.headers.get("set-cookie"))).json()).record;
  assert.equal(afterRestart.workspace.report.result.pdf, reportResult.pdf);
  assert.equal(afterRestart.workspace.report.result.createdAt, reportResult.createdAt);
  // Raw-only imports must remain restorable before any paid AI call succeeds.
  const sourceId='22222222-2222-4222-8222-222222222222';
  const currentCookie=afterRestartLogin.headers.get('set-cookie');
  const rawOnly={...workspace,dataset:null,draft:null,view:null,report:null,source:{sheetId:sourceId,projectId:sourceId,title:'待分析原表'}};
  assert.equal((await req('/api/analyses/'+sourceId,'PUT',{workspace:rawOnly},currentCookie)).status,200);
  const rawRestored=(await (await req('/api/analyses/'+sourceId,'GET',null,currentCookie)).json()).record.workspace;
  assert.deepEqual(rawRestored.source,rawOnly.source);
  assert.equal(rawRestored.dataset,null);
  for(const source of ['invalid',[],{}, {sheetId:'invalid'}]){
    assert.equal((await req('/api/analyses/'+sourceId,'PUT',{workspace:{...rawOnly,source}},currentCookie)).status,400);
  }
});
