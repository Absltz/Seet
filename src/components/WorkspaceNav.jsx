import { useEffect, useLayoutEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

const destinations = [
  ["/", "AI 分析"],
  ["/datasets", "数据集库"],
  ["/sheets", "数据表格"],
  ["/boards", "分析看板"],
  ["/reports", "报告中心"],
  ["/trash", "回收站"],
];

// 页签背景保留在同一个导航节点中，切页和连续点击都从当前帧接着移动。
export default function WorkspaceNav({ page, onNavigate, disabled, analysisDisabled }) {
  const root = useRef(null), surface = useRef(null), contrast = useRef(null), initialized = useRef(false);
  const align = useRef(null);
  const { contextSafe } = useGSAP(() => {
    initialized.current = false;
    return () => { initialized.current = false; };
  }, { scope: root });

  align.current = contextSafe((animate = true) => {
    const nav = root.current, shape = surface.current, text = contrast.current;
    if (!nav || !shape) return;
    const selected = nav.querySelector('[aria-current="page"]');
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!selected) {
      gsap.to(shape, { opacity: 0, duration: reduced ? 0 : 0.15, overwrite: "auto" });
      gsap.to(text, { opacity: 0, duration: reduced ? 0 : 0.15, overwrite: "auto" });
      return;
    }
    const left = selected.offsetLeft - 10;
    const width = selected.offsetWidth + 20;
    const target = { x: left, scaleX: width / 160, opacity: 1 };
    const textTarget = { clipPath: `inset(0px ${text.offsetWidth - left - width}px 0px ${left}px)`, opacity: 1 };
    if (!initialized.current || reduced || !animate) {
      gsap.killTweensOf([shape, text]);
      gsap.set(shape, target);
      gsap.set(text, textTarget);
    } else {
      gsap.to(shape, { ...target, duration: 0.48, ease: "power3.out", overwrite: "auto" });
      gsap.to(text, { ...textTarget, duration: 0.48, ease: "power3.out", overwrite: "auto" });
    }
    initialized.current = true;
    // 只滚动页签行，移动端切到右侧页面不会把整个页面带走。
    const edge = selected.offsetLeft + selected.offsetWidth;
    if (selected.offsetLeft < nav.scrollLeft || edge > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: Math.max(0, edge - nav.clientWidth + 14), behavior: reduced ? "instant" : "smooth" });
    }
  });

  useLayoutEffect(() => { align.current(true); }, [page]);
  useEffect(() => {
    const nav = root.current;
    const observer = new ResizeObserver(() => align.current(false));
    observer.observe(nav);
    nav.querySelectorAll("button").forEach(button => observer.observe(button));
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const synchronize = () => align.current(false);
    preference.addEventListener("change", synchronize);
    let live = true;
    document.fonts?.ready.then(() => { if (live) synchronize(); });
    return () => {
      live = false;
      observer.disconnect();
      preference.removeEventListener("change", synchronize);
    };
  }, []);

  return (
    <nav ref={root} className="topnav workspace-tabs" aria-label="主要导航">
      <span ref={surface} className="workspace-tab-surface" aria-hidden="true">
        <svg viewBox="0 0 160 70" preserveAspectRatio="none">
          <path d="M0 69 C9 69 13 64 13 55 V22 C13 10 20 3 32 3 H128 C140 3 147 10 147 22 V55 C147 64 151 69 160 69" />
        </svg>
        <i />
      </span>
      {destinations.map(([href, label]) => (
        <button key={href} aria-current={page === href ? "page" : undefined}
          className={page === href ? "nav-active" : ""}
          disabled={href === "/" ? analysisDisabled : disabled}
          onClick={() => onNavigate(href)}>{label}</button>
      ))}
      <span ref={contrast} className="workspace-tab-contrast" aria-hidden="true">
        {destinations.map(([href, label]) => <span key={href} className={page === href ? "current" : ""}>{label}</span>)}
      </span>
    </nav>
  );
}
