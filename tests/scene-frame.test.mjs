import test from "node:test";
import assert from "node:assert/strict";
import { createScenePainter } from "../src/components/sceneFrame.mjs";
test("多个材质动画更新合并成每帧一次绘制", () => {
  let next = 1,
    draws = 0,
    pose = 0,
    painted = 0;
  const queue = new Map();
  const painter = createScenePainter(
    () => {
      draws++;
      painted = pose;
    },
    {
      request: (fn) => {
        const id = next++;
        queue.set(id, fn);
        return id;
      },
      cancel: (id) => queue.delete(id),
    },
  );
  for (let i = 1; i <= 20; i++) {
    pose = i;
    painter.request();
  }
  assert.equal(queue.size, 1);
  for (const fn of [...queue.values()]) fn();
  queue.clear();
  assert.equal(draws, 1);
  assert.equal(painted, 20);
  painter.request();
  painter.drawNow();
  assert.equal(draws, 2);
  assert.equal(queue.size, 0, "画布换尺寸时立即绘制，不能留一帧空白");
  painter.request();
  painter.dispose();
  assert.equal(queue.size, 0);
  painter.request();
  assert.equal(queue.size, 0);
});
