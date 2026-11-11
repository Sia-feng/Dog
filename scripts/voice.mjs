// 火山引擎（豆包）声音复刻 2.0 + 语音合成。供应商细节全部集中在此文件，便于替换或按官方文档核对。
// 契约参考（核对日期 2026-11-10）：
//   声音复刻 upload/status：https://openspeech.bytedance.com/api/v1/mega_tts/{audio/upload,status}，Resource-Id: seed-icl-2.0
//   语音合成（一次性 HTTP）：https://openspeech.bytedance.com/api/v1/tts，克隆音色 cluster 用 volcano_icl
//   鉴权头为分号格式：Authorization: Bearer;<token>。字段最终以火山语音控制台文档为准。
// 密钥与音色 ID 只在后端读取，不进入浏览器。

const UPLOAD_URL = 'https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload';
const STATUS_URL = 'https://openspeech.bytedance.com/api/v1/mega_tts/status';
const TTS_V3_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const RESOURCE_ID = 'seed-icl-2.0';
const ALLOWED_FORMATS = ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'pcm'];

function creds() {
  return {
    apiKey: process.env.VOLC_TTS_API_KEY?.trim(), // 新版控制台 API Key，用于 V3 合成鉴权（X-Api-Key）
    appid: process.env.VOLC_TTS_APPID?.trim(),    // 旧版 App ID，仅声音复刻训练(enroll)仍需要
    token: process.env.VOLC_TTS_TOKEN?.trim(),    // 旧版 Access Token，仅 enroll 需要
    speaker: process.env.VOLC_SPEAKER_ID?.trim()
  };
}

// 音色包：把"用哪个声音说"做成可切换的预设。
// - playful：调皮小鬼（豆包 2.0 预置音色 seed-tts-2.0）。通用卡通童声风格，不是任何具体角色或其配音演员的声音。
// - clone：用户自己的克隆音色（seed-icl-2.0），保留可用，暂不做进一步优化。
export const VOICE_PACKS = {
  playful: { label: '调皮小鬼', env: 'VOLC_VOICE_PLAYFUL', resourceId: 'seed-tts-2.0' },
  clone: { label: '我的声音（克隆）', env: 'VOLC_SPEAKER_ID', resourceId: 'seed-icl-2.0' }
};

// 预置音色包的语气微调：略提音调、略加速，让声音更俏皮可爱。
// 只作用于预置音色（playful）；克隆音色保持原始音色，不扭曲用户本人的声音。
export const PACK_TUNING = {
  playful: { pitch_ratio: 1.06, speed_ratio: 1.06 },
  clone: {}
};
export const DEFAULT_PACK = 'playful';

export function normalizePack(name) {
  return VOICE_PACKS[name] ? name : DEFAULT_PACK;
}

function packVoiceId(name) {
  return process.env[VOICE_PACKS[normalizePack(name)].env]?.trim() || '';
}

export function packReady(name) {
  const { apiKey, appid, token } = creds();
  return Boolean((apiKey || (appid && token)) && packVoiceId(name));
}

export function packsStatus() {
  return Object.fromEntries(Object.entries(VOICE_PACKS).map(([name, spec]) => [name, { label: spec.label, ready: packReady(name) }]));
}

export function voiceConfigured() {
  return packReady('clone');
}

export function normalizeFormat(format) {
  const value = String(format || '').toLowerCase();
  const mapped = value === 'mpeg' ? 'mp3' : value === 'mp4' ? 'm4a' : value;
  return ALLOWED_FORMATS.includes(mapped) ? mapped : null;
}

