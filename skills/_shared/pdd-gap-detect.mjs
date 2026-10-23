/**
 * 双缺口：梯度扫描实现（纯 JS，无依赖）
 * 给 pdd-slider-solver 用
 */

import { inflateSync } from 'node:zlib'

/**
 * 从 base64 PNG 解析像素数据（支持 8bit RGB/RGBA，无交错）
 * @returns {{w,h,data}} data 为 RGBA Uint8Array
 */
export function decodePng(b64) {
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 33 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null
  let p = 8
  let w = 0, h = 0, bitDepth = 8, colorType = 6
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.slice(p + 4, p + 8).toString('ascii')
    if (type === 'IHDR') {
      w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12)
      bitDepth = buf[p + 16]; colorType = buf[p + 17]
    } else if (type === 'IDAT') {
      idat.push(buf.slice(p + 8, p + 8 + len))
    } else if (type === 'IEND') break
    p += 12 + len
  }
  if (!w || !h || bitDepth !== 8) return null
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (!channels) return null
  const raw = Buffer.concat(idat)
  // 解压
  let inflated
  try { inflated = inflateSync(raw) } catch { return null }
  const stride = w * channels
  const out = new Uint8Array(w * h * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  let off = 0
  for (let y = 0; y < h; y++) {
    const filter = inflated[off++]
    for (let i = 0; i < stride; i++) cur[i] = inflated[off++]
    // 反滤波
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = cur[i]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      cur[i] = v
    }
    for (let x = 0; x < w; x++) {
      const si = x * channels, di = (y * w + x) * 4
      if (channels === 4) { out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = cur[si + 3] }
      else if (channels === 3) { out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = 255 }
      else { const g = cur[si]; out[di] = out[di + 1] = out[di + 2] = g; out[di + 3] = 255 }
    }
    prev.set(cur)
  }
  return { w, h, data: out }
}

/**
 * 找真缺口的 X 坐标（PNG 像素基准）
 *
 * 原理：真缺口是一条「垂直矩形凹槽」，左右边缘产生强垂直梯度。
 * 干扰缺口通常较浅/较弱。取最强梯度作为缺口左边缘。
 *
 * @param bgPng decodePng 结果
 * @returns {{ gapX, peaks, method }}
 */
export function findRealGap(bgPng) {
  const { w: W, h: H, data } = bgPng
  const lum = (x, y) => {
    const i = (y * W + x) * 4
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  }
  const colGrad = new Float64Array(W)
  for (let x = 1; x < W; x++) {
    let s = 0
    for (let y = 0; y < H; y++) s += Math.abs(lum(x, y) - lum(x - 1, y))
    colGrad[x] = s / H
  }
  const peaks = []
  for (let x = 3; x < W - 3; x++) {
    if (colGrad[x] > colGrad[x - 1] && colGrad[x] > colGrad[x + 1] && colGrad[x] > colGrad[x - 2] && colGrad[x] > colGrad[x + 2] && colGrad[x] > 8) {
      peaks.push({ x, v: +colGrad[x].toFixed(2) })
    }
  }
  peaks.sort((a, b) => b.v - a.v)
  return { gapX: peaks[0]?.x ?? 0, peaks: peaks.slice(0, 8), method: 'gradient' }
}
