import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import * as motion from "../src/arrivalMotion.mjs";
import { sceneFramingScale } from "../src/components/exhibitMotion.mjs";

const config = {
  start: { x: 200, y: 600 },
  end: { x: 1050, y: 420 },
  viewport: { width: 1440, height: 900 },
  startScale: 0.56,
  endScale: 1.32,
};

test("登录暖白底色从原有左右分界连续向左铺满，始终保持不透明", () => {
  assert.equal(typeof motion.arrivalSurfaceFrame, "function");
  const surface = { width: 1440, split: 770 };
  const start = motion.arrivalSurfaceFrame(0, surface);
  assert.equal(start.edge, 770);
  assert.equal(start.scaleX, (1440 - 770) / 1440);
  assert.deepEqual(motion.arrivalSurfaceFrame(1, surface), { edge: 0, scaleX: 1 });
  let previous = start;
  for (let i = 1; i <= 1000; i++) {
    const current = motion.arrivalSurfaceFrame(i / 1000, surface);
    assert.ok(current.edge <= previous.edge && current.edge >= 0);
    assert.ok(current.scaleX >= previous.scaleX && current.scaleX <= 1);
    assert.ok(Math.abs(current.edge + current.scaleX * surface.width - surface.width) < 1e-8);
    previous = current;
  }
});

test("主页深色内容随暖白背景到达后显现，不能提前叠在深绿底上", () => {
  assert.equal(typeof motion.arrivalContentFrame, "function");
  for (const left of [56, 430, 1100]) {
    let previous = 0;
    for (let i = 0; i <= 1000; i++) {
      const progress = i / 1000;
      const { edge } = motion.arrivalSurfaceFrame(progress, { width: 1440, split: 770 });
      const content = motion.arrivalContentFrame(progress, edge, left);
      if (edge >= left + 24) assert.equal(content.opacity, 0);
      assert.ok(content.opacity >= previous - 1e-9 && content.opacity <= 1);
      previous = content.opacity;
    }
    assert.deepEqual(motion.arrivalContentFrame(1, 0, left), { opacity: 1, y: 0 });
  }
});

test("窄屏没有左右分界时保留整片暖白背景", () => {
  assert.equal(typeof motion.arrivalSurfaceFrame, "function");
  for (const progress of [0, 0.5, 1])
    assert.deepEqual(motion.arrivalSurfaceFrame(progress, { width: 375, split: 0 }), { edge: 0, scaleX: 1 });
});

test("沿草图下弧连接两个位置，只由一条曲线控制实际模型尺寸", () => {
  assert.deepEqual(motion.arrivalFrame(0, config), { ...config.start, scale: 0.56 });
  assert.deepEqual(motion.arrivalFrame(1, config), { ...config.end, scale: 1.32 });
  const mid = motion.arrivalFrame(0.5, config);
  assert.ok(mid.y > config.start.y, "中途应从下方绕行，而非直线平移");
  let previous = motion.arrivalFrame(0, config);
  for (let i = 1; i <= 2000; i++) {
    const current = motion.arrivalFrame(i / 2000, config);
    assert.ok(current.scale >= previous.scale, "登录飞行中不能反向缩小");
    assert.ok(current.scale <= config.endScale, "不额外放大后再缩回落点");
    assert.ok(current.x >= previous.x, "从左往右沿弧线连续移动");
    assert.ok(Math.hypot(current.x - previous.x, current.y - previous.y) < 2);
    previous = current;
  }
});

test("曲线与缩放不受逐帧包围盒变化影响，避免修正曲线造成忽大忽小", () => {
  for (const progress of [0.1, 0.35, 0.6, 0.85, 0.99]) {
    const stable = motion.arrivalFrame(progress, config);
    const changedBounds = motion.arrivalFrame(progress, {
      ...config, projectedWidth: 1800, projectedHeight: 1400, modelScale: 2.5,
    });
    assert.deepEqual(changedBounds, stable);
  }
});

test("首尾平缓且手机窗口不会产生数值跳变", () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    const path = { ...config, viewport };
    for (const t of [0, 1]) {
      const exact = motion.arrivalFrame(t, path);
      const near = motion.arrivalFrame(t === 0 ? 0.0001 : 0.9999, path);
      assert.ok(Math.hypot(exact.x - near.x, exact.y - near.y) < 0.001);
      assert.ok(Math.abs(exact.scale - near.scale) < 0.00001);
    }
  }
});

