const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const unitEase = (progress) => {
  const t = clamp(progress, 0, 1);
  return t * t * t * (t * (6 * t - 15) + 10);
};

// 暖白面从登录页原有分界向左展开，与模型共用同一个时间进度。
export function arrivalSurfaceFrame(progress, { width, split }) {
  const edge = clamp(split, 0, width) * (1 - unitEase(progress));
  return { edge, scaleX: (width - edge) / width };
}

export function arrivalContentFrame(progress, edge, left) {
  const paper = clamp((left - edge + 24) / 48, 0, 1);
  const reveal = paper * paper * (3 - 2 * paper) * unitEase(progress / 0.2);
  return { opacity: reveal, y: 8 * (1 - reveal) };
}

// 整段飞行只改三维模型本身。画布不缩放，也不依据包围盒临时改道。
// 五次缓动让速度与加速度在首尾归零，接上主页的缓慢自转。
export function arrivalFrame(progress, config) {
  const { start, end, viewport, startScale, endScale } = config;
  const t = clamp(progress, 0, 1);
  if (t === 0) return { ...start, scale: startScale };
  if (t === 1) return { ...end, scale: endScale };
  const u = unitEase(t);
  const v = 1 - u;
  const dx = end.x - start.x;
  const drop = Math.min(viewport.height * 0.2, Math.abs(dx) * 0.25);
  const control1 = { x: start.x + dx * 0.3, y: start.y + drop };
  const control2 = { x: end.x - dx * 0.22, y: end.y + drop * 1.25 };
  return {
    x: v ** 3 * start.x + 3 * v * v * u * control1.x + 3 * v * u * u * control2.x + u ** 3 * end.x,
    y: v ** 3 * start.y + 3 * v * v * u * control1.y + 3 * v * u * u * control2.y + u ** 3 * end.y,
    scale: startScale + (endScale - startScale) * u,
  };
}

// 接管为全屏画布时保持原来一像素对应的世界尺寸与屏幕原点。
export function arrivalFrustum(width, height, unitsPerPixel, center = { x: width / 2, y: height / 2 }) {
  return {
    left: -center.x * unitsPerPixel,
    right: (width - center.x) * unitsPerPixel,
    top: center.y * unitsPerPixel,
    bottom: -(height - center.y) * unitsPerPixel,
  };
}
