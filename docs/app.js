import { defaultPersona, normalizePersona, normalizeMemories, demoReply } from './logic.mjs';
import { createLiveCompanion } from './live.mjs';

const select = selector => document.querySelector(selector);
const selectAll = selector => [...document.querySelectorAll(selector)];
const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2A8.5 8.5 0 0 1 21 11.5Z"/><path d="M7 10h10M7 14h6"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  sliders: '<path d="M4 6h8m4 0h4M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  book: '<path d="M12 5C9 2 5 2 2 3v17c3-1 7-1 10 2 3-3 7-3 10-2V3c-3-1-7-1-10 2Zm0 0v17M6 7l2 1M6 11l2 1m8-4 2-1m-2 5 2-1"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  wave: '<path d="M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4"/>',
  paw: '<ellipse cx="7" cy="6" rx="2" ry="3" transform="rotate(-20 7 6)"/><ellipse cx="16" cy="6" rx="2" ry="3" transform="rotate(20 16 6)"/><ellipse cx="3" cy="12" rx="1.7" ry="2.5" transform="rotate(-25 3 12)"/><ellipse cx="21" cy="12" rx="1.7" ry="2.5" transform="rotate(25 21 12)"/><path d="M5 20c-2-4 4-10 7-10s9 6 7 10c-1 2-5 0-7 0s-6 2-7 0Z"/>',
  speaker: '<path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.paw}</svg>`; }
selectAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });

function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`shuazi.${key}`)) ?? fallback; }
  catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(`shuazi.${key}`, JSON.stringify(value)); return true; }
  catch { toast('浏览器存储不可用或已满，这次修改可能无法保留。'); return false; }
}
let persona = normalizePersona(readStored('persona', defaultPersona));
let memories = normalizeMemories(readStored('memories', []));
const savedMessages = readStored('messages', []);
let messages = Array.isArray(savedMessages) ? savedMessages.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.length <= 4000).slice(-60) : [];
let mode = readStored('mode', null);
let voicePack = readStored('voicePack', 'system');
let configured = false;
let busy = false;
let requestController;
let generation = 0;
let draftStyle = persona.style;
let feedbackTarget;
let toastTimer;
let recorder;
let micStream;
let recordingTimer;
let recordingStart;
let discardRecording = false;
let sampleUrl;
let sample;
let audioDatabase;
let recordingPending = false;
let live;
const pageNames = { home: '小窝', chat: '聊聊天', voice: '我的声音', persona: '性格调教', memories: '小狗日记' };
const cloneText = '刷子，今天也要开开心心的呀。不管外面的世界多忙，回到这里，我们就慢慢说话。我会陪着你，你也陪着我。';

