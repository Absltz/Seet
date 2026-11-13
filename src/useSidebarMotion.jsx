import { useCallback, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

// 用真实列宽过渡，让分析内容随可用空间重排，避免缩放文字和图表。
export function useSidebarMotion(root, page) {
  const [open, setOpen] = useState(true);
  const intended = useRef(true), pending = useRef(null), expandedWidth = useRef(0);

  const change = useCallback(value => {
    const next = typeof value === "function" ? !!value(intended.current) : !!value;
    if (next === intended.current) return;
    const element = root.current, sidebar = element?.querySelector(".sidebar");
    if (sidebar) {
      const width = sidebar.getBoundingClientRect().width;
      if (!element.hasAttribute("data-sidebar-motion") && width > 0) expandedWidth.current = width;
      pending.current = {
        element, width,
        gap: width ? parseFloat(getComputedStyle(element).columnGap) || 0 : 0,
        opacity: width ? Number(getComputedStyle(sidebar).opacity) : 0,
        focusInside: sidebar.contains(document.activeElement),
        focusFromOpen: document.activeElement?.matches(".panel-toggle-open"),
      };
    } else pending.current = null;
    intended.current = next;
    setOpen(next);
  }, [root]);

  useGSAP((context, contextSafe) => {
    const request = pending.current;
    pending.current = null;
    const element = root.current;
    if (!request || !element || request.element !== element) return;
    const sidebar = element.querySelector(".sidebar"), thread = sidebar.querySelector(".agent-thread");
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches || window.innerWidth <= 850) return;

    // 此时 React 已提交目标布局，统一读取目标尺寸后再写动画起点。
    const targetWidth = open ? sidebar.getBoundingClientRect().width : 0;
    const targetGap = open ? parseFloat(getComputedStyle(element).columnGap) || 0 : 0;
    if (open) expandedWidth.current = targetWidth;
    const fullWidth = expandedWidth.current || request.width;
    const duration = Math.max(.18, .44 * Math.min(1, Math.abs(targetWidth - request.width) / Math.max(fullWidth, 1)));
    let timeline;
    const reset = () => {
      element.removeAttribute("data-sidebar-motion");
      element.style.removeProperty("grid-template-columns");
      element.style.removeProperty("column-gap");
      sidebar.style.removeProperty("display");
      sidebar.style.removeProperty("opacity");
      sidebar.style.removeProperty("visibility");
      thread.style.removeProperty("width");
    };
    const finish = contextSafe(() => {
      reset();
      window.removeEventListener("resize", settle);
      media.removeEventListener("change", settle);
      if (!element.isConnected) return;
      if (!open && request.focusInside) element.querySelector(".panel-toggle-open")?.focus({preventScroll:true});
      if (open && request.focusFromOpen) sidebar.querySelector(".panel-toggle-close")?.focus({preventScroll:true});
    });
    const settle = () => { timeline?.kill(); finish(); };

    element.setAttribute("data-sidebar-motion", "");
    gsap.set(element, {gridTemplateColumns:`${request.width}px minmax(0, 1fr)`, columnGap:request.gap});
    gsap.set(sidebar, {display:"flex", opacity:request.opacity, visibility:"visible"});
    // 过渡期间保持对话的排版宽度，由外侧面板裁切，避免内容被挤成窄列。
    gsap.set(thread, {width:Math.max(0, fullWidth - 2)});
    timeline = gsap.timeline({onComplete:finish});
    timeline.to(element, {gridTemplateColumns:`${targetWidth}px minmax(0, 1fr)`, columnGap:targetGap,
      duration, ease:"power2.inOut"}, 0);
    timeline.to(sidebar, {opacity:open ? 1 : 0, duration:Math.min(.26, duration), ease:"power2.out"}, 0);
    window.addEventListener("resize", settle);
    media.addEventListener("change", settle);
    return () => {
      timeline.kill();
      window.removeEventListener("resize", settle);
      media.removeEventListener("change", settle);
      reset();
    };
  }, {scope:root, dependencies:[open, page], revertOnUpdate:true});

  return [open, change];
}
