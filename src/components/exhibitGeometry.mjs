import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
export function createExhibits() {
  const materials = {
    ink: new THREE.MeshStandardMaterial({
      color: 0x17493b,
      metalness: 0.35,
      roughness: 0.22,
    }),
    paper: new THREE.MeshStandardMaterial({
      color: 0xf1f0e9,
      metalness: 0.08,
      roughness: 0.3,
    }),
    mint: new THREE.MeshStandardMaterial({
      color: 0x9fbea8,
      metalness: 0.35,
      roughness: 0.23,
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xcdb684,
      metalness: 0.85,
      roughness: 0.24,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x24342f,
      metalness: 0.65,
      roughness: 0.2,
    }),
  };
  const exhibits = [new THREE.Group(), new THREE.Group(), new THREE.Group()];

  function mesh(geometry, material, position, parent = exhibits[0]) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...position);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function box(w, h, d, material, position, parent = exhibits[0]) {
    return mesh(
      new RoundedBoxGeometry(w, h, d, 3, Math.min(0.055, h / 4, d / 4, w / 4)),
      material,
      position,
      parent,
    );
  }
  const table = new THREE.Group();
  exhibits[0].add(table);
  // A floating instrument made from data sheets, rounded columns and machined rings.
  for (let i = 0; i < 3; i++)
    box(5.5, 0.13, 3.4, i === 1 ? materials.gold : materials.paper, [
      0,
      -0.45 + i * 0.2,
      0,
    ]);
  const heights = [0.8, 1.4, 1.1, 1.9, 1.65, 2.65, 2.2];
  const towers = heights.map((h, i) => {
    const g = new THREE.Group();
    g.position.set(-2.05 + i * 0.68, 0.05, 0);
    exhibits[0].add(g);
    box(
      0.46,
      h,
      0.67,
      i === 5 ? materials.gold : materials.ink,
      [0, h / 2, 0],
      g,
    );
    box(0.34, 0.035, 0.55, materials.mint, [0, h + 0.025, 0], g);
    return g;
  });
  const report = new THREE.Group();
  report.position.set(1.95, 1.2, 1.15);
  report.rotation.set(-0.2, -0.25, -0.13);
  exhibits[0].add(report);
  box(1.25, 1.9, 0.06, materials.paper, [0, 0, 0], report);
  for (let i = 0; i < 5; i++)
    box(
      0.13,
      0.25 + i * 0.12,
      0.025,
      i === 4 ? materials.gold : materials.ink,
      [-0.4 + i * 0.2, -0.3 + i * 0.06, 0.045],
      report,
    );
  for (let i = 0; i < 3; i++)
    box(
      0.85 - i * 0.15,
      0.025,
      0.02,
      materials.mint,
      [-i * 0.07, 0.65 - i * 0.14, 0.045],
      report,
    );
  const satellite = new THREE.Group();
  satellite.position.set(-2.1, 2.65, 0.85);
  exhibits[0].add(satellite);
  mesh(
    new THREE.SphereGeometry(0.29, 32, 24),
    materials.gold,
    [0, 0, 0],
    satellite,
  );
  const orbit = mesh(
    new THREE.TorusGeometry(0.48, 0.02, 10, 80),
    materials.gold,
    [0, 0, 0],
    satellite,
  );
  orbit.rotation.x = 0.7;
  const graphNodes = [];
  for (let i = 0; i < 16; i++) {
    const t = i * 2.4,
      y = 1 - (i / 15) * 2,
      r = Math.sqrt(1 - y * y);
    const pos = new THREE.Vector3(
      Math.cos(t) * r * 2.35,
      y * 2.1 + 1.1,
      Math.sin(t) * r * 2.35,
    );
    graphNodes.push(pos);
    mesh(
      new THREE.SphereGeometry(i % 4 === 0 ? 0.22 : 0.12, 24, 16),
      i % 4 === 0 ? materials.gold : materials.ink,
      pos.toArray(),
      exhibits[1],
    );
  }
  for (let i = 0; i < 16; i++) {
    for (const j of [(i + 1) % 16, (i + 5) % 16]) {
      const curve = new THREE.LineCurve3(graphNodes[i], graphNodes[j]);
      mesh(
        new THREE.TubeGeometry(curve, 1, 0.012, 5, false),
        materials.mint,
        [0, 0, 0],
        exhibits[1],
      );
    }
  }
  mesh(
    new THREE.SphereGeometry(0.7, 48, 32),
    materials.paper,
    [0, 1.1, 0],
    exhibits[1],
  );
  for (let i = 0; i < 2; i++) {
    const ring = mesh(
      new THREE.TorusGeometry(2.7, 0.025, 10, 120),
      materials.gold,
      [0, 1.1, 0],
      exhibits[1],
    );
    ring.rotation.set(0.6 + i * 0.9, 0.5, i * 0.5);
  }
  for (let p = 0; p < 3; p++) {
    const sheet = new THREE.Group();
    sheet.position.set((p - 1) * 1.35, 0.8 + p * 0.32, -p * 0.65);
    sheet.rotation.set(-0.1, -0.25, (p - 1) * -0.12);
    exhibits[2].add(sheet);
    box(2.25, 3, 0.07, materials.paper, [0, 0, 0], sheet);
    box(1.35, 0.09, 0.03, materials.ink, [-0.15, 1.05, 0.06], sheet);
    for (let i = 0; i < 4; i++)
      box(
        1.6 - i * 0.1,
        0.025,
        0.03,
        materials.mint,
        [-i * 0.05, 0.8 - i * 0.13, 0.06],
        sheet,
      );
    for (let i = 0; i < 5; i++)
      box(
        0.23,
        0.35 + i * 0.16,
        0.06,
        i === 4 ? materials.gold : materials.ink,
        [-0.75 + i * 0.37, -0.75 + i * 0.08, 0.08],
        sheet,
      );
  }

  // Center the content inside separate motion pivots, keeping orbital math independent of model geometry.
  const pivots = exhibits.map((content) => {
    const center = new THREE.Box3()
      .setFromObject(content)
      .getCenter(new THREE.Vector3());
    content.position.sub(center);
    const pivot = new THREE.Group();
    pivot.add(content);
    return pivot;
  });
  return pivots;
}
export function createAICore() {
  const core = new THREE.Group();
  const pearl = new THREE.MeshPhysicalMaterial({
    color: 0xf0f3d9,
    metalness: 0.42,
    roughness: 0.17,
    clearcoat: 1,
    emissive: 0x769f67,
    emissiveIntensity: 0.13,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xd0bd85,
    metalness: 0.85,
    roughness: 0.2,
  });
  const center = new THREE.Mesh(new THREE.IcosahedronGeometry(0.77, 1), pearl);
  core.add(center);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.12 + i * 0.09, 0.018, 8, 100),
      gold,
    );
    ring.rotation.set(0.5 + i * 0.8, 0.3 + i * 0.45, i * 0.8);
    core.add(ring);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), gold);
    node.position.set(
      Math.cos(a) * 1.3,
      Math.sin(a * 2) * 0.3,
      Math.sin(a) * 1.3,
    );
    core.add(node);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.font = "600 80px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#204e3b";
  context.fillText("AI", 128, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
    }),
  );
  label.scale.set(0.9, 0.45, 1);
  core.add(label);
  core.position.y = 1.1;
  return core;
}
