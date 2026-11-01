import gsap from "gsap";
import { arrivalSurfaceFrame, arrivalContentFrame } from "./arrivalMotion.mjs";

let pending = null;

// 只交接一个实时 WebGL 场景，不截屏、不创建第二个模型。
export function captureLoginArrival() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const host = document.querySelector(".login-visual .island-canvas");
  const panel = document.querySelector(".login-visual");
  if (!host || !panel) return;
  const rect = host.getBoundingClientRect(),
    clip = panel.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "login-arrival-layer";
  layer.setAttribute("aria-hidden", "true");
  const stage = document.createElement("div");
  stage.className = "login-arrival-stage";
  layer.append(stage);
  document.body.append(layer);
  gsap.set(layer, {
    clipPath: `inset(${clip.top}px ${Math.max(0, innerWidth - clip.right)}px ${Math.max(0, innerHeight - clip.bottom)}px ${clip.left}px)`,
  });
  const detail = { host: stage, sourceRect: rect };
  host.dispatchEvent(new CustomEvent("seet-capture", { detail }));
  if (!detail.runtime) {
    layer.remove();
    return;
  }
  const backdrop = document.createElement("div");
  backdrop.className = "login-arrival-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const paper = document.createElement("div");
  paper.className = "login-arrival-paper";
  backdrop.append(paper);
  document.body.append(backdrop);
  const surface = {
    width: backdrop.getBoundingClientRect().width,
    split: window.matchMedia("(min-width: 761px)").matches ? clip.right : 0,
  };
  paper.style.transform = `scaleX(${arrivalSurfaceFrame(0, surface).scaleX})`;
  pending = {
    backdrop,
    paper,
    surface,
    runtime: detail.runtime,
    layer,
    stage,
    time: performance.now(),
    owner: null,
  };
}

export function playLoginArrival(root) {
  const source = pending;
  const target = root.querySelector(".home-hero .island-canvas");
  if (!source) return null;
  if (!target || performance.now() - source.time > 5000) {
    source.runtime.cancel();
    source.layer.remove();
    source.backdrop.remove();
    pending = null;
    return null;
  }
  const destination = target.getBoundingClientRect();
  const scene = target.closest(".data-island");
  const content = root.querySelectorAll(
    ".home-header > a, .home-header > nav, .home-header-actions, .home-hero-copy, .home-hero-bottom",
  );
  // 背景在主页内容下方展开，模型始终留在最上方的同一张实时画布里。
  root.classList.add("is-arriving");
  root.prepend(source.backdrop);
  const token = {};
  source.owner = token;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    source.runtime.finish(target, [...scene.querySelectorAll(".scene-label")]);
    gsap.set(scene, { clearProps: "opacity" });
    gsap.set(content, { clearProps: "opacity,transform" });
    root.classList.remove("is-arriving");
    source.layer.remove();
    source.backdrop.remove();
    if (pending === source) pending = null;
  };
  const progress = { value: 0 };
  source.runtime.configureArrival(destination);
  const setPaperScale = gsap.quickSetter(source.paper, "scaleX");
  const reveals = [...content].map(element => ({
    left: element.getBoundingClientRect().left,
    opacity: gsap.quickSetter(element, "opacity"),
    y: gsap.quickSetter(element, "y", "px"),
  }));
  const update = () => {
    source.runtime.arrivalFrame(progress.value);
    const surface = arrivalSurfaceFrame(progress.value, source.surface);
    setPaperScale(surface.scaleX);
    for (const element of reveals) {
      const reveal = arrivalContentFrame(progress.value, surface.edge, element.left);
      element.opacity(reveal.opacity);
      element.y(reveal.y);
    }
  };
  update();
  const timeline = gsap.timeline({ onComplete: finish });
  timeline
    .set(scene, { opacity: 0 })
    .to(
      progress,
      { value: 1, duration: 2.25, ease: "none", onUpdate: update },
      0,
    )
    .to(
      source.layer,
      {
        clipPath: "inset(0px 0px 0px 0px)",
        duration: 0.35,
        ease: "power2.out",
      },
      0,
    );
  const resize = () => {
    timeline.kill();
    finish();
  };
  window.addEventListener("resize", resize);
  return () => {
    timeline.kill();
    window.removeEventListener("resize", resize);
    // StrictMode immediately sets up the same effect again; defer abandonment.
    queueMicrotask(() => {
      if (!finished && source.owner === token) {
        source.runtime.cancel();
        source.layer.remove();
        source.backdrop.remove();
        root.classList.remove("is-arriving");
        if (pending === source) pending = null;
      }
    });
  };
}
