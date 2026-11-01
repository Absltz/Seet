const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t*t*t*(t*(6*t-15)+10);
};
const lerp = (a,b,t) => a+(b-a)*t;

// 两个包围球在同一倾斜轨道的相反方向公转；前后距离也参与间距计算。
// 目标位置在进度 .4 切页后测量，.44 之前路径完全不依赖目标位置。
export function workbenchOrbitFrame(progress, config) {
  const {origin,end,exhibitRadius,coreRadius,gap=36,startScale,endScale} = config;
  const t = Math.max(0,Math.min(1,progress));
  if (t===1) return { core:{...end,depth:0}, exhibit:{...end,depth:0}, center:{...end}, coreScale:endScale, exhibitScale:0, appearance:1, exhibitOpacity:0, reveal:1 };
  const migration=smooth((t-.44)/.56);
  const contract=1-migration;
  const radiusExhibit=Math.min(110,exhibitRadius*.24);
  const radiusCore=exhibitRadius+coreRadius+gap-radiusExhibit;
  // 起点向相机前方倾斜：AI 从右边缘入场，而不必先跑到屏幕外。
  // 两条基向量正交且长度为 1，因此投影压低也不牺牲真实三维间距。
  const ux=.55, uz=Math.sqrt(1-ux*ux), tilt=.18, flat=Math.sqrt(1-tilt*tilt);
  const center={x:lerp(origin.x+radiusExhibit*ux,end.x,migration),y:lerp(origin.y,end.y,migration),depth:radiusExhibit*uz*contract};
  const angle=Math.PI*2*smooth(t);
  const cosine=Math.cos(angle),sine=Math.sin(angle);
  const direction={x:ux*cosine-uz*flat*sine,y:-tilt*sine,depth:uz*cosine+ux*flat*sine};
  const position=radius=>({x:center.x+direction.x*radius*contract,y:center.y+direction.y*radius*contract,depth:center.depth+direction.depth*radius*contract});
  return {
    center, core:position(radiusCore), exhibit:position(-radiusExhibit),
    coreScale:lerp(startScale,endScale,smooth((t-.4)/.6)),
    exhibitScale:1-smooth((t-.06)/.6),
    appearance:smooth(t/.12),
    exhibitOpacity:1-smooth((t-.42)/.24),
    reveal:smooth((t-.42)/.36),
  };
}
