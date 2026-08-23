// 调试工具：解压 DSH 会话日志（session.jsonl.zstd，多帧），可过滤事件类型。
// 用法：node scripts/dump-session.mjs <sessionId> [typeFilter ...] [--limit N]
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { join } from 'node:path'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function scanZstdFrames(buf) {
  const frames = []
  let i = 0
  while (i + 4 <= buf.length) {
    if (!buf.subarray(i, i + 4).equals(MAGIC)) break
    const fh = buf[i + 4]
    const single = (fh & 0x20) !== 0
    if (single) break // 简化：数据帧标准格式
    // frame header: 2-18 bytes; 简化扫描：从 magic 到下一个 magic
    let next = buf.indexOf(MAGIC, i + 4)
    if (next === -1) next = buf.length
    frames.push({ start: i, end: next })
    i = next
  }
  return frames
}

const sessionId = process.argv[2]
const filters = process.argv.slice(3).filter(a => !a.startsWith('--'))
const limitArg = process.argv.find(a => a.startsWith('--limit'))
const limit = limitArg ? Number(limitArg.split('=')[1] ?? limitArg.split(' ')[1]) : Infinity

const path = join(process.env.USERPROFILE, '.dsh', 'sessions', '--D-AI-Dsh--', sessionId, 'session.jsonl.zstd')
const buf = readFileSync(path)
const frames = scanZstdFrames(buf)
let out = Buffer.alloc(0)
for (const f of frames) {
  try {
    out = Buffer.concat([out, zstdDecompressSync(buf.subarray(f.start, f.end))])
  } catch (e) {
    console.error('frame decode failed', e.message)
  }
}
const lines = out.toString('utf8').split('\n').filter(l => l.trim() !== '')
let shown = 0
for (const line of lines) {
  let ev
  try { ev = JSON.parse(line) } catch { continue }
  const type = ev.type ?? ''
  if (filters.length > 0 && !filters.includes(type)) continue
  // 精简输出
  const brief = (() => {
    switch (type) {
      case 'session': return JSON.stringify({ type, id: ev.id, header: ev.header })
      case 'user/message': return `seq=${ev.seq} turn=${ev.turn} source=${ev.data?.source?.kind} text=${JSON.stringify(String((ev.data?.content ?? []).map(c => c.text ?? '').join('')).slice(0, 120))}`
      case 'message': return `seq=${ev.seq} kind=${ev.data?.role ?? ''} text=${JSON.stringify(String((ev.data?.content ?? []).map(c => c.text ?? '').join('')).slice(0, 160))}`
      case 'turn/start': return `seq=${ev.seq} turn=${ev.turn}`
      case 'turn/end': return `seq=${ev.seq} turn=${ev.turn}`
      default: return 'seq=' + ev.seq + ' ' + JSON.stringify(Object.keys(ev.data ?? {}))
    }
  })()
  console.log(brief)
  if (++shown >= limit) break
}
