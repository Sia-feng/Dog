export function shouldPlayIdle({ available, active, hidden, paused }) {
  return Boolean(available && active && !hidden && !paused);
}

// 根据当前状态决定该播哪段视频：说话中优先播"说话"循环；其它状态播待机循环。
// talk：是否有说话视频；speaking：是否处于说话状态；idle：是否有待机视频。
export function pickVideo({ canPlay, speaking, idleAvailable, talkAvailable }) {
  if (!canPlay) return 'none';
  if (speaking && talkAvailable) return 'talk';
  if (idleAvailable) return 'idle'; // 没有说话视频时，待机视频在说话中也继续播（保持狗狗活着）
  return 'none';
}

export function attachIdleVideo(stage) {
  const idleVideo = document.querySelector('#dog-idle-video');
  const talkVideo = document.querySelector('#dog-talk-video');
  const disclosure = document.querySelector('#live-sync');
  const idleLabel = 'Seedance 生成的真实狗动作 · 固定场景循环 · 非实时生成';
  let idleAvailable = false;
  let talkAvailable = false;
  // 仍尊重系统的"减少动态效果"偏好，但不再提供手动暂停按钮。
  const paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let attempt = 0;

  const activePage = () => stage.closest('.page').classList.contains('active');

  function sync() {
    const token = ++attempt;
    const speaking = stage.dataset.state === 'speaking';
    const canPlay = shouldPlayIdle({ available: idleAvailable || talkAvailable, active: activePage(), hidden: document.hidden, paused });
    const want = pickVideo({ canPlay, speaking, idleAvailable, talkAvailable });

    // 关掉不需要的那段。
    const off = want === 'talk' ? idleVideo : want === 'idle' ? talkVideo : null;
    if (off && !off.paused) off.pause();
    if (want !== 'talk') talkVideo.hidden = true;
    if (want !== 'idle') idleVideo.hidden = true;

    if (want === 'none') {
      talkVideo.pause(); idleVideo.pause();
      stage.classList.remove('video-active');
      // 说话期间的提示文字由 live.mjs 负责（克隆/系统音色），这里不覆盖。
      if (!speaking && (idleAvailable || talkAvailable)) disclosure.textContent = '狗狗动作已暂停 · 点上方按钮让它动起来';
      return;
    }

    const video = want === 'talk' ? talkVideo : idleVideo;
    const label = () => { if (!speaking && want === 'idle') disclosure.textContent = idleLabel; };
    if (!video.paused && !video.hidden) { stage.classList.add('video-active'); label(); return; }
    video.muted = true;
    video.play().then(() => {
      if (token !== attempt) return;
      video.hidden = false; stage.classList.add('video-active'); label();
    }).catch(() => {
      if (token !== attempt) return;
      video.hidden = true; stage.classList.remove('video-active');
      disclosure.textContent = '狗狗动作视频未能自动播放 · 刷新页面重试';
    });
  }

  const onError = (video, kind) => () => {
    if (kind === 'idle') idleAvailable = false; else talkAvailable = false;
    video.pause(); video.hidden = true;
    if (!idleAvailable && !talkAvailable) stage.classList.remove('video-active');
    sync();
  };
  idleVideo.addEventListener('error', onError(idleVideo, 'idle'));
  talkVideo.addEventListener('error', onError(talkVideo, 'talk'));
  idleVideo.addEventListener('canplay', sync);
  talkVideo.addEventListener('canplay', sync);
  new MutationObserver(sync).observe(stage, { attributes: true, attributeFilter: ['data-state'] });
  new MutationObserver(sync).observe(stage.closest('.page'), { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { idleVideo.pause(); talkVideo.pause(); });

  fetch('/api/animation', { signal: AbortSignal.timeout(5000) }).then(response => response.ok ? response.json() : null).then(data => {
    if (!data) return;
    if (data.available && data.url === '/assets/shuazi-idle.mp4') { idleAvailable = true; idleVideo.src = data.url; }
    if (data.talk?.available && data.talk.url === '/assets/shuazi-talk.mp4') { talkAvailable = true; talkVideo.src = data.talk.url; }
    if (idleAvailable || talkAvailable) sync();
  }).catch(() => {});
}
