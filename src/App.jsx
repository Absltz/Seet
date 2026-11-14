import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useSidebarMotion } from "./useSidebarMotion.jsx";
import { useChartSelection } from './useChartSelection.jsx';
import ChartSelectionBar from './components/ChartSelectionBar.jsx';
import './chart-selection.css';
import {
  ArrowUp,
  ArrowUpRight,
  Upload,
  Plus,
  ChartNoAxesColumnIncreasing,
  ChartLine,
  ChartPie,
  Table2,
  FileText,
  Download,
  Check,
  ChevronDown,
  ChevronsUpDown,
  X,
  Info,
  Sparkles,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  CheckCheck,
  SlidersHorizontal,
  LoaderCircle,
  FileSpreadsheet,
  ArrowRight,
  BookOpen,
  Link2,
  AudioLines,
  Square,
  LayoutDashboard,
} from "lucide-react";
import Papa from "papaparse";
import AssistantReply from './components/AssistantReply.jsx';
import {
  fromMatrix,
  validateDataset,
  summarize,
  csvExport,
} from "./data.mjs";
import { apiRequest, agentRequest, importRequest } from "./api.mjs";
import { tableFromMatrix, tableFromDataset, validateRawTable } from './rawTable.mjs';
import ImportReviewPanel from './components/ImportReviewPanel.jsx';
import { metricHeadline } from './metricHeadline.mjs';
import {
  buildView,
  filterSource,
  defaultView,
  dimensionsFor,
  aggregationFor,
} from "./analysis.mjs";
import { HelpPage, LoginPage } from "./pages.jsx";
import { HomePage } from "./Experience.jsx";
import { usePageMotion } from "./usePageMotion.jsx";
import { useRecords, emptyWorkspace } from "./useRecords.jsx";
import { useVoiceInput } from "./useVoiceInput.jsx";
import {captureSourceFile} from './sheets/sourceFile.mjs';
import { useAssetDeletion } from './components/AssetDeletion.jsx';
import ReportStudio from "./components/ReportStudio.jsx";
import { format } from "./format.mjs";
import { reportKeyFor, serializeReport, restoreReport } from "./reportState.mjs";
import {questionHistoryFor} from './conversationHistory.mjs';
const ChartView = lazy(() => import("./components/ChartView.jsx"));
const LibraryPages = lazy(() => import("./library/LibraryPages.jsx"));
const CollectionPage = lazy(() => import('./library/CollectionPage.jsx'));
const SpreadsheetPage = lazy(() => import('./sheets/SpreadsheetPage.jsx'));
const TrashPage = lazy(() => import('./components/TrashPage.jsx'));
import DataTable from "./components/DataTable.jsx";
import ChartBoundary from "./components/ChartBoundary.jsx";
import WorkbenchSurface, { AICore } from "./components/WorkbenchSurface.jsx";
import WorkspaceNav from "./components/WorkspaceNav.jsx";

const clubText =
  "摄影社报名80人、到场62人；篮球社报名120人、到场108人；读书会报名50人、到场45人。";
