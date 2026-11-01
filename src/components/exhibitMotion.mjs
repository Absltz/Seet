export const EXHIBIT_COUNT = 3;
export const HOME_DWELL = 3.5;
export const HOME_TRANSITION = 0.7;
export const HOME_MODEL_SCALE = 1.6;
const right = [10 / Math.sqrt(164), -8 / Math.sqrt(164)];
const front = [8 / Math.sqrt(164), 10 / Math.sqrt(164)];
// Angle zero is at the viewer's right; positive depth faces the camera.
export function orbitPose(index, phase) {
  const angle = phase + (index * Math.PI * 2) / EXHIBIT_COUNT;
  const side = Math.cos(angle) * 3.7;
  const depth = Math.sin(angle) * 3.25;
  return {
    x: right[0] * side + front[0] * depth,
    y: 1.1,
    z: right[1] * side + front[1] * depth,
    depth,
  };
}
export function frontExhibit(phase) {
  let best = 0;
  for (let i = 1; i < EXHIBIT_COUNT; i++)
    if (orbitPose(i, phase).depth > orbitPose(best, phase).depth) best = i;
  return best;
}

// 交接目标是相机右侧与前侧之间的 45° 方位，即轨道的右下四分之一区域。
// 比较角距离而非模型编号或包围盒，三种模型轮转到该区域时都能被选中。
export function frontRightExhibit(phase) {
  const target = Math.PI / 4;
  const score = index => Math.cos(phase + index * Math.PI * 2 / EXHIBIT_COUNT - target);
  let best = 0;
  for (let index = 1; index < EXHIBIT_COUNT; index++) {
    const difference = score(index) - score(best);
    if (difference > 1e-10 || (Math.abs(difference) <= 1e-10
      && orbitPose(index, phase).depth > orbitPose(best, phase).depth)) best = index;
  }
  return best;
}

export function nextExhibit(index) {
  return (index + 1) % EXHIBIT_COUNT;
}

// Shared by the live camera and the login handoff: identical projection at both ends.
export function sceneFramingScale(width, height) {
  return Math.max(
    12.1 / Math.max(1, width - 32),
    9.1 / Math.max(1, height - 32),
  );
}

const unit = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};
// The old exhibit is almost gone before the new one reaches a noticeable size.
export function carouselFrame(progress) {
  const t = unit(progress),
    out = smooth(t / 0.55),
    incoming = smooth((t - 0.28) / 0.72);
  return {
    outScale: HOME_MODEL_SCALE * (1 - out),
    inScale: HOME_MODEL_SCALE * incoming,
    outOpacity: 1 - smooth((t - 0.25) / 0.3),
    inOpacity: smooth((t - 0.28) / 0.22),
    incoming,
  };
}
