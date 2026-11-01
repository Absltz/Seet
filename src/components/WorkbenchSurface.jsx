import { useEffect, useRef, useState } from "react";
import { mountWorkbenchCore, hasWorkbenchArrival } from "../workbenchArrival.js";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

// 与主页交接同一颗三维核心；直接进入工作台时创建独立的小场景。
export function AICore({ working = false }) {
  const host = useRef(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false, instance;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const create = () => {
      instance?.dispose();
      mountWorkbenchCore(host.current, { reduced: preference.matches, onFailure: () => setUnavailable(true) })
        .then(runtime => { if (disposed) runtime?.dispose(); else instance = runtime; })
        .catch(() => { if (!disposed) setUnavailable(true); });
    };
    create();
    preference.addEventListener("change", create);
    return () => { disposed = true; preference.removeEventListener("change", create); instance?.dispose(); };
  }, []);
  return (
    <span className={`workbench-core${working ? " working" : ""}`} aria-hidden="true">
      <span ref={host} className="workbench-core-canvas" />
      {unavailable && <span className="core-sphere" />}
    </span>
  );
}

export default function WorkbenchSurface({ children, viewKey }) {
  const root = useRef(null);
  useGSAP(() => {
    if (hasWorkbenchArrival()) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-workbench-pane]", { y: 10, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.42, stagger: 0.06,
        ease: "power2.out", clearProps: "transform,opacity",
      });
    });
    return () => media.revert();
  }, { scope: root });

  useGSAP(() => {
    if (hasWorkbenchArrival()) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const result = root.current?.querySelector(".analysis-body, .data-panel, .report-panel");
      if (result) gsap.fromTo(result, { opacity: 0.65, y: 4 }, {
        opacity: 1, y: 0, duration: 0.24, ease: "power2.out",
        clearProps: "transform,opacity", overwrite: "auto",
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [viewKey], revertOnUpdate: true });

  return <div ref={root} className="app-frame agent-app canvas-workbench">{children}</div>;
}
