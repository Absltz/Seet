import { useEffect, useRef, useState } from "react";

export default function DataSculpture() {
  const host = useRef(null);
  const [status, setStatus] = useState("loading");
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    let cancelled = false,
      instance;
    setStatus("loading");
    import("./dataIsland.mjs")
      .then(({ createDataIsland }) => {
        if (cancelled) return;
        instance = createDataIsland(host.current, [], {
          reduced,
          onFailure: () => {
            if (!cancelled) setStatus("unavailable");
          },
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
      instance?.dispose();
    };
  }, [reduced]);
  return (
    <div
      className={`data-sculpture data-island ${status === "ready" ? "scene-ready" : ""}`}
      aria-busy={status === "loading"}
    >
      {status === "loading" && (
        <div
          className="scene-loading"
          role="status"
          aria-label="三维场景加载中"
        >
          <span />
          <span />
          <span />
        </div>
      )}
      {status === "unavailable" && (
        <p className="scene-unavailable" role="status">
          三维场景暂不可用
        </p>
      )}
      <div className="island-canvas" ref={host} aria-hidden="true" />
    </div>
  );
}
