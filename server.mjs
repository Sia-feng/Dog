import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { buildSystemPrompt, demoReply, normalizePersona, normalizeMemories } from './public/logic.mjs';
import { voiceConfigured, voiceStatus, enrollVoice, synthesize, packsStatus, normalizePack, packReady, VOICE_PACKS, DEFAULT_PACK } from './scripts/voice.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const apiKey = process.env.MOONSHOT_API_KEY?.trim();
const model = process.env.KIMI_MODEL || 'kimi-k3.1-pro-highspeed';
const share = process.env.SHARE_PASSWORD?.trim(); // 设置后进入“分享模式”：放开外网 host、启用访问口令
const lockCsp = "default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'";
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
let active = 0;
let requests = [];

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function parseCookie(request) {
  const out = {};
  for (const part of (request.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function rawBody(request, limit = 4096) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new Error('请求过大'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

function lockPage(error = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>刷子的小窝 · 口令</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#243c30;color:#fffdf1;font-family:system-ui,"Microsoft YaHei",sans-serif}form{background:#1b3328;padding:34px 30px;border-radius:18px;width:min(88vw,340px);box-shadow:0 10px 40px #0005}h1{font-size:19px;margin:0 0 6px}p{font-size:13px;color:#cfe0c6;margin:0 0 18px;line-height:1.7}input{width:100%;box-sizing:border-box;padding:13px 15px;border-radius:12px;border:1px solid #ffffff33;background:#0f241b;color:#fff;font-size:15px}button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:12px;background:#e6edc6;color:#365640;font-size:15px;font-weight:600;cursor:pointer}.err{color:#ffc9a8;font-size:12px;margin-top:10px;min-height:14px}</style></head><body><form method="POST" action="/unlock"><h1>刷子的小窝 🐾</h1><p>这是朋友的私人小狗，先报上口令再进来。</p><input type="password" name="password" placeholder="输入访问口令" autofocus required><button type="submit">进来找刷子</button><div class="err">${error}</div></form></body></html>`;
}

async function bodyOf(request, limit = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function validateChat(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) throw new Error('聊天格式不正确');
  const messages = body.messages.slice(-20);
  if (!messages.length || messages.some(item => !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 4000) || messages.at(-1).role !== 'user') throw new Error('消息内容不正确或过长');
  return { messages: messages.map(({ role, content }) => ({ role, content })), persona: normalizePersona(body.persona), memories: normalizeMemories(body.memories) };
}

export function parseByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end };
}

export function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const host = request.headers.host;
    const hostBare = (host || '').replace(/:\d+$/, '');
    const isLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(hostBare);
    if (!host || (!share && !isLocal)) return json(response, 403, { error: '仅允许本机访问' });
    const okOrigin = origin => !origin || origin === `http://${host}` || origin === `https://${host}`;
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname); }
    catch { return json(response, 400, { error: '地址无效' }); }
    // 分享模式访问口令：朋友需先输入口令（本机自用免口令）。
    const authed = !share || isLocal || parseCookie(request).shuazi_pass === share;
    if (share && request.method === 'POST' && pathname === '/unlock') {
      let password = '';
      try { password = new URLSearchParams(await rawBody(request)).get('password') || ''; } catch {}
      if (password && password === share) {
        response.writeHead(302, { Location: '/', 'Cache-Control': 'no-store', 'Set-Cookie': `shuazi_pass=${encodeURIComponent(share)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400` });
        return response.end();
      }
      response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': lockCsp });
      return response.end(lockPage('口令不对，再试一次。'));
    }
    if (!authed) {
      if (pathname.startsWith('/api/')) return json(response, 401, { error: '需要访问口令' });
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': lockCsp });
      return response.end(lockPage());
    }
    if (request.method === 'GET' && pathname === '/api/status') return json(response, 200, { configured: Boolean(apiKey), model, voiceClone: voiceConfigured(), packs: packsStatus(), defaultPack: DEFAULT_PACK });
    if (request.method === 'GET' && pathname === '/api/voice/status') {
      if (!voiceConfigured()) return json(response, 200, { configured: false, ready: false });
      try { return json(response, 200, await voiceStatus()); }
      catch (error) { return json(response, 502, { configured: true, ready: false, error: error.message }); }
    }
    if (request.method === 'POST' && pathname === '/api/voice/enroll') {
      if (!okOrigin(request.headers.origin)) return json(response, 403, { error: '请求来源不被允许' });
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '仅支持 JSON' });
      if (!voiceConfigured()) return json(response, 503, { error: '后端未配置火山引擎声音复刻密钥。' });
      let payload;
      try { payload = await bodyOf(request, 32 * 1024 * 1024); }
      catch { return json(response, 400, { error: '录音数据格式不正确或过大（上限约 24 MB）。' }); }
      try { return json(response, 200, await enrollVoice(payload.audio, payload.format, payload.text)); }
      catch (error) { return json(response, 502, { error: error.message }); }
    }
    if (request.method === 'POST' && pathname === '/api/tts') {
      if (!okOrigin(request.headers.origin)) return json(response, 403, { error: '请求来源不被允许' });
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '仅支持 JSON' });
      let payload;
      try { payload = await bodyOf(request); }
      catch { return json(response, 400, { error: '合成请求不正确。' }); }
      const pack = normalizePack(payload.pack);
      if (!packReady(pack)) return json(response, 503, { error: `音色包「${VOICE_PACKS[pack].label}」未配置，使用系统音色。` });
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text || text.length > 1000) return json(response, 400, { error: '合成文字为空或过长（上限 1000 字）。' });
      try {
        const { audio, contentType } = await synthesize(text, { pack });
        response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'Content-Length': audio.length });
        response.end(audio);
        return;
      } catch (error) { return json(response, 502, { error: error.message }); }
    }
    if (request.method === 'GET' && pathname === '/api/animation') {
      const check = async file => { try { const info = await stat(resolve(root, file)); return info.isFile() && info.size > 32; } catch { return false; } };
      const [idle, talk] = await Promise.all([check('assets/shuazi-idle.mp4'), check('assets/shuazi-talk.mp4')]);
      return json(response, 200, {
        available: idle, url: '/assets/shuazi-idle.mp4', kind: 'prerendered-idle', lipSync: false,
        talk: { available: talk, url: '/assets/shuazi-talk.mp4', kind: 'prerendered-talk', lipSync: false }
      });
    }
    if (request.method === 'POST' && pathname === '/api/chat') {
      if (!okOrigin(request.headers.origin)) return json(response, 403, { error: '请求来源不被允许' });
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '仅支持 JSON' });
      requests = requests.filter(time => Date.now() - time < 60000);
      if (requests.length >= 30 || active >= 3) return json(response, 429, { error: '刷子需要喘口气，请稍后重试。' });
      let chat;
      let body;
      try { body = await bodyOf(request); chat = validateChat(body); }
      catch { return json(response, 400, { error: '消息格式不正确，请将单条消息控制在 4000 字以内。' }); }
      if (body.mode !== 'kimi') return json(response, 200, { mode: 'demo', reply: demoReply(chat.messages.at(-1).content, chat.persona, chat.memories) });
      if (!apiKey) return json(response, 503, { error: '尚未配置 Kimi 密钥，请切换到演示模式。' });
      requests.push(Date.now());
      active += 1;
      try {
        const payload = { model, messages: [{ role: 'system', content: buildSystemPrompt(chat.persona, chat.memories) }, ...chat.messages], max_tokens: 4096 };
        if (model.startsWith('kimi-k3')) payload.reasoning_effort = 'low';
        const result = await fetch('https://api.moonshot.cn/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000)
        });
        if (!result.ok) {
          const errors = { 401: 'Kimi 密钥无效或已失效，请在后端更换。', 402: 'Kimi 账户余额不足，请检查账户。', 403: 'Kimi 账户没有访问该模型的权限。', 429: 'Kimi 暂时限流或额度不足，请稍后再试。' };
          return json(response, 502, { error: errors[result.status] || `Kimi 请求未完成（${result.status}），请检查模型配置或稍后重试。` });
        }
        const resultBody = await result.json();
        const reply = resultBody.choices?.[0]?.message?.content;
        if (typeof reply !== 'string' || !reply.trim()) throw new Error('empty');
        return json(response, 200, { mode: 'kimi', reply });
      } catch (error) {
        return json(response, 502, { error: error.name === 'TimeoutError' ? 'Kimi 回复超时了，请稍后重试。' : '暂时没能连上 Kimi，请检查网络后重试。未用演示回复替代。' });
      } finally { active -= 1; }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: '不支持此请求' });
    const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(root.endsWith(sep) ? root : root + sep) || !types[extname(target)]) return json(response, 404, { error: '文件不存在' });
    try {
      if (extname(target) === '.mp4') {
        const metadata = await stat(target);
        const range = request.headers.range ? parseByteRange(request.headers.range, metadata.size) : null;
        if (request.headers.range && !range) {
          response.writeHead(416, { 'Content-Range': `bytes */${metadata.size}` }); response.end(); return;
        }
        const start = range?.start ?? 0; const end = range?.end ?? metadata.size - 1;
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-cache' };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${metadata.size}`;
        response.writeHead(range ? 206 : 200, headers);
        if (request.method === 'HEAD') { response.end(); return; }
        const stream = createReadStream(target, { start, end });
        stream.on('error', () => response.destroy());
        response.on('close', () => stream.destroy());
        stream.pipe(response); return;
      }
      const data = await readFile(target);
      response.writeHead(200, { 'Content-Type': types[extname(target)], 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { json(response, 404, { error: '文件不存在' }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(port, '127.0.0.1', () => console.log(`Shuazi: http://localhost:${port} | ${apiKey ? 'Kimi configured' : 'Demo mode'}`));
}
