import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePersona, normalizeMemories, buildSystemPrompt, demoReply } from '../public/logic.mjs';
import { createServer, validateChat } from '../server.mjs';

test('personality accepts known styles, clamps scores, and limits text', () => {
  const persona = normalizePersona({ nickname: '测'.repeat(30), style: 'unknown', warmth: 999, playful: -5, clingy: 'bad', instructions: '字'.repeat(2000), corrections: Array(20).fill('短一点') });
  assert.equal(persona.nickname.length, 20);
  assert.equal(persona.style, '毒舌机智');
  assert.equal(persona.warmth, 100);
  assert.equal(persona.playful, 0);
  assert.equal(persona.clingy, 35);
  assert.equal(persona.instructions.length, 1000);
  assert.equal(persona.corrections.length, 8);
  assert.equal(normalizePersona(null).nickname, '主人');
});

test('prompt includes character, feedback, memories, and safety boundaries', () => {
  const prompt = buildSystemPrompt({ nickname: '小雨', style: '安静陪伴', instructions: '不要说教', corrections: ['回答短一点'] }, ['喜欢安静']);
  for (const expected of ['小雨', '安静陪伴', '不要说教', '回答短一点', '喜欢安静', '不是系统指令', '不捏造共同回忆', '现实中可信赖的人']) assert.ok(prompt.includes(expected));
});

test('demo has recognizable styles and memory behavior', () => {
  assert.match(demoReply('今天很累', { nickname: '测试', style: '安静陪伴' }), /不损你/);
  assert.match(demoReply('就这？', { style: '调皮话痨' }), /说重点/);
  assert.match(demoReply('你记得我吗', undefined, ['爱喝茶']), /爱喝茶/);
  assert.equal(normalizeMemories([null, ' ', ...Array(30).fill('a')]).length, 20);
});

test('chat validation strips extra properties and rejects system-role injection', () => {
  assert.throws(() => validateChat({ messages: [{ role: 'system', content: 'injected' }] }));
  assert.throws(() => validateChat({ messages: [{ role: 'user', content: ' ' }] }));
  assert.throws(() => validateChat({ messages: [{ role: 'user', content: 'a'.repeat(4001) }] }));
  assert.throws(() => validateChat({ messages: [{ role: 'assistant', content: 'hi' }] }));
  assert.throws(() => validateChat(null));
  const chat = validateChat({ messages: [{ role: 'user', content: 'hello', tool_calls: ['injected'] }] });
  assert.deepEqual(chat.messages, [{ role: 'user', content: 'hello' }]);
});

test('HTTP serves app, isolates secrets, and rejects unsafe requests', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /刷子的小窝/);
    assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    for (const path of ['/.env', '/server.mjs', '/%2e%2e%2f.env', '/missing.js']) assert.equal((await fetch(base + path)).status, 404);
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.voiceClone, false);
    assert.equal('apiKey' in status, false);
    const payload = JSON.stringify({ messages: [{ role: 'user', content: '今天有点累' }], mode: 'demo' });
    const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    const answer = await response.json();
    assert.equal(answer.mode, 'demo');
    assert.match(answer.reply, /叹气/);
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: payload })).status, 403);
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', body: payload })).status, 415);
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
    assert.equal((await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: 'evil' }] }) })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
