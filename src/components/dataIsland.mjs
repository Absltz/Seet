import * as THREE from "three";
import gsap from "gsap";
import { createScenePainter } from "./sceneFrame.mjs";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createExhibits, createAICore } from "./exhibitGeometry.mjs";
import { arrivalFrame, arrivalFrustum } from "../arrivalMotion.mjs";
import { workbenchOrbitFrame } from "../workbenchMotion.mjs";
import {
  orbitPose,
  frontExhibit,
  frontRightExhibit,
  nextExhibit,
  HOME_DWELL,
  HOME_TRANSITION,
  HOME_MODEL_SCALE,
  carouselFrame,
  sceneFramingScale as framingScale,
} from "./exhibitMotion.mjs";
let transferredScene = null;

export function createDataIsland(host, labels, { reduced, onFailure, coreOnly = false }) {
  if (host.closest(".home-hero") && transferredScene) {
    const existing = transferredScene;
    transferredScene = null;
    if (!reduced) {
      existing.adopt(host, labels, onFailure);
      return existing;
    }
    existing.cancel();
  }
  let disposed = false,
    transferring = false,
    adopted = false,
    homeHost,
    homeLabels,
    expiry;
  let mode = coreOnly ? "workspace" : host.closest(".login-visual") ? "login" : "home";
  let active = 0,
    phase = 0.55,
    elapsed = 0,
    homeClock = 0,
    transitioning = false,
    arrival = null;
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.dataset.sceneId = crypto.randomUUID();
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-6, 6, 5, -5, 0.1, 80);
  camera.position.set(8, 7, 10);
  camera.lookAt(0, 1.1, 0);
  const painter = createScenePainter(() => renderer.render(scene, camera));
  scene.add(new THREE.HemisphereLight(0xf8ffe7, 0x526b5a, 2));
  const sun = new THREE.DirectionalLight(0xfff7dd, 3);
  sun.position.set(-3, 9, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xd8efdf, 1.5);
  fill.position.set(5, 4, -7);
  scene.add(fill);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = envTarget.texture;
  environment.dispose();
  pmrem.dispose();
  const exhibits = coreOnly ? [] : createExhibits();
  exhibits.forEach((g) => scene.add(g));
  const core = createAICore();
  scene.add(core);
  const coreLabel = core.children.find(object => object.isSprite);
  const labelFront = camera.getWorldDirection(new THREE.Vector3()).negate().multiplyScalar(.8);
  const labelInverse = new THREE.Quaternion();
  // 标签也参加深度测试，位于模型背面时不会透过另一物体显示。
  function faceCoreLabel() {
    if (!coreLabel || !(mode === "workspace" || mode === "rendezvous")) return;
    coreLabel.material.depthTest = true;
    coreLabel.position.copy(labelFront).applyQuaternion(labelInverse.copy(core.quaternion).invert());
  }
  let width = 1,
    height = 1,
    ticking = false,
    visible = true;
  const animations = new Set();
  function animate(target, vars) {
    let tween;
    tween = gsap.to(target, {
      ...vars,
      onUpdate: () => {
        vars.onUpdate?.();
        render();
      },
      onComplete: () => {
        animations.delete(tween);
        vars.onComplete?.();
      },
    });
    animations.add(tween);
    return tween;
  }
  function emit() {
    renderer.domElement.dataset.exhibit = String(active);
    renderer.domElement.dataset.mode = mode;
    host.dispatchEvent(
      new CustomEvent("seet-scene-state", { detail: { index: active, mode } }),
    );
  }
  function orbitLayout() {
    exhibits.forEach((group, i) => {
      const p = orbitPose(i, phase);
      group.position.set(p.x, p.y, p.z);
      group.scale.setScalar(0.56);
      group.rotation.y = 0.55 + Math.sin(phase * 0.6 + i) * 0.18;
    });
    active = frontRightExhibit(phase);
    renderer.domElement.dataset.arrivalExhibit = String(active);
    renderer.domElement.dataset.frontExhibit = String(frontExhibit(phase));
  }
  function homeLayout() {
    core.visible = false;
    exhibits.forEach((group, i) => {
      group.visible = i === active;
      group.position.set(0, 1.1, 0);
      group.scale.setScalar(HOME_MODEL_SCALE);
      group.rotation.y = -0.25;
    });
    emit();
  }
  function materialsOf(group) {
    const result = new Set();
    group.traverse((o) => {
      if (o.material)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          result.add(m);
    });
    return result;
  }
  // Each exhibit owns its materials so crossfades never change another model's opacity.
  exhibits.forEach((group) => {
    const clones = new Map();
    group.traverse((object) => {
      if (!object.material) return;
      if (!clones.has(object.material))
        clones.set(object.material, object.material.clone());
      object.material = clones.get(object.material);
      object.material.transparent = true;
    });
  });
  function fade(group, opacity, duration) {
    materialsOf(group).forEach((material) =>
      animate(material, { opacity, duration, ease: "sine.inOut" }),
    );
  }
  function enterHome(sourceRect) {
    active = frontRightExhibit(phase);
    renderer.domElement.dataset.capturedExhibit = String(active);
    const selected = exhibits[active];
    const unitsPerPixel = frameScale(width, height);
    const projected = selected.position.clone().project(camera);
    const depth = new THREE.Vector3(0, 1.1, 0).project(camera).z;
    arrival = {
      unitsPerPixel,
      center: { x: sourceRect.left + width / 2, y: sourceRect.top + height / 2 },
      start: {
        x: sourceRect.left + ((projected.x + 1) * width) / 2,
        y: sourceRect.top + ((1 - projected.y) * height) / 2,
      },
      startScale: selected.scale.x,
      depth,
      path: null,
    };
    mode = "home";
    homeClock = 0;
    transitioning = true;
    emit();
    animate(core.scale, {
      x: 0.001,
      y: 0.001,
      z: 0.001,
      duration: 0.65,
      ease: "power2.in",
      onComplete: () => {
        core.visible = false;
      },
    });
    exhibits.forEach((group, i) => {
      // The selected model is driven only by the shared flight progress.
      if (i !== active) {
        fade(group, 0, 0.55);
        animate(group.scale, {
          x: 0.2,
          y: 0.2,
          z: 0.2,
          duration: 0.65,
          ease: "power2.in",
          onComplete: () => {
            group.visible = false;
          },
        });
      }
    });
  }
  const arrivalPosition = new THREE.Vector3();
  function applyArrival(progress) {
    if (!arrival?.path) return;
    const selected = exhibits[active];
    const pose = arrivalFrame(progress, arrival.path);
    arrivalPosition.set((pose.x / width) * 2 - 1, 1 - (pose.y / height) * 2, arrival.depth).unproject(camera);
    selected.position.copy(arrivalPosition);
    selected.scale.setScalar(pose.scale);
    // 飞行时保留同一朝向，形状不因转向改变宽度；落位后继续自转。
    render();
    return pose;
  }

  function cycle() {
    if (transitioning || disposed) return;
    transitioning = true;
    const outgoing = exhibits[active];
    active = nextExhibit(active);
    const incoming = exhibits[active];
    const oldYaw = outgoing.rotation.y;
    const oldMaterials = materialsOf(outgoing),
      newMaterials = materialsOf(incoming);
    incoming.visible = true;
    incoming.position.set(0, 1.1, 0);
    incoming.rotation.set(0, -0.45, 0);
    const progress = { value: 0 };
    const update = () => {
      const pose = carouselFrame(progress.value);
      outgoing.scale.setScalar(Math.max(0.001, pose.outScale));
      incoming.scale.setScalar(Math.max(0.001, pose.inScale));
      outgoing.rotation.y = oldYaw + progress.value * 0.15;
      incoming.rotation.y = -0.45 + pose.incoming * 0.2;
      oldMaterials.forEach((m) => (m.opacity = pose.outOpacity));
      newMaterials.forEach((m) => (m.opacity = pose.inOpacity));
    };
    update();
    emit();
    animate(progress, {
      value: 1,
      duration: HOME_TRANSITION,
      ease: "none",
      onUpdate: update,
      onComplete: () => {
        outgoing.visible = false;
        incoming.scale.setScalar(HOME_MODEL_SCALE);
        transitioning = false;
        homeClock = 0;
      },
    });
  }
  if (mode === "login") orbitLayout();
  else if (mode === "home") homeLayout();
  const frameScale = (w, h) => mode === "workspace" ? 3.3 / Math.max(1, Math.min(w, h)) : framingScale(w, h) / (mode === "login" ? 1.12 : 1);
  function render() {
    // 正常动效由同一个 GSAP 时钟在更新所有姿态后绘制，避免隔帧追赶。
    if (!disposed && !ticking) painter.request();
  }
  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    if (!width || !height) return;
    // Bound the backing buffer when the enlarged login canvas extends past the screen.
    renderer.setPixelRatio(
      Math.min(
        devicePixelRatio || 1,
        1.5,
        Math.sqrt(3200000 / (width * height)),
      ),
    );
    Object.assign(camera, arrivalFrustum(
      width, height,
      arrival?.unitsPerPixel ?? frameScale(width, height),
      arrival?.center,
    ));
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    faceCoreLabel();
    painter.drawNow();
  }
  function tick(_time, deltaTime) {
    if (disposed || reduced || !visible || document.hidden) return;
    const dt = Math.min(deltaTime / 1000, 0.05);
    elapsed += dt;
    if (mode === "login") {
      phase += dt * 0.22;
      orbitLayout();
      core.rotation.y += dt * 0.18;
      core.position.y = 1.1 + Math.sin(elapsed * 0.9) * 0.07;
    } else if (mode === "workspace") {
      core.rotation.y += dt * .55;
      core.rotation.z = Math.sin(elapsed * .65) * .09;
    } else if (mode === "rendezvous") {
      core.rotation.y += dt * .65;
    } else if (!transitioning) {
      exhibits[active].rotation.y += dt * 0.14;
      homeClock += dt;
      if (homeClock >= HOME_DWELL) cycle();
    }
    // GSAP 的 tween 更新先完成，再提交这一帧，画布和动画进度不再差一帧。
    faceCoreLabel();
    painter.drawNow();
  }
  function schedule() {
    if (!ticking && !reduced && visible && !document.hidden) {
      ticking = true;
      gsap.ticker.add(tick);
    }
  }
  function stop() {
    gsap.ticker.remove(tick);
    ticking = false;
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersection = new IntersectionObserver((entries) => {
    const entry = entries.find(item => item.target === host);
    if (!entry) return;
    visible = entry.isIntersecting;
    animations.forEach((tween) => tween.paused(!visible || document.hidden));
    if (!visible) {
      stop();
    } else schedule();
  });
  intersection.observe(host);
  function visibility() {
    animations.forEach((t) => t.paused(document.hidden || !visible));
    if (document.hidden) {
      stop();
    } else schedule();
  }
  document.addEventListener("visibilitychange", visibility);
  function lost(event) {
    event.preventDefault();
    stop();
    onFailure();
  }
  renderer.domElement.addEventListener("webglcontextlost", lost);
  function rehost(nextHost, nextLabels) {
    host.removeEventListener("seet-capture", capture);
    host.removeEventListener("seet-workbench-capture", captureWorkbench);
    resizeObserver.unobserve(host);
    intersection.unobserve(host);
    host = nextHost;
    labels = nextLabels;
    host.appendChild(renderer.domElement);
    host.addEventListener("seet-capture", capture);
    host.addEventListener("seet-workbench-capture", captureWorkbench);
    resizeObserver.observe(host);
    intersection.observe(host);
    resize();
    emit();
  }
  function capture(event) {
    if (disposed || reduced || !event.detail.host) return;
    // Freeze the orbital instant at authentication success, not at a later React render.
    orbitLayout();
    enterHome(event.detail.sourceRect);
    transferring = true;
    transferredScene = api;
    rehost(event.detail.host, []);
    event.detail.runtime = api;
    expiry = setTimeout(() => {
      if (!adopted) api.cancel();
    }, 5000);
  }
  let workspaceMotion = null;
  const projectedCore = new THREE.Vector3();
  function screenPosition(object, point) {
    projectedCore.set(point.x / width * 2 - 1, 1 - point.y / height * 2, workspaceMotion.depth).unproject(camera);
    // 屏幕内的椭圆和沿视线的纵深构成一个真正的三维圆周。
    projectedCore.addScaledVector(viewFront, (point.depth || 0) * arrival.unitsPerPixel);
    object.position.copy(projectedCore);
  }
  const viewFront = camera.getWorldDirection(new THREE.Vector3()).negate();
  function captureWorkbench(event) {
    if (disposed || reduced || mode !== "home") return;
    animations.forEach(tween => tween.kill());
    animations.clear();
    // 允许在轮播中途点击：交接当前体积最大的可见模型，保持原有大小。
    active = exhibits.reduce((best, group, i) => group.visible && group.scale.x > exhibits[best].scale.x ? i : best, active);
    exhibits.forEach((group, i) => {
      if (i !== active && group.visible) fade(group, 0, .14);
    });
    const sourceRect = event.detail.sourceRect;
    const unitsPerPixel = framingScale(width, height);
    const projected = exhibits[active].position.clone().project(camera);
    const origin = { x: sourceRect.left + (projected.x + 1) * width / 2, y: sourceRect.top + (1 - projected.y) * height / 2 };
    const startScale = .85;
    core.scale.setScalar(startScale);
    const sphere = new THREE.Sphere();
    const exhibitRadius = new THREE.Box3().setFromObject(exhibits[active]).getBoundingSphere(sphere).radius / unitsPerPixel;
    const coreRadius = new THREE.Box3().setFromObject(core).getBoundingSphere(sphere).radius / unitsPerPixel;
    workspaceMotion = {
      origin, end: origin, depth: projected.z,
      exhibitRadius, coreRadius, gap: 36,
      startScale, endScale: startScale,
      exhibitScale: exhibits[active].scale.x,
      exhibitMaterials: [...materialsOf(exhibits[active])].map(material => ({ material, opacity: material.opacity })),
      coreMaterials: [...materialsOf(core)],
    };
    workspaceMotion.coreMaterials.forEach(material => { material.transparent = true; material.opacity = 0; });
    arrival = { unitsPerPixel, center: { x: sourceRect.left + width / 2, y: sourceRect.top + height / 2 } };
    core.visible = true;
    mode = "rendezvous";
    transferring = true;
    adopted = false;
    transitioning = true;
    rehost(event.detail.host, []);
    event.detail.runtime = api;
  }
  host.addEventListener("seet-capture", capture);
  host.addEventListener("seet-workbench-capture", captureWorkbench);
  resize();
  schedule();
  const api = {
    workspaceFrame(progress) {
      if (!workspaceMotion) return;
      const pose = workbenchOrbitFrame(progress, workspaceMotion);
      screenPosition(core, pose.core);
      screenPosition(exhibits[active], pose.exhibit);
      core.scale.setScalar(pose.coreScale);
      workspaceMotion.coreMaterials.forEach(material => { material.opacity = pose.appearance; });
      exhibits[active].scale.setScalar(Math.max(.00001, workspaceMotion.exhibitScale * pose.exhibitScale));
      exhibits[active].visible = pose.exhibitScale > .001;
      workspaceMotion.exhibitMaterials.forEach(({ material, opacity }) => { material.opacity = opacity * pose.exhibitOpacity; });
      faceCoreLabel();
      render();
      return pose.reveal;
    },
    configureCoreDestination(destination) {
      if (!workspaceMotion) return;
      workspaceMotion.end = { x: destination.left + destination.width / 2, y: destination.top + destination.height / 2 };
      workspaceMotion.endScale = arrival.unitsPerPixel / (3.3 / Math.min(destination.width, destination.height));
    },
    finishCore(nextHost) {
      if (disposed) return;
      arrival = null;
      workspaceMotion = null;
      mode = "workspace";
      exhibits.forEach(group => { group.visible = false; });
      core.position.set(0, 1.1, 0);
      core.scale.setScalar(1);
      transferring = false;
      rehost(nextHost, []);
    },
    adopt(nextHost, nextLabels, failure) {
      adopted = true;
      clearTimeout(expiry);
      homeHost = nextHost;
      homeLabels = nextLabels;
      onFailure = failure;
    },
    arrivalFrame: applyArrival,
    configureArrival(destination) {
      if (!arrival) return;
      arrival.path = {
        start: arrival.start,
        end: { x: destination.left + destination.width / 2, y: destination.top + destination.height / 2 },
        viewport: { width, height },
        startScale: arrival.startScale,
        endScale: HOME_MODEL_SCALE * arrival.unitsPerPixel / framingScale(destination.width, destination.height),
      };
      applyArrival(0);
    },
    finish(nextHost, nextLabels) {
      if (disposed) return;
      applyArrival(1);
      exhibits[active].position.set(0, 1.1, 0);
      exhibits[active].scale.setScalar(HOME_MODEL_SCALE);
      arrival = null;
      rehost(homeHost || nextHost, homeLabels || nextLabels);
      transferring = false;
      transitioning = false;
      homeClock = 0;
    },
    cancel() {
      transferring = false;
      if (transferredScene === api) transferredScene = null;
      api.dispose();
    },
    dispose() {
      if (disposed || (transferring && !adopted)) return;
      disposed = true;
      painter.dispose();
      clearTimeout(expiry);
      host.removeEventListener("seet-capture", capture);
      host.removeEventListener("seet-workbench-capture", captureWorkbench);
      stop();
      animations.forEach((t) => t.kill());
      animations.clear();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      const geometries = new Set(),
        materials = new Set(),
        textures = new Set();
      scene.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material)
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            materials.add(m);
            if (m.map) textures.add(m.map);
          }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      envTarget.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  return api;
}
