import { createContext, useContext, useEffect, useRef, useState } from "react";
import { mountWorkbenchCore, hasWorkbenchArrival } from "../workbenchArrival.js";
import { createWorkbenchCoreSession } from "./workbenchCoreSession.mjs";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);
const CoreSession = createContext(null);

// 与主页交接同一颗三维核心；直接进入工作台时创建独立的小场景。
export function AICore({ working = false }) {
  const session = useContext(CoreSession);
  const host = useRef(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false, lease;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const create = () => {
      lease?.release();
      setUnavailable(false);
      lease = session.acquire(host.current, {
        reduced: preference.matches,
        onFailure: () => { if (!disposed) setUnavailable(true); },
      });
      lease.ready.catch(() => { if (!disposed) setUnavailable(true); });
    };
    create();
    preference.addEventListener("change", create);
    return () => { disposed = true; preference.removeEventListener("change", create); lease?.release(); };
  }, [session]);
  return (
    <span className={`workbench-core${working ? " working" : ""}`} aria-hidden="true">
      <span ref={host} className="workbench-core-canvas" />
      {unavailable && <span className="core-sphere" />}
    </span>
  );
}

export default function WorkbenchSurface({ children, viewKey, mode = "workbench" }) {
  const root = useRef(null);
  const [session] = useState(() => createWorkbenchCoreSession(mountWorkbenchCore));
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // 内页只暂停和移交画布，退出工作区才释放；兼容 StrictMode 的效果重放。
      queueMicrotask(() => { if (!mounted.current) session.dispose(); });
    };
  }, [session]);
  useGSAP(() => {
    if (mode !== "workbench" || hasWorkbenchArrival()) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-workbench-pane]", { y: 10, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.42, stagger: 0.06,
        ease: "power2.out", clearProps: "transform,opacity",
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [mode], revertOnUpdate: true });

  useGSAP(() => {
    if (mode !== "workbench" || hasWorkbenchArrival()) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const result = root.current?.querySelector(".analysis-body, .data-panel, .report-panel");
      if (result) gsap.fromTo(result, { opacity: 0.65, y: 4 }, {
        opacity: 1, y: 0, duration: 0.24, ease: "power2.out",
        clearProps: "transform,opacity", overwrite: "auto",
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [viewKey, mode], revertOnUpdate: true });

  return <CoreSession.Provider value={session}><div ref={root} className={`app-frame workspace-chrome ${mode === "workbench" ? "agent-app canvas-workbench" : mode}`}>{children}</div></CoreSession.Provider>;
}
