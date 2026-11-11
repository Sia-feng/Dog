export function shouldPlayIdle({ available, active, hidden, paused }) {
  return Boolean(available && active && !hidden && !paused);
}

export function attachIdleVideo(stage) {
  const video = document.querySelector('#dog-idle-video');
  const button = document.querySelector('#idle-toggle');
  const disclosure = document.querySelector('#live-sync');
  const idleLabel = 'Seedance 生成的真实狗动作 · 固定场景循环 · 非实时生成';
  let available = false;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let attempt = 0;
  let wasPlaying = false;
  function sync() {
    // 狗狗在说话时也保持活动；说话期间的提示文字由 live.mjs 负责（克隆/系统音色），这里不覆盖。
    const speaking = stage.dataset.state === 'speaking';
    const play = shouldPlayIdle({ available, active: stage.closest('.page').classList.contains('active'), hidden: document.hidden, paused });
    button.textContent = paused ? '让狗狗动起来' : '暂停狗狗动作';
    button.setAttribute('aria-pressed', String(paused));
    const token = ++attempt;
    if (!play) {
      video.pause(); video.hidden = true; stage.classList.remove('video-active'); wasPlaying = false;
      if (available && !speaking) disclosure.textContent = '狗狗动作已暂停 · 点上方按钮让它动起来';
      return;
    }
    if (wasPlaying && !video.paused) { if (!speaking) disclosure.textContent = idleLabel; return; }
    video.muted = true;
    video.play().then(() => {
      if (token !== attempt) return;
      wasPlaying = true; video.hidden = false; stage.classList.add('video-active');
      if (!speaking) disclosure.textContent = idleLabel;
    }).catch(() => {
      if (token !== attempt) return;
      paused = true; wasPlaying = false; video.hidden = true; stage.classList.remove('video-active');
      button.textContent = '点击让狗狗动起来'; button.setAttribute('aria-pressed', 'true');
      disclosure.textContent = '狗狗动作视频未能自动播放 · 点击上方按钮重试';
    });
  }
  button.onclick = () => { paused = !paused; sync(); };
  video.addEventListener('error', () => {
    available = false; button.hidden = true; video.pause(); video.hidden = true; stage.classList.remove('video-active');
    disclosure.textContent = '狗狗动作视频加载失败 · 已回退到照片';
  });
  video.addEventListener('canplay', sync);
  new MutationObserver(sync).observe(stage, { attributes: true, attributeFilter: ['data-state'] });
  new MutationObserver(sync).observe(stage.closest('.page'), { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => video.pause());
  fetch('/api/animation', { signal: AbortSignal.timeout(5000) }).then(response => response.ok ? response.json() : null).then(data => {
    if (!data?.available || data.url !== '/assets/shuazi-idle.mp4') return;
    available = true; button.hidden = false; video.src = data.url; sync();
  }).catch(() => {});
}