function download(filename, text, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Logo() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <strong>见数</strong>
      <span className="brand-en">Seet</span>
    </span>
  );
}
export default function App() {
  const {requestDeletion} = useAssetDeletion();
  const [assetRevision, setAssetRevision] = useState(0);
  const [dataset, setDataset] = useState(null);
  const [workspaceSource, setWorkspaceSource] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [sheetIncoming, setSheetIncoming] = useState(null);
  const [reportInput, setReportInput] = useState(null);
  const [storedReport, setStoredReport] = useState(null);
  const reportCache = useMemo(() => restoreReport(storedReport), [storedReport]);
  const [view, setView] = useState(null),
    [agentSteps, setAgentSteps] = useState([]),
    [agentStatus, setAgentStatus] = useState("");
  const agentAbort = useRef(null);
  const [draft, setDraft] = useState(null),
    [text, setText] = useState(""),
    [metricKey, setMetricKey] = useState("销量");
  const [tab, setTab] = useState(
    () => new URLSearchParams(location.search).get("tab") || "chart",
  );
  const [chart, setChart] = useState("bar"),
    [sort, setSort] = useState(false),
    [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState(location.pathname),
    [user, setUser] = useState(null);
  const workspaceRoot = useRef(null);
  const [sidebar, setSidebar] = useSidebarMotion(workspaceRoot, page);
  const leaveHome = usePageMotion(page);
  const [authPending, setAuthPending] = useState(true);
  const [previous, setPrevious] = useState(null);
  const [assetBusy, setAssetBusy] = useState(false);
  const ownerRef = useRef(user?.username);
  ownerRef.current = user?.username;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('seet:owner-change', {detail:{owner:user?.username}}));
    setSheetIncoming(null);
    setPendingImport(null);
  }, [user?.username]);
  const [aiState, setAIState] = useState("checking"),
    [model, setModel] = useState("qwen3.8-flash"),
    [lastRequest, setLastRequest] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "你好，我是见数。给我一段带数字的话，或一份数据文件，我们一起看看其中的规律。",
    },
  ]);
  const [questionHistory,setQuestionHistory]=useState([]);
  const inputRef = useRef(null),
    fileRef = useRef(null),
    chatEnd = useRef(null),
    version = useRef(0);
  const replyPresentations = useRef(new WeakMap());
  const followConversation = useRef(true);
  const scrollConversation = useCallback(() => {
    const box = chatEnd.current?.parentElement;
    if (box && followConversation.current) box.scrollTop = box.scrollHeight;
  }, []);
  async function checkAI() {
    setAIState("checking");
    try {
      const r = await apiRequest("/api/status");
      setModel(r.model || "qwen3.8-flash");
      setAIState(r.configured ? "ready" : "unconfigured");
    } catch {
      setAIState("offline");
    }
  }
  useEffect(() => {
    checkAI();
    apiRequest("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => {})
      .finally(() => setAuthPending(false));
    const pop = () => setPage(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!authPending && !user && page !== "/login") {
      history.replaceState(null, "", "/login");
      setPage("/login");
    }
  }, [authPending, user, page]);
  useEffect(() => {
    if (page === '/history') {
      history.replaceState(null, '', '/datasets');
      setPage('/datasets');
    }
  }, [page]);
  useEffect(() => {
    const expired = () => {
      version.current++;
      setUser(null);
      setBusy(false);
      history.replaceState(null, "", "/login");
      setPage("/login");
    };
    window.addEventListener("seet:auth-expired", expired);
    return () => window.removeEventListener("seet:auth-expired", expired);
  }, []);
  useEffect(() => {
    document.title =
      page === "/datasets" ? "数据集库 · 见数"
      : page === "/sheets" ? "数据表格 · 见数"
      : page === "/boards" ? "分析看板 · 见数"
      : page === "/reports" ? "报告中心 · 见数"
      : page === "/trash" ? "回收站 · 见数"
      : page === "/history"
        ? "分析记录 · 见数"
        : page === "/help"
          ? "使用说明 · 见数"
          : page === "/login"
            ? "账号登录 · 见数"
            : page === "/home"
              ? "见数 Seet — 让数据，说得更清楚"
              : "见数 — AI 数据分析工作台";
  }, [page]);
  useEffect(() => {
    if (page !== "/") return;
    const u = new URL(location.href);
    u.searchParams.set("tab", tab);
    history.replaceState(null, "", u);
  }, [tab, page]);
  useEffect(() => {
    scrollConversation();
  }, [messages, busy, page, agentStatus, agentSteps, scrollConversation]);
  function navigate(target) {
    const commit = () => {
      if (location.pathname !== target) history.pushState(null, "", target);
      if (page === "/home" && target === "/") setSidebar(true);
      setPage(target);
      window.scrollTo(0, 0);
    };
    if (page === "/home" && target !== page) leaveHome(commit, target);
    else commit();
  }
  function focusAI() {
    navigate("/");
    setSidebar(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const chartSelection = useChartSelection(dataset, view, setView);
  const chartInteraction = { ...chartSelection, disabled: busy || editing };
  const analyzed = useMemo(
    () => (dataset ? chartSelection.selection ? buildView(dataset, view || defaultView(dataset)) : chartSelection.contextData : null),
    [dataset, view, chartSelection.selection, chartSelection.contextData],
  );
  const filteredSource = useMemo(
    () => dataset ? filterSource(dataset, view || defaultView(dataset)) : null,
    [dataset, view],
  );
  const metric =
    analyzed?.metrics.find((m) => m.key === metricKey) || analyzed?.metrics[0];
  const stats = useMemo(
    () => (analyzed && metric ? summarize(analyzed, metric.key) : null),
    [analyzed, metric],
  );
  const headline = useMemo(() => stats && metric ? metricHeadline(dataset,view,metric.key,stats) : null,[dataset,view,metric,stats]);
  const chartData = useMemo(
    () =>
      chartSelection.contextData
        ? {
            ...chartSelection.contextData,
            rows: sort
              ? [...chartSelection.contextData.rows].sort(
                  (a, b) =>
                    (b[metric.key] ?? -Infinity) - (a[metric.key] ?? -Infinity),
                )
              : chartSelection.contextData.rows,
          }
        : null,
    [chartSelection.contextData, chartSelection.dimension?.type, metric, sort],
  );
  const displayed = useMemo(() => analyzed ? {
    ...analyzed,
    rows: sort ? [...analyzed.rows].sort((a, b) => (b[metric.key] ?? -Infinity) - (a[metric.key] ?? -Infinity)) : analyzed.rows,
  } : null, [analyzed, metric, sort]);
  const say = (value, {animate = false, trace} = {}) => {
    const message = {role: 'assistant', text: value, ...(trace?.length ? {trace} : {})};
    if (animate) replyPresentations.current.set(message, {id: crypto.randomUUID(), started: false});
    setMessages(items => [...items, message].slice(-100));
  };
  const presentationFor = message => {
    if (!replyPresentations.current.has(message)) {
      replyPresentations.current.set(message, {id: crypto.randomUUID(), started: true});
    }
    return replyPresentations.current.get(message);
  };
  function restoreWorkspace(state) {
    followConversation.current = true;
    agentAbort.current?.abort();
    setAgentSteps([]);
    setAgentStatus("");
    version.current++;
    setBusy(false);
    setPendingImport(null);
    setWorkspaceSource(state.source || null);
    setDataset(state.dataset);
    setView(state.view || null);
    setDraft(state.draft);
    setMessages(state.messages);
    setQuestionHistory(questionHistoryFor(state));
    setChart(state.chart);
    setSort(state.sort);
    setMetricKey(state.metricKey);
    setTab(state.tab);
    setEditing(false);
    setText("");
    setError("");
    setLastRequest("");
    setPrevious(null);
    setStoredReport(state.report || null);
    if (!state.dataset && !state.draft && state.source?.sheetId) {
      const token = version.current, owner = ownerRef.current;
      apiRequest('/api/sheets/' + state.source.sheetId, undefined, {headers:{'X-Workspace-Owner':encodeURIComponent(owner)}}).then(({item}) => {
        if (token === version.current && owner === ownerRef.current) {
          setPendingImport({table:item.table,sheetId:item.id,rawAlreadySaved:true,awaiting:true,startedAt:Date.now()});
        }
      }).catch(error => { if (token === version.current) setNotice(error.message); });
    }
  }
  const snapshot = useMemo(
    () => ({ dataset, draft, messages, questionHistory, chart, sort, metricKey, tab, view, report: storedReport, source:workspaceSource }),
    [dataset, draft, messages, questionHistory, chart, sort, metricKey, tab, view, storedReport, workspaceSource],
  );
  const records = useRecords(user, snapshot, restoreWorkspace);
  useEffect(() => {
    const changed = event => {
      const result = event.detail;
      if (result.owner !== ownerRef.current) return;
      setSheetIncoming(null);
      setReportInput(null);
      setAssetRevision(value => value + 1);
      if (result.action === 'delete' && (result.projectIds.includes(pendingImport?.table?.projectId) || result.items.sheets.some(item => item.id === pendingImport?.sheetId))) {
        version.current++;
        agentAbort.current?.abort();
        setPendingImport(null);
        setBusy(false);
      }
    };
    window.addEventListener('seet:assets-changed', changed);
    return () => window.removeEventListener('seet:assets-changed', changed);
  }, [pendingImport]);
  useEffect(() => { setReportInput(null); setSheetIncoming(null); }, [user?.username, records.activeId]);
  const reportKey = useMemo(() => reportKeyFor({ dataset, view, metricKey, chart, sort, messages, questionHistory }), [dataset, view, metricKey, chart, sort, messages, questionHistory]);
  const currentReport = reportCache?.key === reportKey ? reportCache.result : null;
  const savedReport = reportCache?.result;
  function openReport(force = false, previewSaved = false) {
    if (!dataset || draft || editing || busy || pendingImport) return;
    setReportInput({
      dataset: structuredClone(dataset),
      view: structuredClone(view),
      metricKey: metric.key,
      chart,
      sort,
      owner: user.username,
      history: questionHistory.map(text => ({role:'user',text})),
      questionHistory:[...questionHistory],
      key: reportKey,
      recordId: records.activeId,
      cachedResult: force ? null : previewSaved ? savedReport : currentReport,
      previousVersion: previewSaved && !currentReport,
    });
  }
  function generateReport() { openReport(false, Boolean(savedReport)); }
  async function openAssets(target) {
    if (busy || assetBusy || editing || records.loading) return;
    try { await records.saveNow(); navigate(target); }
    catch (e) { setNotice(e.message); }
  }
  async function openCollectionItem(item, target) {
    if (busy || assetBusy || editing || records.loading) return;
    const owner = user.username;
    setAssetBusy(true);
    try {
      await records.saveNow();
      const opened = await apiRequest('/api/collection/open', {owner,kind:item.kind,id:item.id,analysisId:item.analysisId || undefined,target});
      if (ownerRef.current !== owner) return;
      if (!await records.openRecord(opened.recordId)) throw new Error('对应分析未能打开，请重新尝试。');
      if (ownerRef.current === owner) navigate(target === 'source' ? '/sheets' : '/');
    } finally { if (ownerRef.current === owner) setAssetBusy(false); }
  }
  async function pinChart() {
    if (!dataset || draft || busy || assetBusy || editing || !metric || pendingImport) return;
    const owner = user.username;
    setAssetBusy(true);
    try {
      const headers = { "X-Workspace-Owner": encodeURIComponent(owner) };
      const { items, revision } = await apiRequest("/api/library/board", undefined, { headers });
      if (ownerRef.current !== owner) return;
      if (items.length >= 24) throw new Error("看板已保存 24 张图表，请先移除不需要的图表。");
      const names = { bar: "柱状图", line: "折线图", pie: "占比图" };
      const item = {
        id: crypto.randomUUID(), title: `${metric.key}${names[chart]}`.slice(0,80),
        note: "", size: items.length === 0 ? "wide" : "normal",
        dataset: structuredClone(dataset), view: structuredClone(view || defaultView(dataset)),
        metricKey: metric.key, chart, sort,
        question: messages.findLast(m => m.role === "user")?.text || "",
        createdAt: new Date().toISOString(),
      };
      await apiRequest("/api/library/board", { owner, revision, items: [...items, item] }, { method: "PUT" });
      if (ownerRef.current === owner) setNotice("图表已加入分析看板，继续提问可保存更多视角");
    } catch (e) { if (ownerRef.current === owner) setNotice(e.message); }
    finally { setAssetBusy(false); }
  }
  async function startDatasetAnalysis(value) {
    if (busy || assetBusy || records.loading) return;
    const owner = user.username;
    setAssetBusy(true);
    try {
      const original = await apiRequest('/api/sheets/resolve',{owner,dataset:value});
      if (ownerRef.current !== owner) return;
      const table = original.item?.table || tableFromDataset(value);
      if (!await records.newRecord()) throw new Error("原分析未保存，请返回工作台重试保存。");
      if (ownerRef.current !== owner) return;
      navigate("/");
      await prepareImport(table,original.item?{sheetId:original.item.id,rawAlreadySaved:true}:{});
    } catch (e) { if (ownerRef.current === owner) setNotice(e.message); }
    finally { setAssetBusy(false); }
  }
  async function uploadFromLibrary() {
    if (busy || assetBusy || records.loading) return;
    if (!await records.newRecord()) { setNotice("请先保存当前分析，再导入新数据。"); return; }
    navigate("/");
    requestAnimationFrame(() => fileRef.current?.click());
  }
  const voice = useVoiceInput({
    owner: user?.username,
    scope: `${user?.username || ""}:${records.activeId}`,
    disabled: busy || editing || records.loading || !user,
    onText: (recognized) => {
      setText((current) => (current ? current + " " + recognized : recognized));
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  });
  async function clear() {
    await records.newRecord();
    setSidebar(true);
    inputRef.current?.focus();
  }
  function showTable(table) {
    setSheetIncoming({ id: crypto.randomUUID(), owner:user.username, table });
    navigate('/sheets');
  }
  async function prepareImport(value, options = {}) {
    const table = validateRawTable(value), owner = user.username;
    const token = ++version.current, controller = new AbortController();
    agentAbort.current = controller;
    const job = { table, startedAt: Date.now(), sheetId: options.sheetId || null, ...(options.originalFile ? {originalFile:options.originalFile} : {}) };
    setPendingImport(job); setBusy(true); setError(''); setLastRequest('');
    followConversation.current = true;
    setAIState('requesting'); setAgentSteps([]); setAgentStatus('正在保存原表并准备 AI 整理');
    setSidebar(true);
    const importPrompt=options.question || `导入“${table.title}”，请理解全部字段并选择合适的分析展示。`;
    setMessages(items => [...items, { role:'user', text: importPrompt }].slice(-100));
    setQuestionHistory(items=>[...items,importPrompt]);
    try {
      if (!options.rawAlreadySaved && !job.sheetId) {
        const saved = await apiRequest('/api/sheets', { owner, table, ...(job.originalFile ? {originalFile:job.originalFile} : {}) });
        if (token !== version.current || ownerRef.current !== owner) return;
        job.sheetId = saved.item.id;
        table.projectId = saved.item.table.projectId;
        delete job.originalFile;
        setPendingImport({ ...job });
      }
      if (job.sheetId) setWorkspaceSource({sheetId:job.sheetId,projectId:table.projectId,title:table.title});
      controller.signal.throwIfAborted();
      const result = await importRequest({ owner, table, text: options.question || '' }, event => {
        if (token !== version.current) return;
        if (event.type === 'model') {setModel(event.model);setAgentStatus(event.text);}
        if (event.type === 'status') setAgentStatus(event.text);
        if (event.entry) setAgentSteps(steps => [...steps.filter(step => step.id !== event.entry.id), event.entry]);
      }, controller.signal);
      if (token !== version.current || ownerRef.current !== owner) return;
      if (result.model) setModel(result.model);
      const data = { ...validateDataset(result.dataset), source: result.dataset.source || table.source, ...(table.projectId?{projectId:table.projectId}:{}), ...(job.sheetId?{sourceSheetId:job.sheetId}:{}) };
      setDataset(data); setDraft(null); setView(result.view); setMetricKey(result.metricKey);
      setChart(result.chart); setSort(result.sort); setTab('chart'); setStoredReport(null);
      setPendingImport(null); setAIState('success'); setAgentSteps([]); setAgentStatus('');
      say(result.answer, {animate: true, trace: result.trace});
      return true;
    } catch (error) {
      if (token === version.current && ownerRef.current === owner) {
        const message = error.name === 'AbortError' ? '已停止 AI 整理，原表已保留，可修改后重试。' : error.message;
        setPendingImport({ ...job, error:message }); setAIState('failed'); setAgentStatus('');
        say(`导入尚未应用图表：${message}`);
      }
      return false;
    } finally {
      if (token === version.current) setBusy(false);
      if (agentAbort.current === controller) agentAbort.current = null;
    }
  }
  async function analyzeTable(table, options = {}) {
    if (!await records.newRecord()) throw new Error('请先保存当前分析，再继续。');
    navigate('/');
    await prepareImport(table, {rawAlreadySaved:true,sheetId:options.sheetId});
  }
  async function importFile(file) {
    if (!file || busy || records.loading) return;
    setError("");
    setLastRequest("");
    if (file.size > 20 * 1024 * 1024) {
      setError("请上传 20 MB 以内的文件。");
      return;
    }
    const token = ++version.current;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let table;
      if (ext === "xlsx") {
        const { readSheet } = await import("read-excel-file/browser");
        table = tableFromMatrix(
          await readSheet(file),
          file.name.replace(/\.[^.]+$/, ""),
          `原始文件：${file.name}`,
        );
      } else {
        const raw = await file.text();
        if (ext === "json") {
          const parsed = JSON.parse(raw);
          const headers = Array.isArray(parsed) ? [...new Set(parsed.flatMap(row => Object.keys(row || {})))] : [];
          table = Array.isArray(parsed)
            ? tableFromMatrix(
                [
                  headers,
                  ...parsed.map((row) => headers.map(key => row[key] ?? null)),
                ],
                file.name.replace(/\.[^.]+$/, ''), `原始文件：${file.name}`,
              )
            : parsed.headers && parsed.rows ? validateRawTable(parsed) : tableFromDataset(parsed);
        } else if (["csv", "tsv"].includes(ext)) {
          const p = Papa.parse(raw, { skipEmptyLines: "greedy" });
          if (p.errors.some((e) => e.code !== "UndetectableDelimiter"))
            throw new Error("表格分隔格式有误，请检查引号和分隔符。");
          table = tableFromMatrix(p.data, file.name.replace(/\.[^.]+$/, ""), `原始文件：${file.name}`);
        } else if (ext === "txt") {
          setAIState("requesting");
          const d = validateDataset(
            (await apiRequest("/api/extract", { text: raw })).dataset,
          );
          table = tableFromDataset({...d,source:`AI 提取文本：${file.name}`});
        } else throw new Error("支持 CSV、TSV、XLSX、JSON 和 TXT 文件。");
      }
      const originalFile = await captureSourceFile(file);
      if (token !== version.current) return;
      if (!await records.newRecord()) throw new Error('请先保存当前分析，再导入新表格。');
      await prepareImport(table, {originalFile});
    } catch (e) {
      if (token === version.current) {
        setError(e.message);
        if (/\.txt$/i.test(file.name)) setAIState("failed");
      }
    } finally {
      if (token === version.current) setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function submit(e, value = text) {
    e?.preventDefault();
    if (!value.trim() || busy || editing || records.loading) return;
    if (pendingImport) {
      setText('');
      await prepareImport(pendingImport.table, {...pendingImport,question:value.trim()});
      return;
    }
    const prompt = value.trim();
    followConversation.current = true;
    setLastRequest(prompt);
    setError("");
    setMessages((m) => [...m, { role: "user", text: prompt }].slice(-100));
    setQuestionHistory(items=>[...items,prompt]);
    setText("");
    const token = ++version.current;
    setBusy(true);
    setAgentSteps([]);
    setAgentStatus("正在理解需求");
    const controller = new AbortController();
    agentAbort.current = controller;
    try {
      setAIState("requesting");
      const result = await agentRequest(
        {
          text: prompt,
          dataset,
          draft,
          history: messages.slice(-12),
          metricKey,
          view,
          chart,
          sort,
          owner: user.username,
        },
        (event) => {
          if (token !== version.current) return;
          if (event.type === 'model') {setModel(event.model);setAgentStatus(event.text);}
          if (event.type === "status") setAgentStatus(event.text);
          if (event.entry)
            setAgentSteps((steps) => [
              ...steps.filter((s) => s.id !== event.entry.id),
              event.entry,
            ]);
        },
        controller.signal,
      );
      if (token !== version.current) return;
      if (result.model) setModel(result.model);
      setAIState("success");
      if (result.kind === "agent") {
        if (result.dataset) {
          setDataset({
            ...validateDataset(result.dataset),
            source: "千问 Agent 录入",
            projectId:dataset?.projectId || draft?.projectId || records.activeId,
          });
          setDraft(null);
        } else if (result.commitDraft && draft) {
          setDataset({
            ...draft,
            source:
              draft.source?.replace("，待人工确认", "，已确认") || "AI 数据",
          });
          setDraft(null);
        }
        if (result.changed) {
          setView(result.view);
          setChart(result.chart);
          setMetricKey(result.metricKey);
          setSort(result.sort);
          setTab("chart");
        }
        say(result.answer, {animate: true, trace: result.trace});
        setAgentSteps([]);
        return;
      }
      if (result.kind === "answer") {
        say(result.answer, {animate: true});
        return;
      }
      if (result.kind === "actions") {
        for (const action of result.actions) {
          if (action.tool === "set_chart") {
            setChart(action.value);
            setTab("chart");
          } else if (action.tool === "select_metric")
            setMetricKey(action.value);
          else if (action.tool === "sort") setSort(action.value === "desc");
        }
        say(result.answer, {animate: true});
        return;
      }
      if (result.kind === "action") {
        if (["bar", "line", "pie"].includes(result.action)) {
          setChart(result.action);
          setTab("chart");
        } else setSort(result.action === "sort");
        say(result.answer, {animate: true});
        return;
      }
      const d = validateDataset(result.dataset);
      setDraft({ ...d, projectId:dataset?.projectId || draft?.projectId || records.activeId, source: "千问 AI 提取，待人工确认" });
      setView(defaultView(d));
      setChart("bar");
      setSort(false);
      setMetricKey(d.metrics[0].key);
      setTab("data");
      say(
        `千问 已整理出 ${d.rows.length} 行数据和 ${d.metrics.length} 个指标。请核对名称、数字和单位，确认后再绘图。`,
      );
    } catch (e) {
      if (token === version.current) {
        setAIState("failed");
        setError(e.message);
        say(
          e.name === "AbortError"
            ? "已停止当前任务，未应用未完成的操作。"
            : `AI 请求未完成：${e.message}`,
        );
      }
    } finally {
      if (token === version.current) setBusy(false);
      if (agentAbort.current === controller) agentAbort.current = null;
    }
  }
  function confirmDraft() {
    try {
      const valid = validateDataset(draft);
      if (!view) setView(defaultView(valid));
      setDataset({
        ...valid,
        projectId:valid.projectId || dataset?.projectId || records.activeId,
        source: draft.source.replace("，待人工确认", "，已确认"),
      });
      if (!valid.metrics.some((m) => m.key === metricKey))
        setMetricKey(valid.metrics[0].key);
      setDraft(null);
      setEditing(false);
      setTab("chart");
      say(
        "数据已确认，图表与计算结果已更新。你可以继续调整图表，或在数据表里修正数值。",
      );
    } catch (e) {
      setError(e.message);
    }
  }
  function updateDataset(d) {
    setDataset({
      ...d,
      projectId:d.projectId || dataset?.projectId || records.activeId,
      source: dataset.source.includes("已编辑")
        ? dataset.source
        : `${dataset.source}（已编辑）`,
    });
  }
  // 主页与工作台共用账户操作，保存记录与退出流程保持一致。
  const accountControls = user ? (
    <div className="account-area">
      <button
        className="account-button"
        title={user.username}
        aria-label={`账户：${user.username}`}
        disabled={assetBusy}
        onClick={() => navigate("/login")}
      >
        <span className="avatar">{user.username.slice(0, 1)}</span>
        <span className="account-name">{user.username}</span>
      </button>
      <button
        className="logout-button"
        disabled={assetBusy}
        onClick={async () => {
          try {
            await records.saveNow();
            await apiRequest("/api/auth/logout", {});
            restoreWorkspace(emptyWorkspace());
            setUser(null);
            navigate("/login");
            setNotice("已退出登录");
          } catch (e) {
            setNotice(e.message);
          }
        }}
      >
        退出
      </button>
    </div>
  ) : (
    <button className="login-link" onClick={() => navigate("/login")}>
      登录
    </button>
  );
  const header = (
    <header className="topbar">
      <button
        className="brand-home"
        aria-label="见数首页"
        disabled={assetBusy}
        onClick={() => navigate("/home")}
      >
        <Logo />
      </button>
      <span className="top-divider" />
      <span className="workspace-name">个人工作台</span>
      {user && (
        <WorkspaceNav page={page} disabled={busy || assetBusy || records.loading} analysisDisabled={assetBusy}
          onNavigate={target => {
            if (target === "/") { navigate("/"); }
            else if (target === "/history") openAssets('/datasets');
            else openAssets(target);
          }} />
      )}
      <div className="top-right">
        <button
          className={`help-link ${page === "/help" ? "current" : ""}`}
          disabled={assetBusy}
          onClick={() => navigate("/help")}
        >
          <BookOpen size={16} />
          使用说明
        </button>
        {accountControls}
      </div>
    </header>
  );
  if (authPending)
    return (
      <div className="auth-loading">
        <LoaderCircle className="spin" size={24} />
        <p>正在验证登录状态…</p>
      </div>
    );
  if (!user)
    return (
      <div className="experience-frame">
        <LoginPage navigate={navigate} user={null} onLogin={setUser} />
      </div>
    );
  if (page === "/home")
    return (
      <HomePage navigate={navigate} user={user} accountControls={accountControls} />
    );
  if (!records.ready)
    return (
      <WorkbenchSurface mode="workspace-loading">
        {header}
        <div className="auth-loading">
          <LoaderCircle className={records.error ? "" : "spin"} size={24} />
          <p>{records.error || "正在恢复你的分析记录…"}</p>
          {records.error && (
            <button
              className="primary-button"
              onClick={() => location.reload()}
            >
              重新加载
            </button>
          )}
        </div>
      </WorkbenchSurface>
    );
  if (page === '/datasets' || page === '/history') return <WorkbenchSurface mode="library-app">
    {header}
    <Suspense fallback={<div className="library-loading" role="status"><LoaderCircle className="spin" size={20}/>正在读取数据与分析…</div>}>
      <CollectionPage key={`${user.username}:${assetRevision}`} user={user} activeId={records.activeId} onOpen={openCollectionItem} onUpload={uploadFromLibrary} onBusyChange={setAssetBusy}/>
    </Suspense>
    {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
  </WorkbenchSurface>;
  if (page === '/trash') return <WorkbenchSurface mode="library-app">
    {header}
    <Suspense fallback={<div className="library-loading" role="status"><LoaderCircle className="spin" size={20}/>正在打开回收站…</div>}>
      <TrashPage key={`${user.username}:${assetRevision}`} user={user} onNotice={setNotice}/>
    </Suspense>
    {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
  </WorkbenchSurface>;
  if (page === '/sheets') return <WorkbenchSurface mode="sheets-app">
    {header}
    <Suspense fallback={<div className="library-loading" role="status"><LoaderCircle className="spin" size={20}/>正在打开数据表格…</div>}>
      <SpreadsheetPage key={`${user.username}:${assetRevision}`} user={user} activeSource={{id:records.activeId,dataset:draft||dataset,sheetId:workspaceSource?.sheetId || (draft||dataset)?.sourceSheetId}} incomingTable={sheetIncoming?.owner === user.username ? sheetIncoming : null} onAnalyze={analyzeTable} onNotice={setNotice} onBusyChange={setAssetBusy} onBack={()=>navigate('/')}/>
    </Suspense>
    {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
  </WorkbenchSurface>;
  if (["/datasets", "/boards", "/reports"].includes(page))
    return (
      <WorkbenchSurface mode="library-app">
        {header}
        <Suspense fallback={<div className="library-loading" role="status"><LoaderCircle className="spin" size={20} />正在打开成果空间…</div>}>
          <LibraryPages key={`${user.username}:${page}:${assetRevision}`} page={page} user={user}
            onBusyChange={setAssetBusy}
            onStartDataset={startDatasetAnalysis} onUpload={uploadFromLibrary}
            onOpenRecord={async id => { if (await records.openRecord(id)) navigate("/"); else setNotice("这条分析暂时无法打开，请稍后重试。"); }}
            onNotice={setNotice} />
        </Suspense>
        {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
      </WorkbenchSurface>
    );
  if (page === "/help")
    return (
      <WorkbenchSurface mode="help-app">
        {header}
        <HelpPage navigate={navigate} />
      </WorkbenchSurface>
    );
  if (page === "/login")
    return (
      <div className="experience-frame">
        <LoginPage navigate={navigate} user={user} onLogin={setUser} />
      </div>
    );
  return (
    <WorkbenchSurface viewKey={`${tab}:${chart}:${metric?.key}:${analyzed?.rows.length}`}>
      {header}
      <fieldset
        ref={workspaceRoot}
        className={`workspace ${sidebar ? "" : "sidebar-closed"}`}
        disabled={records.loading}
      >
        <aside className="sidebar" aria-label="数据输入与分析对话" aria-hidden={!sidebar} inert={!sidebar} data-workbench-pane>
          <section className="agent-thread" aria-label="AI 分析助手">
            <header className="composer-agent-heading">
              <div className="assistant-identity">
                <AICore working={busy} />
                <div><h2>AI 分析助手</h2><small className="assistant-model-name">{model}</small></div>
              </div>
              <div className="thread-heading-actions">
                <button className="new-analysis" aria-label="新建分析" title="新建分析" onClick={clear} disabled={busy || records.loading}>
                  <Plus size={15} /><span>新建分析</span>
                </button>
                <button className="panel-toggle panel-toggle-close" aria-label="收起输入面板" title="收起 AI 对话面板" onClick={() => setSidebar(false)}>
                  <PanelLeftClose size={17} /><span>收起</span>
                </button>
              </div>
            </header>
            <div className="thread-context">
              <FileSpreadsheet size={14} />
              <span>{dataset?.title || "新的分析对话"}</span>
              <small>{dataset ? `${dataset.rows.length} 行` : "等待添加数据"}</small>
            </div>
            <div className="conversation" aria-live="polite" onScroll={event => {
              const box = event.currentTarget;
              followConversation.current = box.scrollHeight - box.clientHeight - box.scrollTop < 48;
            }}>
              {messages.map(m => (
                <div className={`message ${m.role}`} key={presentationFor(m).id}>
                  {m.role === "assistant" && (
                    <span className="assistant-label">
                      <span className="mini-mark" />
                      见数
                    </span>
                  )}
                  {m.role === "assistant" ? (
                    <AssistantReply message={m} presentation={presentationFor(m)} onProgress={scrollConversation}/>
                  ) : (
                    <p>{m.text}</p>
                  )}
                </div>
              ))}
              {busy && (
                <div className="processing">
                  <LoaderCircle size={15} className="spin" />
                  {agentStatus || "正在处理需求…"}
                </div>
              )}
              {busy && agentSteps.length > 0 && (
                <ol className="live-tool-steps">
                  {agentSteps.map((step) => (
                    <li key={step.id}>
                      <span>
                        {step.status === "running" ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : step.status === "success" ? (
                          <Check size={13} />
                        ) : (
                          <Info size={13} />
                        )}{" "}
                        {step.label}
                      </span>
                      {step.summary && <small>{step.summary}</small>}
                    </li>
                  ))}
                </ol>
              )}
              <div ref={chatEnd} />
            </div>
            {dataset && (
              <div className="suggestions">
                <button
                  onClick={() => submit(null, "帮我总结这组数据")}
                  disabled={busy || editing}
                >
                  总结当前数据
                </button>
                <button
                  onClick={() => submit(null, "换成折线图")}
                  disabled={busy || editing}
                >
                  换成折线图
                </button>
              </div>
            )}
            <form className="composer" onSubmit={submit}>
              <label htmlFor="prompt" className="sr-only">
                数据或分析需求
              </label>
              <textarea
                id="prompt"
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={12000}
                disabled={editing || voice.active}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                    e.preventDefault();
                    if (!e.repeat) submit(e);
                  }
                }}
              />
              <div className="compose-tools">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="上传数据文件"
                  onClick={() => fileRef.current.click()}
                  disabled={busy || voice.active}
                >
                  <Plus size={19} />
                </button>
                <span className="composer-shortcut" title="Shift + Enter 换行">Enter 发送</span>
                <div
                  className={`ai-status composer-model-status ${aiState}`}
                  role="status"
                  title={`分析模型：${model}`}
                >
                  {(aiState === "requesting" ||
                    voice.phase === "transcribing") && (
                    <LoaderCircle size={13} className="spin" />
                  )}
                  <span>
                    {voice.phase === "requesting"
                      ? "等待麦克风"
                      : voice.phase === "recording"
                        ? `录音中 ${voice.seconds}s`
                        : voice.phase === "transcribing"
                          ? "千问 识别中"
                          : voice.phase === "success"
                            ? "千问 识别成功"
                            : {
                                checking: "千问 检查中",
                                ready: "千问 已就绪",
                                success: "千问 调用成功",
                                requesting: "千问 调用中",
                                failed: "千问 调用失败",
                                unconfigured: "千问 未配置",
                                offline: "千问 未连接",
                              }[aiState]}
                  </span>
                  {["offline", "failed", "unconfigured"].includes(aiState) &&
                    !voice.active && (
                      <button type="button" onClick={checkAI} disabled={busy}>
                        重试
                      </button>
                    )}
                </div>
                {busy ? (
                  <button
                    type="button"
                    className="stop-agent"
                    onClick={() => agentAbort.current?.abort()}
                  >
                    停止
                  </button>
                ) : voice.active ? (
                  <button
                    type="button"
                    className="voice-button recording"
                    aria-label={
                      voice.phase === "recording"
                        ? "结束录音并识别"
                        : "正在识别语音"
                    }
                    onClick={voice.finish}
                    disabled={voice.phase !== "recording"}
                  >
                    {voice.phase === "recording" ? (
                      <Square size={16} fill="currentColor" />
                    ) : (
                      <LoaderCircle size={19} className="spin" />
                    )}
                  </button>
                ) : text.trim() ? (
                  <button
                    className="send-button"
                    aria-label="发送数据或问题"
                    disabled={!text.trim() || busy || editing}
                  >
                    <ArrowUp size={19} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="voice-button"
                    aria-label="开始语音输入"
                    title="语音输入"
                    onClick={voice.start}
                    disabled={editing || records.loading}
                  >
                    <AudioLines size={20} />
                  </button>
                )}
              </div>
              {voice.active && (
                <div className="voice-feedback" role="status">
                  <span>
                    {voice.phase === "recording"
                      ? "正在录音，再次点击右侧按钮结束（最长60秒）"
                      : voice.phase === "transcribing"
                        ? "正在识别，文字会填入输入框"
                        : "请允许本站使用麦克风"}
                  </span>
                  <button type="button" onClick={voice.cancel}>
                    取消
                  </button>
                </div>
              )}
              {voice.error && (
                <p className="voice-error" role="alert">
                  {voice.error}
                </p>
              )}
              <div className="record-save-status" role="status">
                <span className="composer-attribution">思考由千问提供支持</span>
                <span className="sr-only">
                  {
                    {
                      idle: "新分析，发送后自动保存",
                      pending: "等待自动保存…",
                      saving: "正在保存…",
                      saved: "已保存到当前账号",
                      error: "保存失败",
                      "load-error": "记录加载失败",
                    }[records.status]
                  }
                </span>
                <button
                  type="button"
                  onClick={() => records.saveNow().catch(() => {})}
                  disabled={
                    busy ||
                    records.status === "saving" ||
                    (!dataset &&
                      !draft &&
                      !messages.some((m) => m.role === "user") &&
                      !records.records.some((r) => r.id === records.activeId))
                  }
                >
                  {records.status === "error" ? "重试保存" : "保存记录"}
                </button>
              </div>
              {records.error && (
                <p className="save-error" role="alert">
                  {records.error}
                </p>
              )}
            </form>
          </section>
        </aside>
        <main className={`main-sheet${pendingImport ? " import-in-progress" : ""}`} data-workbench-pane>
          <div className="page-heading">
            <div>
              <div className="title-row">
                {!sidebar && (
                  <button
                    className="panel-toggle panel-toggle-open"
                    aria-label="展开输入面板"
                    title="展开 AI 对话"
                    onClick={() => setSidebar(true)}
                  >
                    <PanelLeftOpen size={20} />
                  </button>
                )}
                <h1>
                  {pendingImport ? pendingImport.table.title : draft
                    ? "核对你的数据"
                    : dataset?.title || "开始一次新的发现"}
                </h1>
                {dataset?.source.startsWith("演示") && !draft && (
                  <span className="sample-tag">演示数据</span>
                )}
              </div>
              {(pendingImport || draft || dataset) && <p className="dataset-description">
                {pendingImport ? `${pendingImport.table.rows.length} 行原始数据 · 正在由 AI 确定字段与展示` :
                 <>
                {draft
                  ? "确认名称、数值和单位，结果将从这里生成。"
                  : dataset
                    ? `${filteredSource.rows.length} 行${view?.filters?.length ? ` / 全部 ${dataset.rows.length} 行` : "原始数据"} · ${dataset.metrics.length} 个指标`
                    : ""}</>}
              </p>}
            </div>
            <div className="workspace-asset-actions">
            {dataset && !draft && !pendingImport && <>
              <button className="secondary-button" disabled={busy || editing || assetBusy} onClick={pinChart}><LayoutDashboard size={16}/>{assetBusy ? "正在保存…" : "加入看板"}</button>
            </>}
            <button
              className="secondary-button export-top"
              disabled={!dataset || Boolean(draft) || editing || busy || !!pendingImport}
              onClick={generateReport}
            >
              {savedReport ? <FileText size={16} /> : <Download size={16} />}
              {savedReport ? "打开报告" : "生成报告"}
            </button>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <Info size={17} />
              <span>{error}</span>
              {lastRequest && aiState === "failed" && (
                <button
                  className="retry-button"
                  onClick={() => submit(null, lastRequest)}
                  disabled={busy}
                >
                  重试
                </button>
              )}
              <button
                className="icon-button"
                aria-label="关闭错误提示"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {pendingImport ? <ImportReviewPanel job={pendingImport} busy={busy} status={agentStatus} steps={agentSteps}
            onRetry={() => prepareImport(pendingImport.table,pendingImport)}
            onEdit={() => showTable(pendingImport.table)}
            onCancel={() => {setPendingImport(null);setError('');setAgentSteps([]);}}/> : draft ? (
            <section className="draft-panel">
              <div className="section-heading">
                <h2>
                  待确认数据{" "}
                  <span className="count-label">{draft.rows.length} 行</span>
                </h2>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    say("已取消这次导入，当前数据保持不变。");
                    setError("");
                    setTab("chart");
                  }}
                >
                  取消导入
                </button>
              </div>
              <div className="metric-units">
                {draft.metrics.map((m, i) => (
                  <label key={m.key}>
                    {m.key}单位
                    <input
                      value={m.unit}
                      maxLength={12}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          metrics: d.metrics.map((v, j) =>
                            i === j ? { ...v, unit: e.target.value } : v,
                          ),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <DataTable dataset={draft} onChange={setDraft} editing />
              <div className="confirm-row">
                <span>
                  <Info size={15} />
                  可直接编辑单元格；空白数值视为缺失。
                </span>
                <button
                  className="primary-button"
                  onClick={confirmDraft}
                  disabled={busy}
                >
                  <CheckCheck size={17} />
                  确认并生成图表
                </button>
              </div>
            </section>
          ) : dataset ? (
            <>
              <div className="tabs-row">
                <div className="tabs" role="tablist" aria-label="分析视图">
                  {[
                    ["chart", "可视化", ChartNoAxesColumnIncreasing],
                    ["data", "数据表", Table2],
                    ["report", "分析报告", FileText],
                  ].map(([id, label, Icon]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={tab === id}
                      className={tab === id ? "active" : ""}
                      onClick={() => setTab(id)}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
                <span className="saved-state">
                  <Check size={14} />
                  {records.status === "saved" ? "已保存到账号" : "自动保存中"}
                </span>
              </div>
              {tab === "chart" ? (
                <>
                  <div className="analysis-body">
                    <section className="chart-panel">
                      <div className="section-heading">
                        <div>
                          <h2>
                            {metric.key}
                            {chart === "line"
                              ? "变化趋势"
                              : chart === "pie"
                                ? "构成分析"
                                : "分类对比"}
                          </h2>
                        </div>
                        <div className="chart-type" aria-label="图表类型">
                          {[
                            ["bar", "柱状图", ChartNoAxesColumnIncreasing],
                            ["line", "折线图", ChartLine],
                            ["pie", "占比图", ChartPie],
                          ].map(([v, label, Icon]) => (
                            <button
                              key={v}
                              aria-label={label}
                              aria-pressed={chart === v}
                              className={chart === v ? "selected" : ""}
                              onClick={() => setChart(v)}
                            >
                              <Icon size={17} />
                            </button>
                          ))}
                        </div>
                      </div>
                      <ChartSelectionBar data={chartData} interaction={chartInteraction} sourceRows={filteredSource.rows.length} totalRows={dataset.rows.length} disabled={busy || editing}
                        context={view?.groupBy
                          ? `${view.groupBy === "name" ? "分类" : view.groupBy}${view.granularity === "month" ? "（月）" : view.granularity === "year" ? "（年）" : ""} · ${{ sum: "求和", average: "平均值", count: "有效记录数", min: "最小值", max: "最大值" }[aggregationFor(metric, view.aggregation)]}`
                          : "原始记录"}
                        controls={<>
                        <label className="metric-select primary-metric">
                          指标
                          <select
                            aria-label="指标"
                            value={metric.key}
                            onChange={(e) => setMetricKey(e.target.value)}
                          >
                            {dataset.metrics.map((m) => (
                              <option key={m.key} value={m.key}>
                                {m.key}
                                {m.unit ? `（${m.unit}）` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <details className="analysis-settings" name="chart-analysis-controls" onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.currentTarget.open = false;
                            e.currentTarget.querySelector("summary")?.focus();
                          }
                        }}>
                          <summary><SlidersHorizontal size={14} />更多设置<ChevronDown size={13} /></summary>
                          <div className="advanced-controls">
                        <label className="metric-select">
                          分组
                          <select
                            aria-label="分组字段"
                            value={view?.groupBy || ""}
                            onChange={(e) =>
                              setView((v) => ({
                                ...v,
                                groupBy: e.target.value,
                                granularity: "none",
                              }))
                            }
                          >
                            <option value="">原始记录</option>
                            {dimensionsFor(dataset).map((d) => (
                              <option key={d.key} value={d.key}>
                                {d.key === "name" ? "分类" : d.key}
                              </option>
                            ))}
                          </select>
                        </label>
                        {dimensionsFor(dataset).find(
                          (d) => d.key === view?.groupBy,
                        )?.type === "date" && (
                          <label className="metric-select">
                            粒度
                            <select
                              aria-label="时间粒度"
                              value={view?.granularity || "none"}
                              onChange={(e) =>
                                setView((v) => ({
                                  ...v,
                                  granularity: e.target.value,
                                }))
                              }
                            >
                              <option value="none">原日期</option>
                              <option value="day">按日</option>
                              <option value="month">按月</option>
                              <option value="year">按年</option>
                            </select>
                          </label>
                        )}
                        {view?.groupBy && (
                          <label className="metric-select">
                            汇总
                            <select
                              aria-label="汇总方式"
                              value={view?.aggregation || "auto"}
                              onChange={(e) =>
                                setView((v) => ({
                                  ...v,
                                  aggregation: e.target.value,
                                }))
                              }
                            >
                              <option value="auto">自动口径</option>
                              <option value="sum">求和</option>
                              <option value="average">平均值</option>
                              <option value="count">有效记录数</option>
                              <option value="min">最小值</option>
                              <option value="max">最大值</option>
                            </select>
                          </label>
                        )}
                        <button
                          className={
                            sort ? "text-button sorted" : "text-button"
                          }
                          onClick={() => setSort(!sort)}
                        >
                          <ChevronsUpDown size={14} />
                          {sort ? "原始顺序" : "数值排序"}
                        </button>
                          </div>
                        </details>
                        </>}
                        filters={<>
{view?.filters?.length > 0 && (
                        <div className="active-filters">
                          {view.filters.map((f, i) => (
                            <span key={i}>
                              {f.field === "name" ? "分类" : f.field}{" "}
                              {
                                {
                                  eq: "=",
                                  in: "属于",
                                  contains: "包含",
                                  gte: "≥",
                                  lte: "≤",
                                }[f.op]
                              }{" "}
                              {Array.isArray(f.value) ? f.value.join("、") : typeof f.value === 'string' ? f.value.replace(/T23:59:59(?:\.999)?Z$/, '') : f.value}
                            </span>
                          ))}
                          <button
                            onClick={() =>
                              setView((v) => ({ ...v, filters: [] }))
                            }
                          >
                            清除筛选
                          </button>
                        </div>
                      )}
                        </>}
                      />
                      <div className="chart-summary">
                      <div className="hero-stat">
                        <span title={headline.caption}>{headline.label}</span>
                        <div>
                          {format(headline.value)}
                          <small>{headline.unit || metric.unit}</small>
                        </div>
                      </div>
                      <div className="finding">
                        <span>最高值 · {stats.leaders.length ? stats.leaders.join("、") : "暂无有效值"}</span>
                        <strong className="numeric">{format(stats.max)} <small>{metric.unit}</small></strong>
                      </div>
                      <div className="finding">
                        <span>{view?.groupBy ? "每组结果平均" : "每条记录平均"}</span>
                        <strong className="numeric">{format(stats.average)} <small>{metric.unit}</small></strong>
                      </div>
                      </div>
                      <ChartBoundary>
                        <Suspense
                          fallback={
                            <div className="chart-box processing">
                              <LoaderCircle size={18} className="spin" />
                              正在准备图表…
                            </div>
                          }
                        >
                          <ChartView
                            data={chartData}
                            metric={metric}
                            type={chart}
                            interaction={chartInteraction}
                          />
                        </Suspense>
                      </ChartBoundary>
                      <div className="chart-footnote">
                        <span>
                          <span className="legend-line" />
                          {metric.key}
                        </span>
                        <span>缺失值不参与计算</span>
                      </div>
                    </section>
                    <aside className="insight-panel">
                      <h2>
                        <Sparkles size={17} />
                        数据说明
                      </h2>
                      <span className="method-tag">确定性统计</span>
                      <div className="quality">
                        <div>
                          <CheckCheck size={16} />
                          <strong>数据检查</strong>
                        </div>
                        <p>
                          {stats.missing
                            ? `${stats.missing} 个缺失值已排除。`
                            : "当前指标没有缺失值。"}
                          {new Set(dataset.rows.map((r) => r.name)).size <
                          dataset.rows.length
                            ? view?.groupBy
                              ? "原始记录包含重复分类，已按当前分组汇总。"
                              : "存在重名分类，按独立记录计算。"
                            : "分类名称无重复。"}
                        </p>
                      </div>
                      <div className="boundary">
                        <Info size={15} />
                        <p>数值变化不等于因果关系。进一步解释需要更多背景。</p>
                      </div>
                    </aside>
                  </div>
                  {(view?.groupBy || view?.filters?.length > 0) && (
                    <details className="source-preview chart-result-table">
                      <summary>
                        当前图表数据（{analyzed.rows.length} 组）
                      </summary>
                      <DataTable dataset={displayed} />
                    </details>
                  )}
                  <section className="source-preview">
                    <div className="section-heading">
                      <h2>
                        <Table2 size={16} />
                        {view?.filters?.length ? "当前筛选的原始数据" : "回到原始数据"}{" "}
                        <span className="count-label">
                          {filteredSource.rows.length} 行{view?.filters?.length ? ` / 共 ${dataset.rows.length} 行` : ""}
                        </span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => setTab("data")}
                      >
                        {view?.filters?.length ? "查看筛选明细" : "查看与编辑"}
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <DataTable dataset={filteredSource} limit={filteredSource.rows.length} />
                    <div className="source-caption">
                      <Link2 size={13} />
                      {dataset.source}
                    </div>
                  </section>
                </>
              ) : tab === "data" ? (
                <section className="data-panel">
                  <div className="section-heading">
                    <h2>
                      {view?.filters?.length && !editing ? "筛选后的原始数据" : "原始数据"}{" "}
                      <span className="count-label">
                        {editing ? dataset.rows.length : filteredSource.rows.length} 行{view?.filters?.length && !editing ? ` / 共 ${dataset.rows.length} 行` : ""}
                      </span>
                    </h2>
                    <div className="row-actions">
                      <button className="secondary-button" onClick={() => showTable(tableFromDataset(dataset))} disabled={busy}>
                        <FileSpreadsheet size={15}/>在数据表格中打开
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          download(
                            `${dataset.title}.csv`,
                            csvExport(editing ? dataset : filteredSource),
                            "text/csv;charset=utf-8",
                          );
                          setNotice("CSV 已导出");
                        }}
                      >
                        <Download size={15} />
                        导出 CSV
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          if (editing) {
                            try {
                              validateDataset(dataset);
                              setEditing(false);
                              setError("");
                            } catch (e) {
                              setError(e.message);
                            }
                          } else setEditing(true);
                        }}
                      >
                        {editing ? (
                          <Check size={15} />
                        ) : (
                          <SlidersHorizontal size={15} />
                        )}{" "}
                        {editing ? "完成编辑" : view?.filters?.length ? "编辑全部原始数据" : "编辑数据"}
                      </button>
                    </div>
                  </div>
                  <p className="subtle">
                    {editing
                      ? "正在编辑全部原始数据。修改会立即更新计算与图表；完成编辑后返回当前筛选明细。清空数值表示缺失，输入 0 表示零。"
                      : view?.filters?.length ? "明细与图表使用相同的筛选条件，保留原始记录，不进行分组汇总；导出 CSV 仅包含这些明细。" : "当前分析会自动保存到你的账号，也可以导出 CSV。"}
                  </p>
                  <DataTable
                    dataset={editing ? dataset : filteredSource}
                    onChange={updateDataset}
                    editing={editing}
                  />
                  <div className="source-caption">
                    <Link2 size={13} />
                    {dataset.source}
                  </div>
                </section>
              ) : (
                <section className="report-overview">
                  <FileText size={32} />
                  <h2>{savedReport ? "本次分析报告" : "让 AI 将本次分析整理成报告"}</h2>
                  {savedReport ? <>
                    <p className="report-generated-meta">{savedReport.mode === "ai" ? `${savedReport.models?.join(' / ') || savedReport.model} · 深度分析` : "程序统计报告"} · {savedReport.pages} 页 · {savedReport.chartCount} 幅专题图表 · {new Date(savedReport.createdAt).toLocaleString("zh-CN")}</p>
                    {!currentReport && <p className="subtle">报告范围、当前数据或问题已变化，以下为上次保存的版本。点击重新生成，可获得整份数据的报告与独立问题专题。</p>}
                    <p>{savedReport.narrative.summary}</p>
                    <h3>{savedReport.reportScope === "overall" ? "整体分析结论" : "原报告分析结论"}</h3><p>{savedReport.narrative.answer}</p>
                    <h3>报告中的专题分析</h3>
                    <ol>{savedReport.narrative.chapters.map(c => <li key={c.chartId}>{c.title}</li>)}</ol>
                    {savedReport.narrative.questionSection && <>
                      <h3>用户问题专题 · 1—2 页</h3>
                      <p>{savedReport.narrative.questionSection.answer}</p>
                      <ol>{savedReport.narrative.questionSection.chapters.slice(0, 2).map(c => <li key={c.chartId}>{c.title}</li>)}</ol>
                    </>}
                  </> : <>
                    <p>由 千问 对整份数据进行全面分析，展示整体趋势、构成、差异和数据质量；另设 1—2 页专题，结合当前筛选回应你的问题。生成后可预览 PDF 再导出。</p>
                    <ol><li>核对全部数据，形成整体概况与核心发现</li><li>分析趋势、构成与差异，给出图表和行动建议</li><li>单列用户问题专题，标明筛选范围与计算依据</li></ol>
                  </>}
                  <div className="report-preview-actions">
                    <button className="primary-button" onClick={() => openReport(false, true)} disabled={busy || editing}><Sparkles size={16} />{savedReport ? "预览与导出报告" : "开始 AI 深度生成"}</button>
                    {savedReport && <button className="text-button" disabled={busy || editing} onClick={() => openReport(true)}>重新生成</button>}
                  </div>
                </section>
              )}
            </>
          ) : (
            <section
              className="empty-state"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) importFile(e.dataTransfer.files[0]);
              }}
            >
              <div className="empty-symbol">
                <ChartNoAxesColumnIncreasing size={42} strokeWidth={1} />
              </div>
              <h2>从一个问题，看见数据。</h2>
              <p>上传表格，或在左侧描述你的数据。<br />图表、明细和分析报告会在这里呈现。</p>
              <button
                className="primary-button"
                onClick={() => fileRef.current.click()}
                disabled={busy}
              >
                <Upload size={17} />
                添加数据文件
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setText(clubText);
                  setSidebar(true);
                  inputRef.current?.focus();
                }}
              >
                试试用一句话录入
                <ArrowRight size={16} />
              </button>
              <span className="empty-formats"><span>Excel</span><span>CSV / TSV</span><span>JSON</span><span>文本</span></span>
              {previous && (
                <button
                  className="text-button"
                  onClick={() => {
                    setDataset(previous);
                    setMetricKey(previous.metrics[0].key);
                    setPrevious(null);
                    setTab("chart");
                  }}
                >
                  <RotateCcw size={15} />
                  恢复上一次数据
                </button>
              )}
            </section>
          )}
          <footer className="workspace-footer">
            <span>见数，让分析有据可循。</span>
          </footer>
        </main>
      </fieldset>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.xlsx,.json,.txt"
        className="sr-only"
        aria-label="选择数据文件"
        onChange={(e) => importFile(e.target.files[0])}
      />
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {reportInput && (
        <ReportStudio
          input={reportInput}
          onModel={setModel}
          onClose={() => setReportInput(null)}
          initialResult={reportInput.cachedResult}
          onResult={result => {
            if (user?.username === reportInput.owner && records.activeId === reportInput.recordId)
              setStoredReport(serializeReport(reportInput.key, result));
          }}
        />
      )}
    </WorkbenchSurface>
  );
}
