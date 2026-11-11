export function mouthFromRms(samples) {
  if (!samples?.length) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / samples.length);
  return Math.max(0, Math.min(1, (rms - .012) * 6));
}

export function mouthFromSpeech(seconds, active, boundaryAge = null) {
  if (!active) return 0;
  const pulse = Math.pow(Math.max(0, Math.sin(seconds * Math.PI * 7.8)), .7);
  const variation = .6 + .4 * Math.sin(seconds * 3.7) ** 2;
  const onset = boundaryAge === null ? 1 : Math.max(.18, Math.exp(-Math.max(0, boundaryAge) * 3));
  return Math.min(1, (.08 + pulse * .85) * variation * onset);
}

export function speechText(text) {
  return String(text).replace(/（[^）]*）|\([^)]*\)|\*[^*]*\*/g, '').replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

export function createPhotoAvatar(canvas) {
  const context = canvas.getContext('2d');
  const image = new Image();
  // 嘴部形变区域，坐标在 780x1236 画布空间里标定（对准当前 shuazi.png 的嘴）。
  const MX = 265, MW = 270, MTOP = 300, MBOT = 470; // 采样框 x/宽/上/下
  const LIP = 372, BAND = 72;                        // 唇线与可开合的带高
  const MH = MBOT - MTOP;
  const patch = document.createElement('canvas');
  patch.width = MW; patch.height = MH;
  const patchContext = patch.getContext('2d');
  const mask = document.createElement('canvas');
  mask.width = MW; mask.height = MH;
  const maskContext = mask.getContext('2d');
  const fade = maskContext.createRadialGradient(134, 100, 55, 134, 100, 130);
  fade.addColorStop(0, '#000'); fade.addColorStop(1, '#0000');
  maskContext.fillStyle = fade; maskContext.fillRect(0, 0, MW, MH);
  // 采样用图片原始像素，绘制用画布坐标：按真实尺寸换算，换图也不会错位。
  let ix = 430 / 780, iy = 765 / 1236;
  let ready = false;
  let lastOpen = -1;
  function draw(open = 0) {
    if (!ready || Math.abs(open - lastOpen) < .008) return;
    lastOpen = open;
    context.drawImage(image, 0, 0, 780, 1236);
    patchContext.clearRect(0, 0, MW, MH);
    const factor = .22 + Math.max(0, Math.min(1, open)) * .94;
    const warp = cy => {
      if (cy < LIP) return cy;
      if (cy < LIP + BAND) return LIP + (cy - LIP) * factor;
      const fadeBack = Math.max(0, (MBOT - cy) / (MBOT - (LIP + BAND)));
      return cy - (1 - factor) * BAND * fadeBack;
    };
    for (let cy = MTOP; cy < MBOT; cy += 2) {
      const top = warp(cy) - MTOP;
      const height = Math.max(.7, warp(cy + 2) - warp(cy) + .5);
      patchContext.drawImage(image, MX * ix, cy * iy, MW * ix, 2 * iy, 0, top, MW, height);
    }
    patchContext.globalCompositeOperation = 'destination-in';
    patchContext.drawImage(mask, 0, 0);
    patchContext.globalCompositeOperation = 'source-over';
    context.drawImage(patch, MX, MTOP);
  }
  image.onload = () => {
    if (image.naturalWidth && image.naturalHeight) { ix = image.naturalWidth / 780; iy = image.naturalHeight / 1236; }
    ready = true; draw(0);
  };
  image.onerror = () => canvas.setAttribute('aria-label', '刷子照片加载失败，请刷新页面');
  image.src = new URL('./assets/shuazi.png', import.meta.url).href;
  return { draw };
}

