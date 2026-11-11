import { readFile, writeFile, mkdir, rename, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDirectory = resolve(root, '.seedance');
const endpoint = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';

// 图生视频（坐姿·表情生动）：以已有干净照片为首帧，狗原地做细腻表情。
export const prompt = '以首帧照片里的白色狗狗刷子为唯一主体，面部表情生动传神是唯一重点。保持同一只狗的脸型、白色毛发、蓝色睡帽、睡衣、坐姿、室内背景、机位与光线完全不变。真实摄影质感，固定机位，竖屏构图，一镜到底。重点让它的表情鲜活起来：眼睛明亮灵动、自然眨眼，目光在镜头前轻轻转动并与镜头对视，流露好奇、温柔、开心的神情；耳朵随情绪轻轻竖起或抖动，眉心与脸颊有细微牵动，鼻子轻轻翕动，偶尔微微歪头，像在认真听你说话、对你有反应。身体基本保持原姿势，不起身、不走动、不大幅晃动；不说话、不张嘴做人类口型、不咀嚼。不改变场景、服装或镜头，不出现人物或多余肢体，不增加字幕、文字、水印或背景音乐。动作细腻自然、克制不夸张，最后一帧尽量回到接近第一帧的神态，便于无缝循环。';

// 文生视频（入场）：空房间起步，白狗从左侧走入、停在中央、转身坐下抬头看镜头。首帧没有狗，只能文生视频。
// 刻意不含任何卡通角色或受版权保护的形象，睡帽为通用款式。
export const entrancePrompt = '竖屏 9:16，固定机位，一镜到底，真实摄影质感的温馨室内场景。开场 0–1 秒是一间柔和薄荷绿与米白色调的空房间，地上铺浅色地毯，画面中没有任何动物。约第 1 秒，一只蓬松的白色狗狗从画面左侧迈着轻快的小步走入；它戴着蓝色睡帽、帽尖有一颗白色绒球，穿浅色睡衣，绒球随脚步轻轻晃动，它稳稳走向画面正中央。约第 3–5 秒，狗狗在正中央停下，转身面向镜头，自然地坐下，两只前爪并拢，身体和头部居中，抬头看向镜头，表情温柔、好奇、亲切。动作自然连贯，毛发真实柔软，光线温暖。不出现任何人物、文字、字幕、水印或商标；不包含任何卡通角色或受版权保护的形象；镜头保持不动。';

// 图生视频（主页·真狗开口自我介绍）：以真实狗照片为首帧，先歪头再对镜头自然开合嘴部，严格保留真实犬类口鼻，禁止人类嘴唇/牙齿。
export const homePrompt = '以首帧照片里的白色狗狗为唯一主体，保持它真实的脸型、口鼻结构、毛发、黄色领巾与黄色瓷砖背景、机位和光线完全不变。真实摄影质感，固定机位，竖屏，一镜到底。让它先轻轻歪一下头，然后抬头正对镜头，像在自信又调皮地做自我介绍：嘴巴按说话节奏自然地一开一合，配合真实狗狗的口鼻与下颌活动，流露放松愉快、机灵自信的神情，眼睛明亮、与镜头对视，耳朵偶尔轻动。严格保持真实犬类的嘴部、舌头与牙齿结构，绝不出现人类嘴唇、人类牙齿或夸张的人类口型。动作自然连贯、细腻不夸张；不起身、不走动、不离开画面，不改变背景或镜头，不出现人物、文字、字幕、水印或背景音乐。最后一帧尽量回到接近第一帧的神态，便于无缝循环。';

// 图生视频（聊天页·刷子开口说话，短循环）：以首帧照片的白狗为主体，像活过来一样对着镜头连续说话，供聊天"说话中"状态循环播放。
// 注意：这是通用说话循环，不会与具体回复逐字对口型；不冒充音素级唇形。
export const talkPrompt = '以首帧照片里的白色狗狗刷子为唯一主体，保持它的脸型、白色毛发、蓝色睡帽、睡衣、坐姿、室内背景、机位与光线完全不变。真实摄影质感，固定机位，竖屏，一镜到底。核心：让它像忽然活了过来、正对着镜头热情地跟你说话——嘴巴连续、自然地一开一合，始终保持说话的节奏感，配合下颌与口鼻的真实活动，仿佛在认真地跟你聊天。表情生动传神：眼睛明亮灵动、与镜头对视，偶尔眨眼，眉心脸颊随语气轻轻牵动，耳朵随情绪轻动，时而微微点头或歪头，流露开心、亲昵、想跟你分享的神情。身体基本保持原姿势，不起身、不走动、不离开画面。保持真实犬类的嘴部与口鼻结构，动作自然流畅、充满生命力但不恐怖、不夸张变形。不改变场景、服装或镜头，不出现人物或多余肢体，不加字幕、文字、水印或背景音乐。整段从头到尾都在说话，首尾神态与口型尽量衔接，便于无缝循环。';

export function buildVideoRequest(model, imageBytes, promptText = prompt, duration = 5) {
  if (!model || !imageBytes?.length) throw new Error('缺少模型 ID 或参考图片。');
  return {
    model,
    content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBytes.toString('base64')}` }, role: 'first_frame' }],
    duration, resolution: '720p', ratio: 'adaptive', generate_audio: false, watermark: true
  };
}

export function buildEntranceRequest(model) {
  if (!model) throw new Error('缺少模型 ID。');
  return {
    model,
    content: [{ type: 'text', text: entrancePrompt }],
    duration: 5, resolution: '720p', ratio: '9:16', generate_audio: false, watermark: true
  };
}

// 两个独立任务：坐姿循环（图生）与入场（文生）。各自的状态、锁、输出文件互不干扰。
const JOBS = {
  idle: {
    label: '坐姿·表情', statePath: resolve(stateDirectory, 'idle-task.json'), lockPath: resolve(stateDirectory, 'submission.lock'),
    assetPath: resolve(root, 'public/assets/shuazi-idle.mp4'), note: '5 秒 / 720p / 自适应比例 / 无声 / 参考刷子照片',
    buildPayload: async model => buildVideoRequest(model, await readFile(resolve(root, 'public/assets/shuazi.png')))
  },
  entrance: {
    label: '入场·文生', statePath: resolve(stateDirectory, 'entrance-task.json'), lockPath: resolve(stateDirectory, 'entrance.lock'),
    assetPath: resolve(root, 'public/assets/shuazi-entrance.mp4'), note: '5 秒 / 720p / 9:16 / 无声 / 纯文本场景（空房→走入→坐下）',
    buildPayload: async model => buildEntranceRequest(model)
  },
  home: {
    label: '主页·真狗开口', statePath: resolve(stateDirectory, 'home-task.json'), lockPath: resolve(stateDirectory, 'home.lock'),
    assetPath: resolve(root, 'public/assets/shuazi-home.mp4'), note: '5 秒 / 720p / 自适应 / 无声 / 真狗照首帧（歪头+自然开口）',
    buildPayload: async model => buildVideoRequest(model, await readFile(resolve(root, 'public/assets/shuazi-home-src.png')), homePrompt)
  },
  talk: {
    label: '聊天·刷子说话', statePath: resolve(stateDirectory, 'talk-task.json'), lockPath: resolve(stateDirectory, 'talk.lock'),
    assetPath: resolve(root, 'public/assets/shuazi-talk.mp4'), note: '5 秒 / 720p / 自适应 / 无声 / 刷子照首帧（持续开口说话·页面内循环）',
    buildPayload: async model => buildVideoRequest(model, await readFile(resolve(root, 'public/assets/shuazi.png')), talkPrompt, 5)
  }
};

export function maySubmit(state) {
  return state === null;
}

async function getState(job) {
  try { return JSON.parse(await readFile(job.statePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('生成记录无法读取。为避免重复付费，已停止。'); }
}

async function saveState(job, state) {
  await mkdir(stateDirectory, { recursive: true });
  const temporary = job.statePath + '.tmp';
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(temporary, job.statePath);
}

async function jsonRequest(url, options, key) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(90000) });
  let body;
  try { body = await response.json(); } catch { throw new Error(`接口返回无法解析（HTTP ${response.status}）。`); }
  if (!response.ok) {
    const error = new Error(`方舟请求失败：HTTP ${response.status} / ${String(body.error?.code || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100)}。请检查模型权限、密钥和账户。`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function createOnce(job, key, model) {
  const existing = await getState(job);
  if (!maySubmit(existing)) {
    if (existing.id) { console.log('已有任务，继续查询；不创建第二条视频。'); return existing; }
    throw new Error('本机已有提交记录但没有任务 ID。为避免重复计费，不会自动再次提交；请先在方舟核查任务记录。');
  }
  const payload = await job.buildPayload(model);
  await jsonRequest('https://ark.cn-beijing.volces.com/api/v3/models', { method: 'GET' }, key);
  await mkdir(stateDirectory, { recursive: true });
  let lock;
  try { lock = await open(job.lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('已有生成操作正在进行或等待核查。不会重复提交。'); throw error; }
  await lock.close();
  const state = { job: job.label, state: 'submitting', model, duration: payload.duration, resolution: '720p', generate_audio: false, ratio: payload.ratio, createdAt: new Date().toISOString() };
  await saveState(job, state);
  console.log(`提交唯一一条：${job.note}。`);
  try {
    const result = await jsonRequest(endpoint, { method: 'POST', body: JSON.stringify(payload) }, key);
    if (typeof result.id !== 'string' || !/^cgt-[a-zA-Z0-9-]+$/.test(result.id)) throw new Error('没有收到可识别任务 ID。');
    state.id = result.id; state.state = 'submitted';
    await saveState(job, state);
    console.log(`任务 ID：${state.id}`);
    return state;
  } catch (error) {
    state.state = error.status && error.status < 500 ? 'rejected' : 'submission_unknown';
    await saveState(job, state);
    throw new Error(`${error.message} 本次不会自动重试创建。请保留 .seedance 中的提交记录。`);
  }
}

async function downloadVideo(assetPath, url) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('视频下载地址不符合安全要求。');
  const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`视频下载失败（HTTP ${response.status}）。重新运行只会查询和下载，不会新建任务。`);
  if (Number(response.headers.get('content-length') || 0) > 100 * 1024 * 1024) throw new Error('视频超过 100 MB 上限。');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 100 * 1024 * 1024) throw new Error('视频超过 100 MB 上限。');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 32 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('下载结果不是可识别的 MP4 视频。');
  await writeFile(assetPath + '.partial', bytes);
  await rename(assetPath + '.partial', assetPath);
  return size;
}

async function poll(job, state, key) {
  if (!state?.id) throw new Error('还没有任务 ID。');
  if (state.state === 'downloaded') {
    try { await readFile(job.assetPath); console.log('视频已下载，无需再次生成。刷新网站即可。'); return; } catch {}
  }
  const deadline = Date.now() + 15 * 60000;
  let previous;
  while (Date.now() < deadline) {
    const result = await jsonRequest(`${endpoint}/${encodeURIComponent(state.id)}`, { method: 'GET' }, key);
    state.state = result.status; state.updatedAt = new Date().toISOString();
    await saveState(job, state);
    if (previous !== result.status) { console.log(`生成状态：${result.status}`); previous = result.status; }
    if (result.status === 'succeeded') {
      if (result.duration != null && state.duration != null && result.duration !== state.duration) throw new Error(`服务返回的视频时长（${result.duration}s）与授权（${state.duration}s）不一致，已停止自动接入，请人工核查。`);
      if (result.generate_audio === true) throw new Error('服务返回有声视频，与授权不符，已停止自动接入。');
      if (result.resolution && result.resolution !== '720p') throw new Error('服务返回分辨率不是 720p，已停止自动接入。');
      if (!result.content?.video_url) throw new Error('任务已成功但没有视频下载地址。');
      const bytes = await downloadVideo(job.assetPath, result.content.video_url);
      state.state = 'downloaded'; state.bytes = bytes;
      await saveState(job, state);
      console.log(`已保存 ${job.assetPath}。刷新网站即可预览。`);
      return;
    }
    if (['failed', 'expired', 'cancelled', 'canceled'].includes(result.status)) throw new Error(`任务结束：${result.status}。不会自动新建任务。`);
    await delay(10000);
  }
  console.log('任务尚未完成。稍后重新运行此脚本，会继续查询同一个任务，不会重复生成。');
}

function pickJob(args) {
  const scene = (args.find(a => a.startsWith('--scene=')) || '').split('=')[1] || 'idle';
  const job = JOBS[scene];
  if (!job) throw new Error(`未知场景 "${scene}"。可用：idle（坐姿图生）、entrance（入场文生）、home（主页开口）、talk（聊天说话短循环）。`);
  return job;
}

export async function main(args = process.argv.slice(2)) {
  const job = pickJob(args);
  if (args.includes('--dry-run')) {
    const payload = await job.buildPayload(process.env.SEEDANCE_MODEL || 'doubao-seedance-2-5-260628');
    if (payload.content[1]) payload.content[1].image_url.url = '[本机刷子照片；仅在确认生成时上传]';
    console.log(JSON.stringify(payload, null, 2)); return;
  }
  const key = process.env.ARK_API_KEY?.trim();
  const model = process.env.SEEDANCE_MODEL?.trim();
  if (!key || !model) throw new Error('请先在 .env 中配置 ARK_API_KEY 和 SEEDANCE_MODEL。');
  let state;
  if (args.includes('--create-one')) state = await createOnce(job, key, model);
  else if (args.includes('--resume')) state = await getState(job);
  else throw new Error('使用 --dry-run 检查参数；--create-one 生成授权的一条；--resume 只查询已有任务。可加 --scene=entrance 生成入场视频。');
  await poll(job, state, key);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = error.cause?.code || error.code;
    console.error(['EACCES', 'EPERM'].includes(code) ? '当前执行环境禁止外网连接。尚不能调用方舟，请在本机终端运行此脚本。' : error.message);
    process.exitCode = 1;
  });
}
