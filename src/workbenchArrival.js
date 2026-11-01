import gsap from "gsap";

let pending = null;
export const hasWorkbenchArrival = () => Boolean(pending && !pending.finished);

// 主页与工作台共用这一张实时画布，落位时不销毁重建模型。
export function departForWorkbench(surface, commit) {
  const host = surface.querySelector(".home-hero .island-canvas");
  if (!host?.querySelector("canvas")) return null;
  const sourceRect = host.getBoundingClientRect();
  // 页尾入口不播放屏幕外的环绕，直接使用原来的短过渡。
  if (sourceRect.bottom <= 0 || sourceRect.top >= innerHeight) return null;
  const layer = document.createElement("div");
  layer.className = "workbench-arrival-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  const detail = { host: layer, sourceRect };
  host.dispatchEvent(new CustomEvent("seet-workbench-capture", { detail }));
  if (!detail.runtime) { layer.remove(); return null; }
  const source = { runtime: detail.runtime, layer, target: null, finished: false };
  pending = source;
  const progress = { value: 0 };
  let committed = false, deadline;
  const finish = () => {
    if (source.finished) return;
    source.finished = true;
    clearTimeout(deadline);
    const target = source.target?.isConnected ? source.target : document.querySelector(".workbench-core-canvas");
    if (target) source.runtime.finishCore(target);
    else source.runtime.cancel();
    if (source.surface?.isConnected) gsap.set(source.surface, { clearProps: "opacity" });
    layer.remove();
    if (pending === source) pending = null;
  };
  const navigate = () => {
    if (committed) return;
    committed = true;
    commit();
    const target = document.querySelector(".workbench-core-canvas");
    if (target) {
      source.target = target;
      source.surface = target.closest(".canvas-workbench");
      gsap.set(source.surface, { opacity: 0 });
      source.runtime.configureCoreDestination(target.getBoundingClientRect());
    } else finish();
  };
  // 浏览器隐藏或窗口尺寸变化时直接完成接力，避免导航停在中间状态。
  const settle = () => { timeline.progress(1); navigate(); finish(); };
  const onVisibility = () => { if (document.hidden) settle(); };
  const timeline = gsap.timeline({ onComplete: finish });
  source.runtime.workspaceFrame(0);
  const content = surface.querySelectorAll(".home-header, .home-hero-copy, .home-hero-bottom");
  const homeOpacity = [...content].map(element => gsap.quickSetter(element, "opacity"));
  // 公转、旧模型退场、切页与新界面显现由同一个连续进度驱动。
  timeline.to(progress, { value: 1, duration: 2.9, ease: "none", onUpdate: () => {
    const p = progress.value;
    if (p >= .4 && !committed) navigate();
    const reveal = source.runtime.workspaceFrame(p);
    if (!committed) {
      const fade = Math.max(0, Math.min(1, (p - .24) / .16));
      homeOpacity.forEach(set => set(1 - fade * fade * (3 - 2 * fade)));
    }
    if (source.surface?.isConnected) source.surface.style.opacity = String(reveal);
  } });
  deadline = setTimeout(settle, 5000);
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", settle, { once: true });
  window.addEventListener("resize", settle, { once: true });
  document.addEventListener("visibilitychange", onVisibility);
  const cleanup = () => {
    clearTimeout(deadline);
    preference.removeEventListener("change", settle);
    window.removeEventListener("resize", settle);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  timeline.eventCallback("onComplete", () => { finish(); cleanup(); });
  // 导航提交会卸载旧的路由动效；接力仍由这个独立时间线完成。
  return { kill() { if (!committed) { timeline.kill(); source.runtime.cancel(); layer.remove(); if (pending === source) pending = null; cleanup(); } } };
}

export async function mountWorkbenchCore(host, options) {
  if (pending && !pending.finished) {
    const source = pending;
    source.target = host;
    return { dispose() {
      // StrictMode 的试挂载会马上换成新的目标，不提前销毁在飞行中的画布。
      queueMicrotask(() => {
        if (source.target === host && !host.isConnected) source.runtime.cancel();
      });
      if (source.finished) source.runtime.dispose();
    } };
  }
  const { createDataIsland } = await import("./components/dataIsland.mjs");
  if (!host.isConnected) return null;
  return createDataIsland(host, [], { ...options, coreOnly: true });
}