function toast(text) {
  clearTimeout(toastTimer);
  select('#toast').textContent = text;
  select('#toast').hidden = false;
  toastTimer = setTimeout(() => { select('#toast').hidden = true; }, 3500);
}
function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function go(page) {
  if (!pageNames[page]) page = 'chat';
  if (page !== 'chat') live?.stop();
  if (page === 'chat' && recorder?.state === 'recording') stopRecording();
  document.body.classList.toggle('live-mode', page === 'chat');
  selectAll('.page').forEach(section => section.classList.toggle('active', section.id === `page-${page}`));
  selectAll('[data-page]').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  select('#page-title').textContent = pageNames[page];
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  if (page === 'persona') fillPersona();
  if (page === 'chat') renderMessages();
  window.scrollTo({ top: 0 });
}
function showMode() {
  const real = mode === 'kimi' && configured;
  select('#connection').replaceChildren(element('i'), document.createTextNode(real ? 'Kimi 对话模式' : '演示模式'));
  select('#chat-mode').textContent = real ? 'Kimi 对话 · 系统语音' : '预设演示 · 系统语音';
  select('#kimi-toggle').checked = real;
  select('#kimi-toggle').disabled = !configured || busy;
}
async function status() {
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    const data = await response.json();
    configured = data.configured;
    if (!mode) mode = configured ? 'kimi' : 'demo';
    if (!configured) mode = 'demo';
    select('#backend-status').textContent = configured ? `后端已配置密钥 · ${data.model}（是否可用以实际请求为准）` : '未配置 Kimi 密钥 · 当前可体验本地演示';
    const packs = data.packs || {};
    for (const option of select('#voice-pack').options) {
      const info = packs[option.value];
      option.disabled = info ? !info.ready : false;
      if (info) option.textContent = `${info.label}${option.value === (data.defaultPack || 'playful') ? '（默认）' : ''}${info.ready ? '' : ' · 未就绪'}`;
    }
    if (packs[voicePack] && !packs[voicePack].ready && packs[data.defaultPack]?.ready) { voicePack = data.defaultPack; store('voicePack', voicePack); }
    select('#voice-pack').value = voicePack;
  } catch {
    mode = 'demo';
    select('#backend-status').textContent = '后端未连接，当前使用本地演示。请用启动脚本打开。';
  }
  showMode();
}
function syncPersona() {
  select('#home-nickname').textContent = persona.nickname;
  select('#persona-summary').textContent = `${persona.style} · ${persona.clingy >= 65 ? '黏人小狗' : '自在小狗'}`;
  select('#chat-persona-tag').textContent = persona.style;
  for (const trait of ['warmth', 'playful', 'clingy']) {
    select(`#meter-${trait}`).value = persona[trait];
    select(`#value-${trait}`).textContent = persona[trait];
  }
  renderFeedback();
}
function fillPersona() {
  draftStyle = persona.style;
  select('#nickname').value = persona.nickname;
  select('#instructions').value = persona.instructions;
  for (const trait of ['warmth', 'playful', 'clingy']) {
    select(`#${trait}`).value = persona[trait];
    select(`#${trait}-output`).textContent = persona[trait];
  }
  updatePersonaPreview();
}
function updatePersonaPreview() {
  selectAll('[data-style]').forEach(button => {
    const chosen = button.dataset.style === draftStyle;
    button.classList.toggle('selected', chosen);
    button.setAttribute('aria-pressed', String(chosen));
  });
  select('#preview-style').textContent = draftStyle;
  const nickname = select('#nickname').value.trim() || '主人';
  const previews = {
    '毒舌机智': `就这点事也值得慌？坐下，${nickname}，我两句给你捋明白。`,
    '温柔治愈': `${nickname}，今天不用很厉害，我陪着你就好。`,
    '调皮话痨': `${nickname}，小耳朵已就位！今天有什么八卦，先讲给我听？`,
    '傲娇可爱': `才不是特意等${nickname}的呢……好吧，留了最软的位置给你。`,
    '安静陪伴': `${nickname}，我在。你慢慢说。`
  };
  select('#persona-preview').textContent = `“${previews[draftStyle]}”`;
}
function renderFeedback() {
  const list = select('#feedback-list');
  list.replaceChildren();
  if (!persona.corrections.length) list.append(element('p', 'microcopy', '还没有特别交代的小事，慢慢教我就好。'));
  persona.corrections.forEach((feedback, index) => {
    const row = element('div', 'feedback-item');
    const button = element('button', '', '×');
    button.type = 'button';
    button.setAttribute('aria-label', `删除偏好 ${index + 1}`);
    button.onclick = async () => {
      if (!await confirmAction('忘掉这条偏好？', '删除后，下一次对话不再携带这条偏好。')) return;
      persona.corrections.splice(index, 1); store('persona', persona); renderFeedback();
    };
    row.append(element('p', '', feedback), button); list.append(row);
  });
}
function renderMemories() {
  const list = select('#memory-list'); list.replaceChildren();
  select('#memory-count').textContent = `${memories.length} / 20 条`;
  const memorySummary = select('#memory-summary');
  if (memorySummary) memorySummary.textContent = memories.length ? `已经珍藏了 ${memories.length} 件关于你的小事。` : '那些在意的小事，都值得记住。';
  if (!memories.length) {
    const empty = element('div', 'memory-empty');
    const art = element('div'); art.innerHTML = icon('book');
    empty.append(art, element('p', '', '小本本还空着，故事慢慢写。'), element('small', '', '不会偷偷记住你的话，由你决定留下什么。')); list.append(empty);
  }
  memories.forEach((memory, index) => {
    const note = element('article', 'memory-note');
    const button = element('button', '', '×');
    button.setAttribute('aria-label', `删除记忆 ${index + 1}`);
    button.onclick = async () => {
      if (!await confirmAction('忘掉这件小事？', '将从小本本删除这条记忆。已经写进历史聊天的内容不会同时删除。')) return;
      memories.splice(index, 1); store('memories', memories); renderMemories(); toast('这件小事，已经从本本里删掉。');
    };
    note.append(element('div', 'eyebrow', `MEMORY ${String(index + 1).padStart(2, '0')}`), element('p', '', memory), button); list.append(note);
  });
}
function renderMessages() {
  live?.setLastReply(messages.findLast(message => message.role === 'assistant')?.content || '');
}
function cancelConversation() {
  if (!busy) return;
  generation += 1;
  requestController?.abort();
  busy = false;
  showMode();
}
async function sendMessage(content) {
  content = typeof content === 'string' ? content.trim() : '';
  if (!content || busy) return;
  if (content.length > 4000) throw new Error('这句话有点长，请控制在 4000 字以内。');
  const thisGeneration = generation;
  const currentMode = mode === 'kimi' && configured ? 'kimi' : 'demo';
  const userMessage = { role: 'user', content };
  const context = [...messages, userMessage].slice(-20).map(({ role, content }) => ({ role, content }));
  busy = true; showMode();
  const controller = new AbortController(); requestController = controller;
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    let answer;
    if (currentMode === 'demo') {
      answer = { reply: demoReply(content, persona, memories), mode: 'demo' };
    } else {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ mode: currentMode, messages: context, persona, memories }) });
      answer = await response.json();
      if (!response.ok) throw new Error(answer.error || '请求没有完成，请重试。');
      if (typeof answer.reply !== 'string' || !answer.reply.trim()) throw new Error('回复为空，请重新说一次。');
    }
    if (thisGeneration !== generation) return;
    messages.push(userMessage, { role: 'assistant', content: answer.reply, mode: answer.mode });
    messages = messages.slice(-60); store('messages', messages);
    return answer.reply;
  } catch (error) {
    if (thisGeneration !== generation) return;
    throw new Error(error.name === 'AbortError' ? 'Kimi 回复超时，请重新说一次。' : error.message);
  } finally {
    clearTimeout(timer);
    if (thisGeneration === generation) { busy = false; showMode(); }
  }
}
function confirmAction(title, text) {
  select('#confirm-title').textContent = title; select('#confirm-text').textContent = text;
  const dialog = select('#confirm-dialog'); dialog.showModal();
  return new Promise(resolve => {
    const finish = result => { dialog.close(); resolve(result); };
    select('#confirm-cancel').onclick = () => finish(false);
    select('#confirm-ok').onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); finish(false); };
  });
}
async function openAudioDatabase() {
  if (audioDatabase) return audioDatabase;
  audioDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open('shuazi-voice', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('samples');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return audioDatabase;
}
async function audioOperation(operation, value) {
  const database = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('samples', operation === 'get' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('samples');
    const request = operation === 'get' ? store.get('voice') : operation === 'delete' ? store.delete('voice') : store.put(value, 'voice');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('存储已中断'));
  });
}
function renderSample() {
  if (sampleUrl) URL.revokeObjectURL(sampleUrl);
  const player = select('#audio-player'); player.pause(); player.removeAttribute('src');
  select('#sample-empty').hidden = Boolean(sample);
  select('#sample-player').hidden = !sample;
  if (!sample) { player.load(); return; }
  sampleUrl = URL.createObjectURL(sample.blob); player.src = sampleUrl;
  select('#sample-info').textContent = `${sample.duration ? `${sample.duration} 秒 · ` : ''}${Math.max(1, Math.round(sample.blob.size / 1024))} KB · 仅保存在此浏览器`;
  select('#download-audio').href = sampleUrl;
  const format = sample.blob.type.includes('mp4') ? 'm4a' : sample.blob.type.includes('mpeg') ? 'mp3' : sample.blob.type.includes('wav') ? 'wav' : sample.blob.type.includes('ogg') ? 'ogg' : 'webm';
  select('#download-audio').download = `shuazi-voice.${format}`;
}
async function saveSample(nextSample) {
  await audioOperation('put', nextSample); sample = nextSample; renderSample(); toast('声音样本已保存，可试听。尚未生成克隆音色。');
}
function recordingUI(recording) {
  select('#waveform').classList.toggle('recording', recording);
  select('#record-title').textContent = recording ? '慢慢说，我在认真听。' : '你好，这是我的声音。';
  select('#record-button').innerHTML = recording ? '■ 停止并保存' : `${icon('mic')} 开始录音`;
  select('#audio-upload').disabled = recording;
  select('#delete-audio').disabled = recording;
  select('#voice-consent').disabled = recording;
}
function releaseMic() {
  clearInterval(recordingTimer);
  micStream?.getTracks().forEach(track => track.stop()); micStream = undefined;
  recordingUI(false);
}
function stopRecording() {
  if (recorder?.state === 'recording') recorder.stop();
  releaseMic();
}
async function record() {
  if (recorder?.state === 'recording') return stopRecording();
  if (recordingPending) return;
  if (!select('#voice-consent').checked) return toast('请先确认这是你本人或已获授权的声音。');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('录音需要支持麦克风的浏览器及 localhost / HTTPS，也可以选择已有录音。');
  if (sample && !await confirmAction('替换声音样本？', '录制并成功保存后，将替换旧样本；你可以先下载备份。')) return;
  select('#record-error').hidden = true; recordingPending = true; select('#record-button').disabled = true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);
    const chunks = []; discardRecording = false;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { discardRecording = true; stopRecording(); toast('录音遇到问题，未覆盖已有样本。'); };
    recorder.onstop = async () => {
      if (discardRecording) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (!blob.size) return toast('没有捕获到声音，请检查麦克风后重试。');
      try { await saveSample({ blob, duration: Math.max(1, Math.round((Date.now() - recordingStart) / 1000)), created: Date.now() }); }
      catch { toast('声音保存失败，请检查浏览器存储空间后重录。'); }
    };
    recorder.start(); recordingStart = Date.now(); recordingUI(true);
    select('#record-time').textContent = '00:00 / 01:00';
    recordingTimer = setInterval(() => {
      const elapsed = Math.min(60, Math.floor((Date.now() - recordingStart) / 1000));
      select('#record-time').textContent = `${elapsed === 60 ? '01:00' : `00:${String(elapsed).padStart(2, '0')}`} / 01:00`;
      if (elapsed >= 60) stopRecording();
    }, 250);
  } catch (error) {
    releaseMic();
    select('#record-error').textContent = error.name === 'NotAllowedError' ? '麦克风权限未开启。请在浏览器地址栏允许麦克风，或选择已有录音。' : '无法使用麦克风，请检查设备是否被占用，或选择已有录音。';
    select('#record-error').hidden = false;
  } finally { recordingPending = false; select('#record-button').disabled = false; }
}

