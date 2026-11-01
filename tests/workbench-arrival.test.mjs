import test from 'node:test';
import assert from 'node:assert/strict';
import { workbenchOrbitFrame } from '../src/workbenchMotion.mjs';
const config = { origin: { x: 950, y: 440 }, end: { x: 60, y: 110 }, exhibitRadius: 350, coreRadius: 85, gap: 36, startScale: .85, endScale: .08 };
test('AI 从右侧安全距离入场，两者共享公转中心', () => {
  const start = workbenchOrbitFrame(0, config);
  assert.equal(start.exhibit.x, config.origin.x);
  assert.equal(start.exhibit.y, config.origin.y);
  assert.ok(start.core.x > start.exhibit.x);
  assert.ok(Math.hypot(start.core.x-start.exhibit.x,start.core.depth-start.exhibit.depth) >= config.exhibitRadius+config.coreRadius+config.gap);
  for (const p of [.1, .2, .3]) {
    const {core:a,exhibit:b,center:c} = workbenchOrbitFrame(p, config);
    assert.ok((a.x-c.x)*(b.x-c.x)+(a.y-c.y)*(b.y-c.y)+(a.depth-c.depth)*(b.depth-c.depth) < 0);
  }
});
test('按实际包围半径留出三维间距，公转时不穿模', () => {
  for (const exhibitRadius of [160,350,520]) for (let step=0;step<=200;step++) {
    const frame = workbenchOrbitFrame(step/200,{...config,exhibitRadius});
    if (frame.exhibitScale < .015) continue;
    const a=frame.core,b=frame.exhibit;
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.depth-b.depth) >= exhibitRadius*frame.exhibitScale+config.coreRadius*frame.coreScale/config.startScale, `radius=${exhibitRadius}, progress=${step/200}`);
  }
});
test('原模型公转中连续缩小，AI 在同一段轨迹内准确落位', () => {
  let previous=workbenchOrbitFrame(0,config);
  for(let i=1;i<=360;i++) {
    const frame=workbenchOrbitFrame(i/360,config);
    assert.ok(frame.exhibitScale<=previous.exhibitScale);
    assert.ok(frame.coreScale<=previous.coreScale);
    assert.ok(Math.hypot(frame.core.x-previous.core.x,frame.core.y-previous.core.y)<30);
    assert.ok(Math.abs(frame.coreScale-previous.coreScale)<.02);
    previous=frame;
  }
  assert.equal(workbenchOrbitFrame(.7,config).exhibitScale,0);
  assert.deepEqual(previous.core,{x:60,y:110,depth:0});
  assert.equal(previous.coreScale,.08);
});
test('切页取得目标坐标时，模型位置和大小保持连续', () => {
  assert.deepEqual(workbenchOrbitFrame(.4,{...config,end:config.origin}),workbenchOrbitFrame(.4,config));
  const a=workbenchOrbitFrame(.3999,config).core,b=workbenchOrbitFrame(.4001,config).core;
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<2);
});
