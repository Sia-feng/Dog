import { createPhotoAvatar, mouthFromRms, mouthFromSpeech, speechText } from './avatar.mjs';
import { attachIdleVideo } from './idle-video.mjs';

export function createLiveCompanion({ ask, cancelRequest, getSample, getNickname, synthesize, teach, confirm, toast }) {
  const query = selector => document.querySelector(selector);
  const stage = query('#live-stage');
  const avatar = createPhotoAvatar(query('#dog-canvas'));
  attachIdleVideo(stage);
  const recognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  let state = 'idle';
  let recognition;
  let session = 0;
  let utterance;
  let audio;
  let audioUrl;
  let audioContext;
  let frame;
  let timer;
  let listeningTimer;
  let lastReply = '';
  let consent = false;
  let opening = 0;
  let activityStart = 0;
  let boundaryTime = null;
  let analyzer;
  let samples;
  let inConsent = false;
  let paused = false;
  let silentTalk = false;

  function setState(next, caption) {
    state = next; stage.dataset.state = next;
    const labels = { idle: '小耳朵，已就位', listening: '我在听，你慢慢说', thinking: '刷子正在想怎么回应你', speaking: '刷子正在对你说', error: '先等一小下' };
    query('#live-state').textContent = labels[next];
    query('#live-mic').setAttribute('aria-label', next === 'listening' ? '结束说话并发送' : '开始语音说话');
    query('#live-control-hint').textContent = next === 'listening' ? '说完自动发送 · 再点一下结束' : next === 'speaking' ? '点麦克风可以打断，换你说' : next === 'thinking' ? '正在等回复 · 可点击打断取消' : '点一下开始说 · 说完自动发送';
    if (caption !== undefined) query('#live-caption').textContent = caption;
  }
  function error(message) {
    stop(); setState('error');
    query('#live-error').textContent = message; query('#live-error').hidden = false;
  }
  function animate() {
    if (state !== 'speaking') return;
    let target = 0;
    if (!paused && analyzer && audio && !audio.paused) {
      analyzer.getFloatTimeDomainData(samples); target = mouthFromRms(samples);
    } else if (!paused && (utterance || silentTalk)) {
      const now = performance.now();
      target = mouthFromSpeech((now - activityStart) / 1000, true, boundaryTime === null ? null : (now - boundaryTime) / 1000);
    }
    opening += (target - opening) * .45;
    avatar.draw(opening); frame = requestAnimationFrame(animate);
  }
  function stop() {
    session += 1;
    clearTimeout(timer); clearTimeout(listeningTimer); cancelAnimationFrame(frame);
    if (recognition) {
      const previous = recognition; recognition = null;
      previous.onend = null; previous.onresult = null; previous.onerror = null;
      try { previous.abort(); } catch {}
    }
    utterance = null; window.speechSynthesis?.cancel();
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    analyzer = null; samples = null; paused = false; opening = 0; silentTalk = false;
    cancelRequest(); avatar.draw(0); setState('idle');
  }
  function clearError() { query('#live-error').hidden = true; }
  function finish(currentSession) {
    if (currentSession !== session) return;
    clearTimeout(timer); cancelAnimationFrame(frame); opening = 0; silentTalk = false; avatar.draw(0); utterance = null; setState('idle', speechText(lastReply));
  }

  // 共享的“音频 → 真实音量驱动口型”管线：克隆音色回复与原始录音试听都走这里，保证声画同步。
  async function playAnalyzed(blob, { speakingCaption, syncLabel, endedCaption, errorText }) {
    const currentSession = session;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) { error('当前浏览器不支持音频分析，无法驱动口型。'); return false; }
      audioContext = new AudioContextClass();
      await audioContext.resume();
      if (currentSession !== session) return false;
      audioUrl = URL.createObjectURL(blob); audio = new Audio(audioUrl);
      const source = audioContext.createMediaElementSource(audio);
      analyzer = audioContext.createAnalyser(); analyzer.fftSize = 512; samples = new Float32Array(analyzer.fftSize);
      source.connect(analyzer); analyzer.connect(audioContext.destination);
      audio.onended = () => { if (currentSession === session) { stop(); query('#live-caption').textContent = endedCaption; } };
      audio.onerror = () => { if (currentSession === session) error(errorText); };
      audio.onwaiting = () => { paused = true; avatar.draw(0); };
      audio.onplaying = () => { paused = false; };
      query('#live-sync').textContent = syncLabel;
      await audio.play();
      if (currentSession !== session) return false;
      setState('speaking', speakingCaption); animate();
      return true;
    } catch { if (currentSession === session) error(errorText); return false; }
  }

  // 系统免费音色：用设备自带 speechSynthesis 朗读（零成本），字词边界驱动嘴部开合；不可用时退到无声动嘴。
  function speakSystem(clean, currentSession) {
    silentTalk = false;
    utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'zh-CN'; utterance.rate = 1.05; utterance.pitch = 1.18;
    const voices = speechSynthesis.getVoices();
    const zh = voices.find(voice => voice.lang.toLowerCase().replace('_', '-').startsWith('zh'));
    if (zh) utterance.voice = zh;
    query('#live-sync').textContent = '系统免费音色 · 回应时近似口型 · 非音素级同步';
    utterance.onstart = () => {
      if (currentSession !== session) return;
      clearTimeout(timer); paused = false; activityStart = performance.now(); boundaryTime = null;
      setState('speaking'); animate();
      timer = setTimeout(() => { if (currentSession === session) finish(currentSession); }, 120000);
    };
    utterance.onboundary = event => {
      if (currentSession !== session) return;
      boundaryTime = performance.now();
      if (event.charIndex >= 0) {
        const end = Math.min(clean.length, event.charIndex + 68);
        query('#live-caption').textContent = clean.slice(event.charIndex, end);
      }
    };
    utterance.onpause = () => { paused = true; avatar.draw(0); };
    utterance.onresume = () => { paused = false; boundaryTime = null; };
    utterance.onend = () => finish(currentSession);
    utterance.onerror = event => {
      if (currentSession !== session || ['canceled', 'interrupted'].includes(event.error)) return;
      playSilentTalk(clean, currentSession);
    };
    // 系统语音迟迟不开口时，退到无声动嘴，保证"回应时嘴在动"。
    timer = setTimeout(() => { if (currentSession === session && state === 'thinking') playSilentTalk(clean, currentSession); }, 1800);
    speechSynthesis.speak(utterance);
  }

  // 语音暂未接入时的"动嘴"回应：按文字长度估算时长，用近似口型动画让小狗开合嘴部（无声）。
  function playSilentTalk(clean, currentSession) {
    if (currentSession !== session) return;
    silentTalk = true; paused = false; activityStart = performance.now(); boundaryTime = null;
    query('#live-sync').textContent = '文字陪伴 · 回应时近似口型动画 · 暂未接入语音';
    const seconds = Math.min(12, Math.max(1.8, clean.length * 0.17));
    setState('speaking', clean); animate();
    timer = setTimeout(() => finish(currentSession), seconds * 1000);
  }

  // 优先用克隆音色朗读（音频真实驱动嘴型）；未配置/失败时，回退为"动嘴但无声"的文字陪伴。
  async function speak(text) {
    stop(); clearError();
    const clean = speechText(text);
    if (!clean) return error('这条回复只有动作描写，没有可朗读的文字。');
    lastReply = text;
    query('#live-caption').textContent = clean;
    const currentSession = session;
    setState('thinking', clean);
    if (typeof synthesize === 'function') {
      try {
        const blob = await synthesize(clean);
        if (currentSession !== session) return;
        if (blob) {
          await playAnalyzed(blob, {
            speakingCaption: clean,
            syncLabel: '你的克隆音色 · 真实音量驱动口型 · 非音素级同步',
            endedCaption: speechText(lastReply),
            errorText: '克隆语音无法播放，请重试或检查浏览器音频支持。'
          });
          return;
        }
      } catch {
        if (currentSession !== session) return;
      }
    }
    if (currentSession !== session) return;
    if (window.speechSynthesis && window.SpeechSynthesisUtterance) speakSystem(clean, currentSession);
    else playSilentTalk(clean, currentSession);
  }
  async function submit(text, currentSession) {
    if (currentSession !== session) return;
    setState('thinking', `你说：${text}`);
    try {
      const reply = await ask(text);
      if (currentSession !== session || !stage.closest('.page').classList.contains('active')) return;
      if (reply) speak(reply);
    } catch (failure) {
      if (currentSession === session) error(failure.message || '没有收到回复，请再试一次。');
    }
  }
  async function listen() {
    if (inConsent) return;
    if (state === 'listening' && recognition) { recognition.stop(); return; }
    if (!recognitionClass) return error('这个浏览器不支持语音识别。可先试「刷子开口」或录音口型；真实语音输入需要支持语音识别的浏览器，或后续接入独立识别服务。');
    stop(); clearError();
    if (!consent) {
      inConsent = true;
      const allowed = await confirm('开启语音互动？', '识别可能由浏览器厂商的在线语音服务处理音频，并非保证完全本地。识别后的文字、性格和记忆在 Kimi 模式下会发送给 Kimi；原始语音不会发给 Kimi。是否继续？');
      inConsent = false;
      if (!allowed || !stage.closest('.page').classList.contains('active')) return;
      consent = true;
    }
    const currentSession = session;
    const current = new recognitionClass(); recognition = current;
    current.lang = 'zh-CN'; current.interimResults = true; current.continuous = false; current.maxAlternatives = 1;
    let finalText = '';
    let failed = false;
    current.onstart = () => { if (currentSession === session) setState('listening', '你说，我在认真听。'); };
    current.onresult = event => {
      if (currentSession !== session) return;
      let interim = ''; finalText = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript; else interim += result[0].transcript;
      }
      query('#live-caption').textContent = `你说：${finalText}${interim}`;
    };
    current.onerror = event => {
      if (currentSession !== session) return;
      failed = true;
      const reasons = { 'not-allowed': '麦克风权限未开启，或此浏览器禁止语音识别。请检查网站权限。', 'service-not-allowed': '浏览器未开放语音识别服务，请换支持语音识别的浏览器。', 'audio-capture': '找不到可用麦克风，请检查设备。', 'network': '浏览器语音识别服务连接失败。此功能依赖浏览器服务，不是 Kimi 语音识别。', 'no-speech': '没有听清楚，再点麦克风试试。', 'language-not-supported': '当前识别服务不支持中文。' };
      error(reasons[event.error] || `语音识别没有完成（${event.error}），请再试一次。`);
    };
    current.onend = () => {
      if (currentSession !== session || failed) return;
      clearTimeout(listeningTimer); recognition = null;
      if (finalText.trim()) submit(finalText.trim().slice(0, 4000), currentSession);
      else { setState('idle'); toast('没有听到完整的一句话，点麦克风再试试。'); }
    };
    try {
      setState('listening', '正在打开麦克风…'); current.start();
      listeningTimer = setTimeout(() => { if (recognition === current) current.stop(); }, 45000);
    } catch { error('语音识别无法启动，请检查浏览器和麦克风权限。'); }
  }
  async function playSample() {
    stop(); clearError();
    const sample = getSample();
    if (!sample?.blob) { toast('先到「我的声音」录制并保存样本，再来试听口型。'); return; }
    await playAnalyzed(sample.blob, {
      speakingCaption: '正在播放你保存的声音样本…',
      syncLabel: '你的原始录音 · 真实音量驱动开合 · 非音素级口型',
      endedCaption: '这是你的原始录音，不是克隆生成的新回复。',
      errorText: '这段录音无法播放，请换一个浏览器支持的音频格式。'
    });
  }
  query('#live-mic').onclick = listen;
  query('#live-stop').onclick = () => { stop(); clearError(); query('#live-caption').textContent = '好，我先停下。换你说。'; };
  const compose = query('#live-compose');
  const textInput = query('#live-text');
  function setComposer(open) {
    if (open && state !== 'idle') stop();
    stage.classList.toggle('composing', open);
    compose.hidden = !open;
    query('#live-type').setAttribute('aria-pressed', String(open));
    query('#live-type').textContent = open ? '语音' : '打字';
    query('#live-control-hint').textContent = open ? '打字告诉刷子，回车发送' : '点一下开始说 · 说完自动发送';
    if (open) { clearError(); textInput.focus(); } else textInput.blur();
  }
  query('#live-type').onclick = () => setComposer(compose.hidden);
  compose.onsubmit = event => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    if (state === 'thinking' || state === 'speaking') stop();
    textInput.value = '';
    submit(text.slice(0, 4000), session);
  };
  query('#live-greeting').onclick = () => speak(`${getNickname()}，我是刷子。今天不用很厉害，把不开心的事放一放，我陪着你呢。`);
  query('#live-replay').onclick = () => lastReply ? speak(lastReply) : toast('还没有上一句，可以先试试「刷子开口」。');
  query('#live-sample').onclick = playSample;
  query('#live-feedback').onclick = () => { stop(); teach(lastReply); };
  query('#live-subtitles').onclick = () => {
    const hidden = stage.classList.toggle('subtitles-off');
    query('#live-subtitles').textContent = hidden ? '字幕关' : '字幕开'; query('#live-subtitles').setAttribute('aria-pressed', String(!hidden));
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  setComposer(true); // 聊天页默认打字模式
  return { stop, speak, setLastReply(text) { lastReply = text || ''; }, reset() { stop(); lastReply = ''; consent = false; setComposer(true); query('#live-caption').textContent = '打字跟我说，或点麦克风。我听着呢。'; } };
}