async function call(url, body, extraHeaders = {}) {
  const { token } = creds();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer;${token}`, ...extraHeaders },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(60000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

// 提交训练：把本人录音绑定到已购买的声音复刻 2.0 音色 ID。训练本身是异步的，随后用 voiceStatus 轮询。
export async function enrollVoice(audioBase64, format, text) {
  const { appid, speaker } = creds();
  if (!voiceConfigured()) throw new Error('后端未配置火山引擎声音复刻密钥与音色 ID。');
  const audioFormat = normalizeFormat(format);
  if (!audioFormat) throw new Error('该音频格式火山声音复刻不支持。请改用 WAV 或 MP3 录音（浏览器直接录制的 WEBM 可能被拒绝）。');
  if (typeof audioBase64 !== 'string' || audioBase64.length < 1000) throw new Error('录音数据过短或为空。');
  const { ok, status, data } = await call(UPLOAD_URL, {
    speaker_id: speaker,
    appid,
    audios: [{ audio_bytes: audioBase64, text: String(text || '').slice(0, 1000), audio_format: audioFormat }],
    model_type: 4,
    source: 2
  }, { 'Resource-Id': RESOURCE_ID });
  const code = data?.BaseResp?.StatusCode ?? data?.code;
  if (!ok || (code != null && code !== 0 && code !== 1000)) {
    throw new Error(`声音复刻提交失败（HTTP ${status}${code != null ? ` / ${code}` : ''}）。请核对音色 ID 是否已开通声音复刻 2.0，以及音频格式与时长（建议 15~60 秒清晰人声）。`);
  }
  return { submitted: true };
}

export async function voiceStatus() {
  const { appid, speaker } = creds();
  if (!voiceConfigured()) return { configured: false, ready: false };
  const { ok, status, data } = await call(STATUS_URL, { appid, speaker_id: speaker }, { 'Resource-Id': RESOURCE_ID });
  if (!ok) throw new Error(`查询音色状态失败（HTTP ${status}）。`);
  const code = Number(data?.status ?? data?.Status);
  const labels = { 0: '未找到音色', 1: '训练中', 2: '训练完成', 3: '训练失败', 4: '音色可用' };
  return { configured: true, ready: [2, 4].includes(code), status: code, label: labels[code] || '未知状态' };
}

// 解析 V3 单向流式返回：多个 JSON 块首尾相接 {"code":0,"data":"<base64>"}…{"code":20000000}。
// 按顶层花括号深度切出每个对象，拼接所有 data 的 base64 音频。
function collectAudioChunks(text) {
  const chunks = [];
  let depth = 0, start = -1, inStr = false, esc = false, errCode = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        let obj; try { obj = JSON.parse(text.slice(start, i + 1)); } catch { obj = null; }
        if (obj) {
          if (typeof obj.data === 'string' && obj.data) chunks.push(Buffer.from(obj.data, 'base64'));
          if (obj.code && obj.code !== 0 && obj.code !== 20000000 && errCode === null) errCode = obj.code;
        }
        start = -1;
      }
    }
  }
  return { audio: Buffer.concat(chunks), errCode };
}

// 文本 → 指定音色包的音频（mp3），走豆包语音 V3 单向流式接口，X-Api-Key 鉴权。
// 返回音频在前端经 Web Audio 分析真实音量来驱动嘴部，天然声画同步。
export async function synthesize(text, { pack = DEFAULT_PACK } = {}) {
  const { apiKey, appid, token } = creds();
  const name = normalizePack(pack);
  const spec = VOICE_PACKS[name];
  const speaker = packVoiceId(name);
  let auth;
  if (apiKey) auth = { 'X-Api-Key': apiKey };
  else if (appid && token) auth = { 'X-Api-App-Id': appid, 'X-Api-Access-Key': token };
  else throw new Error('未配置火山语音鉴权（VOLC_TTS_API_KEY，或 VOLC_TTS_APPID + VOLC_TTS_TOKEN）。');
  if (!speaker) throw new Error(`音色包「${spec.label}」未配置音色 ID（缺少 ${spec.env}）。`);
  const clean = String(text || '').trim();
  if (!clean) throw new Error('没有可合成的文字。');
  const response = await fetch(TTS_V3_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth, 'X-Api-Resource-Id': spec.resourceId, 'X-Api-Request-Id': crypto.randomUUID() },
    body: JSON.stringify({ user: { uid: 'shuazi-local' }, req_params: { text: clean.slice(0, 1000), speaker, audio_params: { format: 'mp3', sample_rate: 24000, ...(PACK_TUNING[name] || {}) } } }),
    redirect: 'error',
    signal: AbortSignal.timeout(60000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`语音合成失败（HTTP ${response.status}）：${raw.slice(0, 160)}`);
  const { audio, errCode } = collectAudioChunks(raw);
  if (errCode) throw new Error(`语音合成返回错误码 ${errCode}（音色 ID 与 Resource-Id「${spec.resourceId}」不匹配或无权限时常见 55000000）。`);
  if (!audio.length) throw new Error('语音合成未返回音频数据，请检查音色 ID 与账户额度。');
  return { audio, contentType: 'audio/mpeg', pack: name };
}
