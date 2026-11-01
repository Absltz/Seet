// Coalesce all material, pose and GSAP changes before the next browser paint.
export function createScenePainter(
  draw,
  { request = requestAnimationFrame, cancel = cancelAnimationFrame } = {},
) {
  let pending = null,
    disposed = false;
  const clear = () => {
    if (pending !== null) {
      cancel(pending);
      pending = null;
    }
  };
  return {
    request() {
      if (disposed || pending !== null) return;
      pending = request(() => {
        pending = null;
        if (!disposed) draw();
      });
    },
    drawNow() {
      if (disposed) return;
      clear();
      draw();
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
