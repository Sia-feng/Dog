import test from 'node:test';
import assert from 'node:assert/strict';
import { mouthFromRms, mouthFromSpeech, speechText } from '../public/avatar.mjs';
import { readFile } from 'node:fs/promises';

test('audio mouth closes on silence and clamps strong signals', () => {
  assert.equal(mouthFromRms(new Float32Array(512)), 0);
  assert.equal(mouthFromRms([]), 0);
  assert.equal(mouthFromRms(Float32Array.from([1, -1, 1, -1])), 1);
  assert.ok(mouthFromRms(Float32Array.from([.08, -.08])) > 0);
});

test('approximate speech mouth stops when playback stops', () => {
  assert.equal(mouthFromSpeech(1, false), 0);
  for (let seconds = 0; seconds < 4; seconds += .01) {
    const value = mouthFromSpeech(seconds, true);
    assert.ok(value >= 0 && value <= 1);
  }
  assert.ok(mouthFromSpeech(.1, true, 0) > mouthFromSpeech(.1, true, 2));
});

test('spoken text removes imagined stage actions and markdown', () => {
  assert.equal(speechText('（摇摇尾巴）姐姐，**你好**！'), '姐姐，你好！');
  assert.equal(speechText('(smile) 我陪你。'), '我陪你。');
  assert.equal(speechText('字'.repeat(1400)).length, 1200);
});

test('voice interface offers text input but no chat bubble list', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const liveSection = html.split('id="page-chat"')[1].split('id="page-voice"')[0];
  assert.ok(liveSection.includes('id="dog-canvas"'));
  assert.ok(liveSection.includes('id="live-mic"'));
  assert.ok(liveSection.includes('id="live-compose"'));
  assert.ok(liveSection.includes('id="live-text"'));
  assert.ok(liveSection.includes('id="live-type"'));
  for (const oldElement of ['id="messages"', 'chat-panel']) assert.ok(!liveSection.includes(oldElement));
});
