// 零依赖 PNG 裁剪：用 Node 内置 zlib 解码/编码，避免安装任何第三方库或云端处理。
// 用途：把参考照片裁到只剩“狗的主题形象”，去掉背景里受版权保护的卡通海报/手办，降低视频生成审核风险。
// 仅支持 8 位、非隔行、色彩类型 0/2/4/6（灰度/RGB/RGBA/灰度+Alpha），足以覆盖常见照片 PNG。

import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('不是有效的 PNG 文件。');
  let offset = 8;
  let header;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('缺少 IHDR。');
  if (header.depth !== 8) throw new Error(`暂只支持 8 位深，当前 ${header.depth} 位。`);
  if (header.interlace) throw new Error('暂不支持隔行 PNG。');
  const channels = CHANNELS[header.colorType];
  if (!channels) throw new Error(`不支持的色彩类型 ${header.colorType}。`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(stride * header.height);
  let position = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[position]; position += 1;
    const line = raw.subarray(position, position + stride); position += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`未知过滤类型 ${filter}。`);
      out[x] = value & 0xff;
    }
  }
  return { width: header.width, height: header.height, colorType: header.colorType, channels, pixels };
}

export function cropImage(image, { x, y, width, height }) {
  if (x < 0 || y < 0 || x + width > image.width || y + height > image.height || width < 1 || height < 1) throw new Error('裁剪区域超出原图范围。');
  const channels = image.channels;
  const out = Buffer.alloc(width * height * channels);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * channels;
    image.pixels.copy(out, row * width * channels, from, from + width * channels);
  }
  return { width, height, colorType: image.colorType, channels, pixels: out };
}

export function encodePng(image) {
  const stride = image.width * image.channels;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let row = 0; row < image.height; row += 1) {
    raw[row * (stride + 1)] = 0;
    image.pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0); ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; ihdr[9] = image.colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// 直接用：node scripts/crop-png.mjs <输入> <输出> <x> <y> <width> <height>
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const [input, output, x, y, width, height] = process.argv.slice(2);
  const source = await readFile(resolve(input));
  const image = decodePng(source);
  console.log(`原图 ${image.width}x${image.height} 色彩类型 ${image.colorType}`);
  const cropped = cropImage(image, { x: Number(x), y: Number(y), width: Number(width), height: Number(height) });
  const bytes = encodePng(cropped);
  await writeFile(resolve(output), bytes);
  console.log(`已裁剪为 ${cropped.width}x${cropped.height}，写入 ${output}（${bytes.length} 字节）`);
}
