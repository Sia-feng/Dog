import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVideoRequest, maySubmit } from '../scripts/seedance.mjs';
import { shouldPlayIdle, pickVideo } from '../public/idle-video.mjs';
import { parseByteRange, createServer } from '../server.mjs';

test('single video parameters stay inside authorized scope', () => {
  const request = buildVideoRequest('doubao-seedance-2-5-260628', Buffer.from('png-fixture'));
  assert.equal(request.duration, 5);
  assert.equal(request.resolution, '720p');
  assert.equal(request.generate_audio, false);
  assert.equal(request.ratio, 'adaptive');
  assert.equal(request.content[1].role, 'first_frame');
  assert.ok(request.content[1].image_url.url.startsWith('data:image/png;base64,'));
  assert.equal('n' in request, false);
  assert.throws(() => buildVideoRequest('', Buffer.from('x')));
});

test('existing or uncertain submission cannot create a duplicate paid task', () => {
  assert.equal(maySubmit(null), true);
  for (const state of ['submitting', 'submitted', 'submission_unknown', 'rejected', 'failed', 'downloaded']) assert.equal(maySubmit({ state }), false);
});

test('dog video stays alive while speaking but pauses on background, navigation and reduced motion', () => {
  const base = { available: true, active: true, hidden: false, paused: false };
  assert.equal(shouldPlayIdle(base), true);
  assert.equal(shouldPlayIdle({ ...base, state: 'listening' }), true);
  assert.equal(shouldPlayIdle({ ...base, state: 'speaking' }), true);
  for (const change of [{ active: false }, { hidden: true }, { paused: true }, { available: false }]) assert.equal(shouldPlayIdle({ ...base, ...change }), false);
});

test('speaking state prefers the talk loop, other states use the idle loop', () => {
  const on = { canPlay: true };
  // 说话中：有说话视频就播说话视频
  assert.equal(pickVideo({ ...on, speaking: true, idleAvailable: true, talkAvailable: true }), 'talk');
  // 说话中但没有说话视频：退回待机视频（保持狗狗活着）
  assert.equal(pickVideo({ ...on, speaking: true, idleAvailable: true, talkAvailable: false }), 'idle');
  // 非说话状态：播待机视频，即使有说话视频也不用
  assert.equal(pickVideo({ ...on, speaking: false, idleAvailable: true, talkAvailable: true }), 'idle');
  // 只有说话视频、非说话状态：没有可播的待机视频
  assert.equal(pickVideo({ ...on, speaking: false, idleAvailable: false, talkAvailable: true }), 'none');
  // 不能播放（暂停/切后台/离开页面）：都不播
  assert.equal(pickVideo({ canPlay: false, speaking: true, idleAvailable: true, talkAvailable: true }), 'none');
});

test('video byte ranges support browser seeking safely', () => {
  assert.deepEqual(parseByteRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=100-', 1000), { start: 100, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=0-9999', 1000), { start: 0, end: 999 });
  for (const header of ['bytes=1000-', 'bytes=9-2', 'bytes=-0', 'bytes=-', 'bytes=0-2,3-4', 'bad']) assert.equal(parseByteRange(header, 1000), null);
});

test('animation status does not expose generation credentials or task records', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base + '/api/animation');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(typeof body.available, 'boolean');
    assert.equal(body.lipSync, false);
    assert.equal(typeof body.talk, 'object');
    assert.equal(typeof body.talk.available, 'boolean');
    assert.equal(body.talk.lipSync, false);
    assert.equal('apiKey' in body, false);
    for (const route of ['/.seedance/idle-task.json', '/scripts/seedance.mjs', '/.env']) assert.equal((await fetch(base + route)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
