/**
 * webui — PNG 拼接（零依赖：node:zlib + 手写 filter 逆运算 / CRC32）。
 *
 * 背景：对话截图 4K（deviceScaleFactor=3）内容稍长时，Chromium/Edge 无头软件的
 * 合成表面（宽×高×scale 的输出像素面积）超过可处理临界，Page.captureScreenshot
 * 会挂死 → 渲染管线被重置 → CDP WebSocket 断开（1006）→ 「CDP 连接已关闭」。
 * 解决：改成「小视口滚动分段截图」——每段输出像素高度 ≤ 8192，逐段截取后再
 * 由本模块拼回整张 PNG。clip + captureBeyondViewport 不可行（合成表面仍按整
 * 视口全高合成，照样挂死），必须让视口本身保持小尺寸。
 *
 * 兼容范围：Chromium captureScreenshot PNG 标准输出（8-bit、color type 2/6、
 * 非交织）；其余格式直接抛错，调用方按其失败路径重试。
 */
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** CRC32 查表（PNG chunk 校验）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])), 0)
  return Buffer.concat([head, data, crc])
}

export interface DecodedPng {
  /** 像素宽（px）。 */
  width: number
  /** 像素高（px）。 */
  height: number
  /** 每像素字节数（3=RGB，4=RGBA）。 */
  bpp: number
  /** 原始像素（长度 = width×height×bpp，行序从上到下）。 */
  pixels: Uint8Array
}

/**
 * 解码一张标准 PNG（8-bit、color type 2/6、非交织）。
 * 需要逆 filter 0~4（None/Sub/Up/Average/Paeth），逐行重建原始像素。
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('PNG 签名无效')
  }
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []
  let pos = 8
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      if (len < 13) throw new Error('PNG IHDR 不完整')
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`不支持的 PNG 位深: ${bitDepth}`)
  if (colorType !== 2 && colorType !== 6) throw new Error(`不支持的 PNG 颜色类型: ${colorType}`)
  if (interlace !== 0) throw new Error('不支持的 PNG 交织模式')
  if (width <= 0 || height <= 0) throw new Error('PNG 缺少合法的 IHDR')
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const expected = (stride + 1) * height
  if (raw.length < expected) throw new Error(`PNG 数据不完整: ${raw.length} < ${expected}`)
  const out = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    const filter = raw[rowStart]
    const row = raw.subarray(rowStart + 1, rowStart + 1 + stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = row[x]
      switch (filter) {
        case 0: break
        case 1: v = (v + a) & 0xff; break
        case 2: v = (v + b) & 0xff; break
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          v = (v + pred) & 0xff
          break
        }
        default: throw new Error(`未知 PNG filter: ${filter}`)
      }
      cur[x] = v
    }
    prev = cur
  }
  return { width, height, bpp, pixels: out }
}

/**
 * 编码一张 8-bit RGB/RGBA PNG（每行 filter 用 None，靠 deflate 压重复行；
 * 截图类图像行内相关性弱、行间强，None 的压缩率损失可忽略，胜在简单可靠）。
 */
export function encodePng(width: number, height: number, pixels: Uint8Array, bpp: number): Buffer {
  if (width <= 0 || height <= 0) throw new Error('编码尺寸非法')
  if (bpp !== 3 && bpp !== 4) throw new Error(`不支持的 bpp: ${bpp}`)
  const stride = width * bpp
  if (pixels.length < stride * height) throw new Error('像素缓冲不足')
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = bpp === 4 ? 6 : 2 // color type
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter method
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 一个待拼接片段：PNG 内容 + 其在整图中的位置（设备像素坐标）与尺寸。 */
export interface PngTile {
  png: Buffer
  x: number
  y: number
  width: number
  height: number
}

/**
 * 把多段 PNG 拼成一张（各段需同宽、同颜色类型；按 x/y 放置，越界裁剪）。
 * 段内像素按「声明尺寸」拷贝；声明尺寸与实际解码不符时以解码为准（并校验）。
 */
export function stitchPng(tiles: PngTile[], totalWidth: number, totalHeight: number): Buffer {
  if (tiles.length === 0) throw new Error('没有可拼接的片段')
  if (totalWidth <= 0 || totalHeight <= 0) throw new Error('拼接目标尺寸非法')
  let bpp = 0
  const decoded = tiles.map((tile): DecodedPng & PngTile => {
    const d = decodePng(tile.png)
    if (d.bpp !== 3 && d.bpp !== 4) throw new Error(`不支持的片段色型: ${d.bpp}`)
    if (bpp === 0) bpp = d.bpp
    else if (d.bpp !== bpp) throw new Error('片段颜色类型不一致')
    if (d.width !== tile.width || d.height !== tile.height) {
      throw new Error(`片段尺寸与声明不符: 实际 ${d.width}x${d.height}，声明 ${tile.width}x${tile.height}`)
    }
    return { ...tile, ...d }
  })
  const out = new Uint8Array(totalWidth * totalHeight * bpp)
  for (const tile of decoded) {
    // 完全落在目标画布之外的段直接跳过（与段自身尺寸无关）
    if (tile.x >= totalWidth || tile.y >= totalHeight) continue
    // 目标可见范围（tile 可能部分越出画布）
    const tx0 = Math.max(0, tile.x)
    const tx1 = Math.min(totalWidth, tile.x + tile.width)
    const ty0 = Math.max(0, tile.y)
    const ty1 = Math.min(totalHeight, tile.y + tile.height)
    if (tx1 <= tx0 || ty1 <= ty0) continue
    const cols = tx1 - tx0
    const srcCol = tx0 - tile.x // 目标列 tx0 对应的源列
    const rowBytes = tile.width * bpp
    for (let ty = ty0; ty < ty1; ty += 1) {
      const srcRow = ty - tile.y // 源行从段顶(0)起，与目标绝对行无关
      const srcStart = srcRow * rowBytes + srcCol * bpp
      const dstStart = (ty * totalWidth + tx0) * bpp
      out.set(tile.pixels.subarray(srcStart, srcStart + cols * bpp), dstStart)
    }
  }
  return encodePng(totalWidth, totalHeight, out, bpp)
}