test("主页保留大尺寸画框，不能在落位后恢复成小尺寸", () => {
  const regular = sceneFramingScale(720, 576);
  const enlarged = sceneFramingScale(1152, 921.6);
  assert.ok(regular / enlarged > 1.5 && regular / enlarged < 1.8);
  const small = {
    ...config,
    start: { x: 60, y: 260 }, end: { x: 187, y: 450 },
    viewport: { width: 375, height: 812 }, endScale: 1.4,
  };
  let previous = motion.arrivalFrame(0, small);
  for (let i = 1; i <= 1000; i++) {
    const current = motion.arrivalFrame(i / 1000, small);
    assert.ok([current.x, current.y, current.scale].every(Number.isFinite));
    assert.ok(current.scale >= previous.scale && current.scale <= small.endScale);
    assert.ok(Math.hypot(current.x - previous.x, current.y - previous.y) < 2);
    previous = current;
  }
});

test("全屏接管画布保持原来每个三维点的位置与投影尺寸", () => {
  assert.equal(typeof motion.arrivalFrustum, "function", "需要保持像素投影的接管画框");
  const source = { left: -270, top: 300, width: 1155, height: 1008 };
  const viewport = config.viewport;
  const units = sceneFramingScale(source.width, source.height);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  camera.position.set(8, 7, 10);
  camera.lookAt(0, 1.1, 0);
  camera.updateMatrixWorld();
  Object.assign(camera, motion.arrivalFrustum(source.width, source.height, units));
  camera.updateProjectionMatrix();
  const corners = [];
  for (const x of [-4, 0, 4]) for (const y of [0, 3]) for (const z of [-3, 3])
    corners.push(new THREE.Vector3(x, y, z));
  const screen = (point, width, height) => {
    const p = point.clone().project(camera);
    return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 };
  };
  const original = corners.map(p => screen(p, source.width, source.height));
  Object.assign(camera, motion.arrivalFrustum(viewport.width, viewport.height, units, {
    x: source.left + source.width / 2, y: source.top + source.height / 2,
  }));
  camera.updateProjectionMatrix();
  corners.forEach((p, i) => {
    const captured = screen(p, viewport.width, viewport.height);
    assert.ok(Math.abs(captured.x - original[i].x - source.left) < 1e-8);
    assert.ok(Math.abs(captured.y - original[i].y - source.top) < 1e-8);
  });
});

test("落位前后换回主页相机，各个顶点保持同一屏幕位置", () => {
  assert.equal(typeof motion.arrivalFrustum, "function");
  const sourceUnits = sceneFramingScale(1155, 1008);
  const destination = { left: 600, top: 10, width: 1200, height: 1000 };
  const destinationUnits = sceneFramingScale(destination.width, destination.height);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  camera.position.set(8, 7, 10);
  camera.lookAt(0, 1.1, 0);
  camera.updateMatrixWorld();
  Object.assign(camera, motion.arrivalFrustum(1440, 900, sourceUnits));
  camera.updateProjectionMatrix();
  const depth = new THREE.Vector3(0, 1.1, 0).project(camera).z;
  const position = new THREE.Vector3(
    (destination.left + destination.width / 2) / 1440 * 2 - 1,
    1 - (destination.top + destination.height / 2) / 900 * 2, depth,
  ).unproject(camera);
  for (const yaw of [-0.3, 0.55, 1.5]) {
    const pose = new THREE.Object3D();
    pose.position.copy(position);
    pose.rotation.y = yaw;
    pose.scale.setScalar(1.6 * sourceUnits / destinationUnits);
    pose.updateMatrixWorld();
    const points = [[-3, -1, -2], [0, 4, 0], [3, 1, 2]].map(p => new THREE.Vector3(...p));
    const before = points.map(p => p.clone().applyMatrix4(pose.matrixWorld).project(camera));
    Object.assign(camera, motion.arrivalFrustum(destination.width, destination.height, destinationUnits));
    camera.updateProjectionMatrix();
    pose.position.set(0, 1.1, 0);
    pose.scale.setScalar(1.6);
    pose.updateMatrixWorld();
    points.forEach((p, i) => {
      const after = p.clone().applyMatrix4(pose.matrixWorld).project(camera);
      assert.ok(Math.abs((before[i].x + 1) * 720 - (destination.left + (after.x + 1) * destination.width / 2)) < 1e-7);
      assert.ok(Math.abs((1 - before[i].y) * 450 - (destination.top + (1 - after.y) * destination.height / 2)) < 1e-7);
    });
    Object.assign(camera, motion.arrivalFrustum(1440, 900, sourceUnits));
    camera.updateProjectionMatrix();
  }
});
