import test from "node:test";
import assert from "node:assert/strict";
import {
  orbitPose,
  frontExhibit,
  nextExhibit,
} from "../src/components/exhibitMotion.mjs";
test("最近模型判断使用真实相机的观察方向", () => {
  for (let phase = -8; phase < 8; phase += 0.037) {
    const poses = [0, 1, 2].map((i) => orbitPose(i, phase));
    const depths = poses.map((p) => p.x * 8 + p.z * 10);
    assert.ok(depths[frontExhibit(phase)] >= Math.max(...depths) - 1e-9);
  }
});

test("登录优先交接靠近轨道右前方四分之一区域的模型", async () => {
  const { frontRightExhibit } = await import("../src/components/exhibitMotion.mjs");
  assert.equal(typeof frontRightExhibit, "function", "右前方交接不应只按最大深度选择");
  // phase=0 时，0 号在右边，1 号虽然更靠前但已在左侧。
  assert.equal(frontRightExhibit(0), 0);
  assert.equal(frontExhibit(0), 1);
  for (let index = 0; index < 3; index++) {
    const phase = Math.PI / 4 - index * Math.PI * 2 / 3;
    assert.equal(frontRightExhibit(phase), index);
  }
});

test("右前方交接在整圈与跨周转动时保持正确，距离相同时选更靠前者", async () => {
  const { frontRightExhibit } = await import("../src/components/exhibitMotion.mjs");
  assert.equal(typeof frontRightExhibit, "function");
  for (let phase = -12; phase < 12; phase += 0.037) {
    // 相机水平右向 (10, -8)，前向 (8, 10)，分别按轨道半径归一化。
    const scores = [0, 1, 2].map(index => {
      const pose = orbitPose(index, phase);
      return (pose.x * 10 - pose.z * 8) / (Math.sqrt(164) * 3.7)
        + (pose.x * 8 + pose.z * 10) / (Math.sqrt(164) * 3.25);
    });
    const chosen = frontRightExhibit(phase);
    assert.ok(scores[chosen] >= Math.max(...scores) - 1e-9);
    assert.equal(chosen, frontRightExhibit(phase + Math.PI * 2));
  }
  assert.equal(frontRightExhibit(Math.PI / 4 + Math.PI / 3), 0);
});
test("三个模型保持轨道间距并完整轮换", () => {
  for (let phase = 0; phase < 7; phase += 0.13) {
    const p = [0, 1, 2].map((i) => orbitPose(i, phase));
    for (let i = 0; i < 3; i++)
      assert.ok(
        Math.hypot(p[i].x - p[(i + 1) % 3].x, p[i].z - p[(i + 1) % 3].z) > 5,
      );
    assert.equal(frontExhibit(phase), frontExhibit(phase + Math.PI * 2));
  }
  assert.deepEqual([0, 1, 2].map(nextExhibit), [1, 2, 0]);
});

test("模型轮换先缩小退场再放大入场，结束恢复常态大尺寸", async () => {
  const { carouselFrame, HOME_MODEL_SCALE } =
    await import("../src/components/exhibitMotion.mjs");
  const first = carouselFrame(0),
    last = carouselFrame(1);
  assert.equal(first.outScale, HOME_MODEL_SCALE);
  assert.equal(first.inScale, 0);
  assert.equal(last.outScale, 0);
  assert.equal(last.inScale, HOME_MODEL_SCALE);
  let previous = first;
  for (let step = 1; step <= 1000; step++) {
    const frame = carouselFrame(step / 1000);
    assert.ok(frame.outScale <= previous.outScale + 1e-9);
    assert.ok(frame.inScale >= previous.inScale - 1e-9);
    assert.ok(
      !(
        frame.outScale > HOME_MODEL_SCALE * 0.65 &&
        frame.inScale > HOME_MODEL_SCALE * 0.65
      ),
      "不能再让两组完整模型重影交叉",
    );
    previous = frame;
  }
});