// 文本 → 当前音色包的音频；system=设备免费语音(前端处理,返回null让 live 用系统语音)；后端未配置(503)也返回 null。
async function synthesize(text) {
  if (voicePack === 'system') return null;
  const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, pack: voicePack }), signal: AbortSignal.timeout(30000) });
  if (response.status === 503) return null;
  if (!response.ok) { let message = '克隆语音暂不可用。'; try { message = (await response.json()).error || message; } catch {} throw new Error(message); }
  const blob = await response.blob();
  if (!blob.size) throw new Error('克隆语音返回为空。');
  return blob;
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('读取录音失败。'));
    reader.readAsDataURL(blob);
  });
}
function cloneFormat(type) {
  return type.includes('wav') ? 'wav' : type.includes('mpeg') ? 'mp3' : type.includes('mp4') ? 'm4a' : type.includes('aac') ? 'aac' : type.includes('ogg') ? 'ogg' : type.includes('webm') ? 'webm' : 'wav';
}
async function cloneVoice() {
  if (!sample?.blob) return toast('请先录制或上传一段声音样本。');
  if (!select('#voice-consent').checked) return toast('请先确认这是你本人或已获授权的声音。');
  if (!await confirmAction('用这段录音克隆你的声音？', '录音会上传到火山引擎声音复刻服务用于训练你的专属音色。这是不可逆的云端处理，仅在你已获本人授权时继续。')) return;
  select('#clone-button').disabled = true; select('#clone-status').textContent = '正在上传并提交训练…';
  try {
    const audio = await blobToBase64(sample.blob);
    const response = await fetch('/api/voice/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio, format: cloneFormat(sample.blob.type), text: cloneText }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '训练提交失败。');
    select('#clone-status').textContent = '已提交训练，音色通常需要一两分钟。稍后点「检查训练状态」。';
    toast('已提交声音克隆训练。');
  } catch (error) { select('#clone-status').textContent = error.message; }
  finally { select('#clone-button').disabled = false; }
}
async function refreshVoice() {
  select('#clone-status').textContent = '正在查询音色状态…';
  try {
    const response = await fetch('/api/voice/status', { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!data.configured) return select('#clone-status').textContent = '后端尚未配置火山引擎声音复刻密钥，聊天将使用系统音色。';
    if (data.error) return select('#clone-status').textContent = data.error;
    select('#clone-status').textContent = data.ready ? '你的专属音色已就绪，聊天时刷子会用你的声音说话。' : `音色状态：${data.label || '训练中'}。`;
  } catch { select('#clone-status').textContent = '查询失败，请确认后端已启动。'; }
}

selectAll('[data-page]').forEach(button => { button.onclick = () => go(button.dataset.page); });selectAll('[data-action]').forEach(button => { button.onclick = async () => {
  const action = button.dataset.action;
  if (action.startsWith('go-')) return go(action.slice(3));
  if (action === 'settings') return select('#settings-dialog').showModal();
  if (action === 'clear-chat') {
    live?.stop();
    if (await confirmAction('清空这段对话？', '只清除本机聊天记录，不会删除性格、偏好、记忆或录音。')) { messages = []; store('messages', messages); live?.reset(); }
  }
}; });
selectAll('[data-close]').forEach(button => { button.onclick = () => select(`#${button.dataset.close}`).close(); });
selectAll('[data-prompt]').forEach(button => { button.onclick = async () => { go('chat'); live?.stop(); try { const reply = await sendMessage(button.dataset.prompt); if (reply && document.body.classList.contains('live-mode')) live?.speak(reply); } catch (error) { toast(error.message); } }; });
selectAll('[data-mood]').forEach(button => { button.onclick = () => {
  selectAll('[data-mood]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  const responses = { '晴朗': '你的快乐，分一小口给刷子好不好？', '平静': '平平淡淡的日子，也很值得喜欢。', '低落': '不急着开心，我先安静陪你一会儿。', '疲惫': '今天已经很努力了，先歇一歇吧。' };
  select('#mood-response').textContent = responses[button.dataset.mood];
}; });
select('#kimi-toggle').onchange = event => { mode = event.target.checked && configured ? 'kimi' : 'demo'; store('mode', mode); showMode(); toast(mode === 'kimi' ? '已开启 Kimi：文字、性格和记忆将随聊天发送。' : '已切换本地预设演示，不会请求 Kimi。'); };
selectAll('[data-style]').forEach(button => { button.onclick = () => { draftStyle = button.dataset.style; updatePersonaPreview(); }; });
select('#nickname').oninput = updatePersonaPreview;
for (const trait of ['warmth', 'playful', 'clingy']) select(`#${trait}`).oninput = event => { select(`#${trait}-output`).textContent = event.target.value; };
select('#persona-form').onsubmit = event => {
  event.preventDefault();
  persona = normalizePersona({ ...persona, nickname: select('#nickname').value, style: draftStyle, warmth: select('#warmth').value, playful: select('#playful').value, clingy: select('#clingy').value, instructions: select('#instructions').value });
  store('persona', persona); syncPersona(); toast('性格已保存，下一条 Kimi 回复开始使用新设定。');
};
select('#feedback-form').onsubmit = event => {
  event.preventDefault(); const preference = select('#feedback-input').value.trim(); if (!preference) return;
  persona.corrections = [...persona.corrections, `针对“${(feedbackTarget || '').slice(0, 70)}”的表达，用户希望：${preference}`.slice(0, 300)].slice(-8);
  store('persona', persona); renderFeedback(); select('#feedback-dialog').close(); toast('记住这个偏好了，下一次 Kimi 回复会带上它。');
};
select('#memory-form').onsubmit = event => {
  event.preventDefault(); const text = select('#memory-input').value.trim(); if (!text) return;
  if (memories.length >= 20) return toast('小本本最多保留 20 条，请先删去一条。');
  if (memories.includes(text)) return toast('这件事已经记在本本里啦。');
  memories.push(text); store('memories', memories); select('#memory-input').value = ''; renderMemories(); toast('记下啦。你随时可以让我忘掉。');
};
select('#record-button').onclick = record;
select('#clone-button').onclick = cloneVoice;
select('#clone-refresh').onclick = refreshVoice;
select('#voice-pack').value = voicePack;
select('#voice-pack').onchange = event => {
  voicePack = event.target.value; store('voicePack', voicePack);
  live?.setLastReply(messages.findLast(message => message.role === 'assistant')?.content || '');
  toast(voicePack === 'clone' ? '已切到你的克隆音色（需已完成训练）。' : voicePack === 'playful' ? '已切到调皮小鬼（需配置火山语音）。' : '已切到系统免费音色，立即可用。');
};
select('#audio-upload').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (!select('#voice-consent').checked) return toast('请先确认这是你本人或已获授权的声音。');
  if (file.size > 15 * 1024 * 1024 || !file.size) return toast('请选择非空且不超过 15 MB 的录音文件。');
  if (!file.type.startsWith('audio/')) return toast('请选择浏览器可识别的音频文件，如 MP3、WAV 或 M4A。');
  if (sample && !await confirmAction('替换声音样本？', '新录音成功保存后会替换旧样本，请先下载需要保留的录音。')) return;
  try { await saveSample({ blob: file, created: Date.now() }); }
  catch { toast('声音保存失败，请检查浏览器存储空间。'); }
};
select('#delete-audio').onclick = async () => {
  if (!await confirmAction('删除声音样本？', '这段录音将从当前浏览器中移除，此操作不能撤销。')) return;
  try { await audioOperation('delete'); sample = null; renderSample(); toast('声音样本已删除。'); }
  catch { toast('删除失败，请检查浏览器存储权限后重试。'); }
};
select('#reset-data').onclick = async () => {
  if (busy || recordingPending || recorder?.state === 'recording') return toast('请先结束对话请求或录音，再清除数据。');
  if (!await confirmAction('清除全部个人数据？', '将删除当前浏览器的聊天、性格、调教偏好、记忆和录音。后端密钥不会被删除，已发给 Kimi 的数据无法从这里撤回。')) return;
  try {
    await audioOperation('delete');
    for (const key of ['persona', 'memories', 'messages', 'mode']) localStorage.removeItem(`shuazi.${key}`);
    generation += 1; requestController?.abort(); window.speechSynthesis?.cancel();
    persona = normalizePersona(defaultPersona); memories = []; messages = []; mode = 'demo'; store('mode', mode); sample = null;
    live?.reset(); select('#memory-input').value = ''; select('#feedback-input').value = ''; select('#voice-consent').checked = false;
    renderSample(); syncPersona(); fillPersona(); renderMemories(); renderMessages(); showMode(); select('#settings-dialog').close(); go('home'); toast('本机个人数据已清除，已切换本地演示。');
  } catch { toast('部分数据可能未清除，请使用浏览器的网站数据设置检查。'); }
};
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
window.addEventListener('pagehide', () => { discardRecording = true; stopRecording(); requestController?.abort(); window.speechSynthesis?.cancel(); });
select('#today').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
// 主页真狗说话视频：未生成或无法播放时移除，露出真狗照片兜底。尊重 prefers-reduced-motion。
const heroVideo = select('.hero-video');
if (heroVideo) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) heroVideo.remove();
  else { heroVideo.addEventListener('error', () => heroVideo.remove()); heroVideo.play?.().catch(() => {}); }
}
live = createLiveCompanion({ ask: sendMessage, cancelRequest: cancelConversation, getSample: () => sample, getNickname: () => persona.nickname, synthesize, confirm: confirmAction, toast, teach: text => { feedbackTarget = text; select('#feedback-input').value = ''; select('#feedback-dialog').showModal(); } });
syncPersona(); fillPersona(); renderMemories(); renderMessages(); go(location.hash.slice(1)); status(); refreshVoice();
audioOperation('get').then(value => { sample = value; renderSample(); }).catch(() => toast('浏览器不允许存储录音，录音保存功能暂不可用。'));
