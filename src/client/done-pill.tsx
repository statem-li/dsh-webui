/**
 * webui — 对话完成胶囊（client 半身）。
 *
 * shell.overlay 顶部悬浮胶囊（常驻、可拖拽、位置持久化）：
 *  - 轮询 host 端 /api/webui-done-pill，任一会话（含后台会话）回合完成时
 *    显示「N 个对话完成 · 「会话」摘要」；
 *  - 点击胶囊主体直接跳进最新完成的会话；鼠标悬停时记录面板从下方滑出，
 *    展示每条的用户问题 + 助手回复全文；
 *  - 胶囊右侧内嵌「文件」按钮（事件桥开合文件浏览器抽屉）；
 *  - 整体黑色底（不随主题），按住拖拽可移动位置（pointer 拖拽，4px 阈值
 *    区分点击），位置存 localStorage（dsh.donePill.pos）；
 *  - 基础设置「对话完成胶囊」开关可整体隐藏（dsh.donePill.enabled）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

export type DonePillProps = PropsRuntime<'shell.overlay'>

interface DoneEntry {
  seq: number
  id: string
  sessionId: string
  title: string
  question: string
  answer: string
  endedAt: number
  turn: number
  reasonKind: string
}

/** 轮询间隔（ms）。 */
const POLL_MS = 3000
/** 内存保留条目上限。 */
const MAX_ENTRIES = 100
/** localStorage 已读 id 上限。 */
const MAX_READ_IDS = 300

const READ_KEY = 'dsh.donePill.read'
const POS_KEY = 'dsh.donePill.pos'
const ENABLED_KEY = 'dsh.donePill.enabled'

// 运行时会话服务（点击跳转会话用；未提供时降级为不可跳转）。
let sessionsRuntime: { open(id: SessionId): void } | undefined

// ---- localStorage 工具 ----
// 持久化：已读 id 集合、胶囊位置、显隐开关；完成记录每次页面加载从 host
// 全量拉取恢复（host 保留最近 MAX_ITEMS 条），增量水位仅存内存。

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === 'string'))
    }
  } catch { /* 忽略 */ }
  return new Set()
}

function saveReadIds(ids: Set<string>): void {
  try {
    const arr = [...ids]
    localStorage.setItem(READ_KEY, JSON.stringify(arr.length > MAX_READ_IDS ? arr.slice(-MAX_READ_IDS) : arr))
  } catch { /* 忽略 */ }
}

interface PillPos { x: number; y: number }

/** 持久化的位置锚点：胶囊**中心点**的视口比率（0~1）。以中心为锚，
 *  内容扩宽/收窄、窗口缩放/最大化时都向两侧对称伸缩，不会只往一边跑。 */
interface PillAnchor { xc: number; yc: number }

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** 把位置夹回视口内并取整（防拖出屏幕；非整数像素会让文字发糊）。 */
function clampPos(x: number, y: number): PillPos {
  const margin = 8
  const maxX = Math.max(margin, window.innerWidth - 160)
  const maxY = Math.max(margin, window.innerHeight - 56)
  return {
    x: Math.round(Math.min(Math.max(x, margin), maxX)),
    y: Math.round(Math.min(Math.max(y, margin), maxY)),
  }
}

/** localStorage 里可能出现过的全部历史格式字段。 */
type ParsedAnchor = Partial<PillAnchor & PillPos & { xr: number; yr: number }>

function loadAnchor(): PillAnchor | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as ParsedAnchor
      // 新格式：中心点视口比率。
      if (typeof parsed?.xc === 'number' && Number.isFinite(parsed.xc)
        && typeof parsed?.yc === 'number' && Number.isFinite(parsed.yc)) {
        return { xc: clamp01(parsed.xc), yc: clamp01(parsed.yc) }
      }
      // 更旧格式（左上角比率）：一次性迁移为中心点比率（按估宽 160 补正）。
      if (typeof parsed?.xr === 'number' && typeof parsed?.yr === 'number'
        && Number.isFinite(parsed.xr) && Number.isFinite(parsed.yr)) {
        return { xc: clamp01((parsed.xr * window.innerWidth + 80) / window.innerWidth), yc: clamp01(parsed.yr) }
      }
      // 最旧格式（绝对像素）：迁移为中心点比率。
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number'
        && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
        && window.innerWidth > 0 && window.innerHeight > 0) {
        return {
          xc: clamp01((parsed.x + 80) / window.innerWidth),
          yc: clamp01((parsed.y + 15) / window.innerHeight),
        }
      }
    }
  } catch { /* 忽略 */ }
  return null
}

function saveAnchor(anchor: PillAnchor): void {
  try { localStorage.setItem(POS_KEY, JSON.stringify(anchor)) } catch { /* 忽略 */ }
}

/** 中心锚点 → 当前视口下的左上角坐标（shellWidth 为当前渲染宽度）。 */
function anchorToPos(anchor: PillAnchor, shellWidth: number): PillPos {
  return clampPos(
    Math.round(anchor.xc * window.innerWidth - shellWidth / 2),
    Math.round(anchor.yc * window.innerHeight - 15),
  )
}

// ---- 健康提醒（休息时间段 / 凌晨提示）----

const REST_KEY = 'dsh.donePill.rest'
const LATE_KEY = 'dsh.donePill.late'

interface ReminderConfig {
  /** 是否启用该提醒。 */
  enabled: boolean
  /** 开始 "HH:mm"。 */
  start: string
  /** 结束 "HH:mm"（早于 start 表示跨午夜，如 22:00-07:00）。 */
  end: string
}

/** 提醒配置 store（localStorage 持久化）。 */
interface ReminderStore {
  get: () => ReminderConfig
  set: (next: ReminderConfig) => void
  subscribe: (fn: (next: ReminderConfig) => void) => () => void
}

function createReminderStore(key: string, defaults: ReminderConfig): ReminderStore {
  let value: ReminderConfig = { ...defaults }
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<ReminderConfig>
      value = {
        enabled: parsed?.enabled === true,
        start: typeof parsed?.start === 'string' && /^\d{2}:\d{2}$/.test(parsed.start) ? parsed.start : defaults.start,
        end: typeof parsed?.end === 'string' && /^\d{2}:\d{2}$/.test(parsed.end) ? parsed.end : defaults.end,
      }
    }
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: ReminderConfig) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const restStore = createReminderStore(REST_KEY, { enabled: false, start: '13:00', end: '14:00' })
const lateStore = createReminderStore(LATE_KEY, { enabled: true, start: '00:00', end: '07:00' })

/** "HH:mm" → 当日分钟数；非法返回 null。 */
function parseHM(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm)
  if (match === null) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

/** 当前时刻是否落在 [start, end) 内；start === end 视为永不；跨午夜（start > end）取并集。 */
function inTimeRange(nowMinutes: number, config: ReminderConfig): boolean {
  const s = parseHM(config.start)
  const e = parseHM(config.end)
  if (s === null || e === null || s === e) return false
  return s < e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e
}

// ---- 平时轮播：开心话术 + AI 名词小知识 ----

type FunIconKind = 'sparkle' | 'bulb'

interface FunLine {
  icon: FunIconKind
  text: string
}

const FUN_LINES: FunLine[] = [
  { icon: 'sparkle', text: '今天也是充满可能的一天！' },
  { icon: 'sparkle', text: '你解决问题的样子真的很酷' },
  { icon: 'sparkle', text: '每一行代码都在靠近目标' },
  { icon: 'sparkle', text: '休息一下，灵感往往在放松时出现' },
  { icon: 'sparkle', text: '已完成的每一个任务都算数' },
  { icon: 'sparkle', text: '保持好奇，世界会给你答案' },
  { icon: 'sparkle', text: '进步不必巨大，持续就很了不起' },
  { icon: 'sparkle', text: '深呼吸，一切都会顺利的' },
  { icon: 'sparkle', text: '记得喝水，身体是革命的本钱' },
  { icon: 'sparkle', text: '星光不问赶路人，时光不负有心人' },
  { icon: 'sparkle', text: '小步前进也是一种抵达' },
  { icon: 'sparkle', text: '你的努力，时间看得见' },
  { icon: 'sparkle', text: '笑一笑，bug 都会少一点' },
  { icon: 'bulb', text: 'LLM 大语言模型：通过海量文本训练、能理解并生成自然语言的 AI 模型' },
  { icon: 'bulb', text: 'Token 词元：模型处理文本的最小单位，一个汉字通常是 1~2 个 token' },
  { icon: 'bulb', text: 'Transformer：2017 年提出的神经网络架构，注意力机制让它成为现代 AI 的基石' },
  { icon: 'bulb', text: 'Prompt 提示词：你发给 AI 的指令——写得越清晰，回答越靠谱' },
  { icon: 'bulb', text: '微调 Fine-tuning：用特定数据继续训练模型，让它更擅长某个领域' },
  { icon: 'bulb', text: 'RAG 检索增强生成：先查资料再回答，让 AI 的答案有据可依' },
  { icon: 'bulb', text: '幻觉 Hallucination：AI 一本正经编造不存在的事实——重要信息记得核实' },
  { icon: 'bulb', text: '多模态 Multimodal：能同时理解文字、图片、音频等多种信息的模型' },
  { icon: 'bulb', text: 'Agent 智能体：能自主规划步骤、调用工具、完成任务的 AI' },
  { icon: 'bulb', text: '上下文窗口：模型一次能「看到」的最大文本长度，超出的部分它就忘了' },
  { icon: 'bulb', text: '温度 Temperature：控制回答随机性的参数——越低越严谨，越高越发散' },
  { icon: 'bulb', text: 'Embedding 向量嵌入：把文字变成数字向量，让计算机能计算语义相似度' },
  { icon: 'bulb', text: '思维链 Chain-of-Thought：让 AI 一步步推理，复杂问题的正确率明显提升' },
  { icon: 'bulb', text: '蒸馏 Distillation：用大模型的输出教出小模型——更快更便宜，能力保留大半' },
  { icon: 'bulb', text: '对齐 Alignment：让 AI 行为符合人类意图与价值观的研究方向' },
  { icon: 'bulb', text: 'RLHF：基于人类反馈的强化学习，ChatGPT 变好聊的关键技术' },
]

/** 轮播间隔（ms）。 */
const FUN_INTERVAL_MS = 15000

// ---- 胶囊外观（大小缩放 + 字体风格）----

const APPEARANCE_KEY = 'dsh.donePill.appearance'

interface AppearanceConfig {
  /** 缩放系数：0.8 ~ 1.6（1 = 默认）。 */
  scale: number
  /** 字体方案 id。 */
  font: string
}

/** 字体方案（Windows 常见字体栈）。 */
const FONT_OPTIONS: Array<{ id: string; label: string; stack: string }> = [
  { id: 'system', label: '跟随系统', stack: '' },
  { id: 'yahei', label: '雅黑', stack: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { id: 'songti', label: '宋体 · 衬线', stack: "SimSun, 'Songti SC', serif" },
  { id: 'kaiti', label: '楷体 · 手写感', stack: "KaiTi, 'Kaiti SC', cursive" },
  { id: 'simhei', label: '黑体 · 厚重', stack: 'SimHei, sans-serif' },
  { id: 'mono', label: '等宽 · 代码', stack: "Consolas, 'Courier New', monospace" },
  { id: 'cute', label: '可爱 · 圆润', stack: "'Yuanti SC', 'YouYuan', '幼圆', 'HYWenHei-85W', 'Microsoft YaHei', sans-serif" },
  { id: 'comic', label: '可爱 · 漫画', stack: "'Comic Sans MS', 'Comic Neue', 'Segoe UI', cursive" },
]

function fontStackOf(id: string): string {
  return FONT_OPTIONS.find(option => option.id === id)?.stack ?? ''
}

interface AppearanceStore {
  get: () => AppearanceConfig
  set: (next: AppearanceConfig) => void
  subscribe: (fn: (next: AppearanceConfig) => void) => () => void
}

function createAppearanceStore(key: string): AppearanceStore {
  let value: AppearanceConfig = { scale: 1, font: 'system' }
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<AppearanceConfig>
      value = {
        scale: typeof parsed?.scale === 'number' && Number.isFinite(parsed.scale)
          ? Math.min(1.6, Math.max(0.8, parsed.scale))
          : 1,
        font: typeof parsed?.font === 'string' ? parsed.font : 'system',
      }
    }
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: AppearanceConfig) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const appearanceStore = createAppearanceStore(APPEARANCE_KEY)

/** 显隐开关 store（localStorage 持久化，默认显示）。 */
function createEnabledStore(): {
  get: () => boolean
  set: (next: boolean) => void
  subscribe: (fn: (next: boolean) => void) => () => void
} {
  let value = true
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    if (raw === '0' || raw === 'false') value = false
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: boolean) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(ENABLED_KEY, next ? '1' : '0') } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const enabledStore = createEnabledStore()

// ---- 展示工具 ----

function formatTime(ts: number): string {
  if (ts <= 0) return ''
  const d = new Date(ts)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${mo}-${day} ${hh}:${mm}`
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/** 执行时长（实时跳动）：mm:ss，超过 1 小时 h:mm:ss。 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/** 请求开合文件浏览器抽屉（FileExplorerEntry 监听同一事件）。 */
function toggleFileExplorer(): void {
  window.dispatchEvent(new CustomEvent('dsh-file-explorer-toggle'))
}

/** 逐字符淡入的 keyframes（一次性注入）。 */
function ensurePillKeyframes(): void {
  if (document.getElementById('dsh-done-pill-kf') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-done-pill-kf'
  style.textContent = '@keyframes dpCharIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}'
  document.head.appendChild(style)
}

// ---- 样式（黑色系固定配色：黑底白字，不随主题翻转）----
// 尺寸缩放：wrap 上注入 --dps（缩放系数），核心尺寸用 calc 等比缩放，
// 字体随之变大变小；不用 transform scale（非整数渲染会发糊）。

/** 悬停容器：包住胶囊 + 滑出面板，保证两者间移动鼠标不丢 hover；也是拖拽手柄。 */
const wrapStyle = (dragging: boolean, pos: PillPos | null, scale: number, fontStack: string): CSSProperties => ({
  position: 'fixed',
  // pos 恒为整数像素（挂载后由 useLayoutEffect 把居中模式换算成整数坐标）：
  // translateX(-50%) 居中会落在半像素上，文字亚像素渲染发糊。
  // null 仅存在于首帧（绘制前即被 useLayoutEffect 修正）。
  ...(pos === null
    ? { top: 40, left: '50%', transform: 'translateX(-50%)' }
    : { top: pos.y, left: pos.x }),
  zIndex: 9400,
  cursor: dragging ? 'grabbing' : 'grab',
  userSelect: 'none',
  touchAction: 'none',
  ...(fontStack !== '' ? { fontFamily: fontStack } : {}),
  '--dps': String(scale),
  // 底部内衬：面板贴着它定位（top:100%），胶囊与面板之间的 8px 视觉缝隙
  // 落在容器内，鼠标滑过去不会触发 mouseleave。
  paddingBottom: 'calc(8px * var(--dps))',
} as unknown as CSSProperties)

/** 胶囊外壳：透明背景 + 细描边外圈（融入页面），宽度受控 + 过渡。 */
const pillShellStyle = (unread: number, width: number | null): CSSProperties => ({
  display: 'flex',
  alignItems: 'stretch',
  height: 'calc(30px * var(--dps))',
  maxWidth: 'min(720px, calc(100vw - 48px))',
  ...(width !== null ? { width } : {}),
  borderRadius: 'calc(15px * var(--dps))',
  border: '1px solid rgba(255,255,255,.16)',
  background: 'transparent',
  color: unread > 0 ? '#ffffff' : 'rgba(255,255,255,.74)',
  fontSize: 'calc(12px * var(--dps))',
  lineHeight: 'calc(18px * var(--dps))',
  fontWeight: unread > 0 ? 500 : 400,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  transition: 'width .28s ease',
})

/** 胶囊主体（点击 = 进入最新完成的会话；按住拖动 = 移动胶囊）。 */
const pillMainStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(7px * var(--dps))',
  minWidth: 0,
  padding: '0 calc(10px * var(--dps)) 0 calc(14px * var(--dps))',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontWeight: 'inherit',
  cursor: 'inherit',
  overflow: 'hidden',
}

/** ✓ 状态点：未读 = 品牌蓝底白勾；已读 = 深灰底绿勾。 */
const checkIconStyle = (unread: number): CSSProperties => ({
  flex: 'none',
  width: 'calc(15px * var(--dps))',
  height: 'calc(15px * var(--dps))',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  lineHeight: 1,
  background: unread > 0 ? 'var(--dsw-alias-state-business-primary)' : 'rgba(255,255,255,.10)',
  color: unread > 0 ? '#ffffff' : '#34c759',
})

/** 健康提醒态图标（月亮 / 咖啡）：单色 SVG。 */
const reminderIconStyle: CSSProperties = {
  flex: 'none',
  width: 'calc(15px * var(--dps))',
  height: 'calc(15px * var(--dps))',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

/** 健康提醒徽章：时段内常驻最左侧，黄字不挤占完成通知。 */
const reminderBadgeStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(5px * var(--dps))',
  padding: '0 calc(10px * var(--dps)) 0 calc(14px * var(--dps))',
  color: '#f5c542',
  fontSize: 'calc(12px * var(--dps))',
  lineHeight: 'calc(18px * var(--dps))',
  fontWeight: 500,
}

type ReminderIconKind = 'moon' | 'coffee'

/** 单色线性图标（currentColor 跟随胶囊文字色）。 */
function LineIcon(props: { kind: 'sparkle' | 'bulb' | 'moon' | 'coffee'; size?: number }): JSX.Element {
  const size = props.size ?? 13
  if (props.kind === 'sparkle') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ flex: 'none' }}>
        <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
      </svg>
    )
  }
  if (props.kind === 'bulb') {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}
      >
        <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
        <line x1="9" y1="18" x2="15" y2="18" />
        <line x1="10" y1="21" x2="14" y2="21" />
      </svg>
    )
  }
  if (props.kind === 'moon') {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    )
  }
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}
    >
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <line x1="7" y1="2" x2="7" y2="5" />
      <line x1="12" y1="2" x2="12" y2="5" />
    </svg>
  )
}

/** 主体与文件钮之间的细分隔线。 */
const pillDividerStyle: CSSProperties = {
  flex: 'none',
  width: 1,
  margin: 'calc(7px * var(--dps)) 0',
  background: 'rgba(255,255,255,.16)',
}

/** 胶囊右侧「文件」按钮：点击打开文件浏览器抽屉。 */
const fileButtonStyle = (hovered: boolean): CSSProperties => ({
  flex: 'none',
  width: 'calc(30px * var(--dps))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 0,
  background: hovered ? 'rgba(255,255,255,.14)' : 'transparent',
  color: 'rgba(255,255,255,.74)',
  cursor: 'pointer',
})

/** shell 直接子项统一禁止收缩：宽度测量（子块求和）才不受受控宽度污染。 */
const shellChildStyle: CSSProperties = { flex: 'none' }

/** 记录面板宽度（视口溢出保护计算用）。 */
const DONE_PANEL_W = 600
/** 运行中任务面板宽度。 */
const RUN_PANEL_W = 320

/** 记录面板：黑色浮层，悬停时从胶囊下方滑出（opacity + translateY 过渡）。 */
const panelStyle = (open: boolean, shiftX: number): CSSProperties => ({
  position: 'absolute',
  top: '100%',
  left: shiftX,
  width: `min(${DONE_PANEL_W}px, calc(100vw - 24px))`,
  maxHeight: 'min(66vh, 600px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,.14)',
  background: 'rgba(12,12,13,.94)',
  boxShadow: '0 16px 44px rgba(0,0,0,.5)',
  opacity: open ? 1 : 0,
  transform: `translateY(${open ? 0 : -8}px)`,
  visibility: open ? 'visible' : 'hidden',
  pointerEvents: open ? 'auto' : 'none',
  // 收起时 visibility 延迟到过渡结束再隐藏，滑出动画才完整可见。
  transition: open
    ? 'opacity .18s ease, transform .18s ease, visibility 0s'
    : 'opacity .18s ease, transform .18s ease, visibility 0s linear .18s',
})

/** 运行中任务面板：从胶囊下方滑出的窄列表。 */
const runPanelStyle = (open: boolean, shiftX: number): CSSProperties => ({
  position: 'absolute',
  top: '100%',
  left: shiftX,
  width: `min(${RUN_PANEL_W}px, calc(100vw - 24px))`,
  maxHeight: 'min(60vh, 480px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 10,
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,.14)',
  background: 'rgba(12,12,13,.94)',
  boxShadow: '0 16px 44px rgba(0,0,0,.5)',
  opacity: open ? 1 : 0,
  transform: `translateY(${open ? 0 : -8}px)`,
  visibility: open ? 'visible' : 'hidden',
  pointerEvents: open ? 'auto' : 'none',
  transition: open
    ? 'opacity .18s ease, transform .18s ease, visibility 0s'
    : 'opacity .18s ease, transform .18s ease, visibility 0s linear .18s',
})

/** 胶囊左侧「运行中」区块：黄点 + 数量，悬停滑出任务列表。 */
const runningBlockStyle = (hasRunning: boolean): CSSProperties => ({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(6px * var(--dps))',
  padding: '0 calc(10px * var(--dps)) 0 calc(14px * var(--dps))',
  border: 'none',
  background: 'transparent',
  color: hasRunning ? '#ffffff' : 'rgba(255,255,255,.55)',
  font: 'inherit',
  fontWeight: hasRunning ? 500 : 400,
  cursor: 'pointer',
})

const runDotStyle: CSSProperties = {
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#f5a623',
  boxShadow: '0 0 6px rgba(245,166,35,.7)',
}

const runRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 8px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: '#e8e8ec',
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'left',
  cursor: 'pointer',
}

const runRowTitleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const runRowTagStyle: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  color: '#f5a623',
}

/** 运行中任务的实时执行时长（等宽数字避免跳动）。 */
const runRowTimeStyle: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  color: '#9a9aa2',
  fontVariantNumeric: 'tabular-nums',
}

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '2px 2px 6px',
  borderBottom: '1px solid rgba(255,255,255,.12)',
}

const headTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#f2f2f4',
}

const headMetaStyle: CSSProperties = {
  fontSize: 11,
  color: '#9a9aa2',
}

const cardStyle: CSSProperties = {
  border: 'none',
  borderRadius: 12,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  cursor: 'pointer',
  background: 'transparent',
}

const cardHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
}

const unreadDotStyle: CSSProperties = {
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--dsw-alias-state-business-primary)',
}

const sessionTitleStyle: CSSProperties = {
  flex: 'none',
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  fontWeight: 500,
  color: '#ffffff',
}

const metaStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: 'right',
  fontSize: 11,
  color: '#9a9aa2',
  whiteSpace: 'nowrap',
}

const closeStyle: CSSProperties = {
  flex: 'none',
  width: 20,
  height: 20,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: '#9a9aa2',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
}

const answerStyle: CSSProperties = {
  margin: 0,
  maxHeight: 240,
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 12,
  lineHeight: '19px',
  color: '#e8e8ec',
  borderTop: '1px dashed rgba(255,255,255,.14)',
  paddingTop: 6,
}

const errorTagStyle: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  color: '#f5a623',
}

const emptyStyle: CSSProperties = {
  padding: '18px 8px',
  textAlign: 'center',
  fontSize: 12,
  color: '#8a8a92',
}

// ---- 基础设置行（与 General 区条目一致的 Setting-Cell 布局）----

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const rowTextStyle: CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48,
}
const rowTitleStyle: CSSProperties = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const rowDescStyle: CSSProperties = { fontSize: 12, fontWeight: 400, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }

function switchStyle(on: boolean): CSSProperties {
  return {
    position: 'relative', flex: 'none', width: 40, height: 22, padding: 0,
    border: 'none', borderRadius: 11, cursor: 'pointer',
    // 开启态用品牌蓝（不能用反色的 brand-primary）；关闭态描边底 + 灰钮。
    background: on ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-bg-module-platform)',
    transition: 'background .15s',
  }
}
function knobStyle(on: boolean): CSSProperties {
  return {
    position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18,
    borderRadius: '50%', background: on ? '#ffffff' : 'var(--dsw-alias-label-tertiary)',
    transition: 'left .15s, background .15s',
  }
}

/** 基础设置行：对话完成胶囊显隐开关。 */
function DonePillRow(): JSX.Element {
  const [on, setOn] = useState(enabledStore.get())
  useEffect(() => enabledStore.subscribe(setOn), [])

  function toggle(): void {
    enabledStore.set(!enabledStore.get())
  }

  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>对话完成胶囊</div>
        <div style={rowDescStyle}>顶部悬浮胶囊：对话完成提醒、快速跳转与文件入口；关闭后完全隐藏</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="对话完成胶囊"
        onClick={toggle}
        style={switchStyle(on)}
      >
        <span style={knobStyle(on)} />
      </button>
    </div>
  )
}

const timeInputStyle: CSSProperties = {
  flex: 'none',
  width: 96,
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  lineHeight: '22px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
}

const timeDashStyle: CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
}

/** 提醒设置行通用骨架：开关 + 可编辑时间段。 */
function ReminderRow(props: {
  titleText: string
  descText: string
  store: ReminderStore
}): JSX.Element {
  const { titleText, descText, store } = props
  const [config, setConfig] = useState<ReminderConfig>(() => store.get())
  useEffect(() => store.subscribe(setConfig), [])

  function update(patch: Partial<ReminderConfig>): void {
    store.set({ ...store.get(), ...patch })
  }

  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>{titleText}</div>
        <div style={rowDescStyle}>{descText}</div>
      </div>
      <input
        type="time"
        value={config.start}
        disabled={!config.enabled}
        aria-label={`${titleText}开始时间`}
        onChange={(event) => { if (event.target.value !== '') update({ start: event.target.value }) }}
        style={{ ...timeInputStyle, opacity: config.enabled ? 1 : 0.45 }}
      />
      <span style={timeDashStyle}>—</span>
      <input
        type="time"
        value={config.end}
        disabled={!config.enabled}
        aria-label={`${titleText}结束时间`}
        onChange={(event) => { if (event.target.value !== '') update({ end: event.target.value }) }}
        style={{ ...timeInputStyle, opacity: config.enabled ? 1 : 0.45 }}
      />
      <button
        type="button"
        role="switch"
        aria-checked={config.enabled}
        aria-label={titleText}
        onClick={() => { update({ enabled: !config.enabled }) }}
        style={{ ...switchStyle(config.enabled), marginLeft: 8 }}
      >
        <span style={knobStyle(config.enabled)} />
      </button>
    </div>
  )
}

const selectInputStyle: CSSProperties = {
  flex: 'none',
  width: 132,
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  appearance: 'none',
  cursor: 'pointer',
}

const sizeSliderStyle: CSSProperties = {
  flex: 'none',
  width: 160,
  accentColor: 'var(--dsw-alias-state-business-primary)',
  cursor: 'pointer',
}

const sliderValueStyle: CSSProperties = {
  flex: 'none',
  width: 44,
  textAlign: 'right',
  fontSize: 13,
  color: 'var(--dsw-alias-label-secondary)',
  fontVariantNumeric: 'tabular-nums',
}

/** 基础设置行：胶囊大小（字体等比跟随）。 */
function PillScaleRow(): JSX.Element {
  const [config, setConfig] = useState<AppearanceConfig>(() => appearanceStore.get())
  useEffect(() => appearanceStore.subscribe(setConfig), [])
  const percent = Math.round(config.scale * 100)
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>胶囊大小</div>
        <div style={rowDescStyle}>整体缩放胶囊，字体与图标等比跟随（80% – 160%）</div>
      </div>
      <input
        type="range"
        min={80}
        max={160}
        step={5}
        value={percent}
        aria-label="胶囊大小"
        onChange={(event) => { appearanceStore.set({ ...appearanceStore.get(), scale: Number(event.target.value) / 100 }) }}
        style={sizeSliderStyle}
      />
      <span style={sliderValueStyle}>{`${percent}%`}</span>
    </div>
  )
}

/** 基础设置行：胶囊字体风格。 */
function PillFontRow(): JSX.Element {
  const [config, setConfig] = useState<AppearanceConfig>(() => appearanceStore.get())
  useEffect(() => appearanceStore.subscribe(setConfig), [])
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>胶囊字体</div>
        <div style={rowDescStyle}>胶囊与面板文字的字体风格</div>
      </div>
      <select
        value={config.font}
        aria-label="胶囊字体"
        onChange={(event) => { appearanceStore.set({ ...appearanceStore.get(), font: event.target.value }) }}
        style={selectInputStyle}
      >
        {FONT_OPTIONS.map(option => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

// ---- 组件 ----

interface DragState {
  px: number
  py: number
  ox: number
  oy: number
  moved: boolean
}

/** 顶部悬浮「对话完成」胶囊：点击进会话、悬停滑出记录、可拖拽、常驻显示。 */
export function DonePill(props: DonePillProps): JSX.Element | null {
  const { useSessions } = props
  const byId = useSessions(state => state.byId)

  const [entries, setEntries] = useState<DoneEntry[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds())
  const [hovered, setHovered] = useState(false)
  const [hoveredRunning, setHoveredRunning] = useState(false)
  const [fileHovered, setFileHovered] = useState(false)
  const [enabled, setEnabled] = useState(enabledStore.get())
  // 注意：initializer 里不能引用下方才声明的 anchorRef（TDZ），直接读存储。
  const [pos, setPos] = useState<PillPos | null>(() => {
    const anchor = loadAnchor()
    // 挂载前无法测实际宽度，用估算宽度 160 定位；挂载后宽度同步 effect 会按中心重放一次。
    return anchor === null ? null : anchorToPos(anchor, 160)
  })
  const [dragging, setDragging] = useState(false)
  // 正在执行回合的信息（host 下发）：sessionId → { since, question }，
  // question = 当前正在执行的那条用户消息，供任务列表展示。
  const [runInfo, setRunInfo] = useState<Record<string, { since: number; question: string }>>({})
  // 实时时钟：任务面板展开时每秒走字。
  const [nowTick, setNowTick] = useState(() => Date.now())
  // 健康提醒时钟：每 30 秒刷新当前分钟，判断是否落在提醒时段内。
  const [reminderTick, setReminderTick] = useState(0)
  const [restConfig, setRestConfig] = useState<ReminderConfig>(() => restStore.get())
  const [lateConfig, setLateConfig] = useState<ReminderConfig>(() => lateStore.get())
  // 外观：缩放系数 + 字体风格。
  const [appearance, setAppearance] = useState<AppearanceConfig>(() => appearanceStore.get())
  const scale = appearance.scale
  // 平时轮播：随机开心话术 / AI 名词的下标。
  const [funIdx, setFunIdx] = useState(() => Math.floor(Math.random() * FUN_LINES.length))
  // 胶囊宽度受控值（跟随内容自然宽度平滑过渡）。
  const [shellWidth, setShellWidth] = useState<number | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const shellWidthRef = useRef<number | null>(null)
  // 增量水位仅存内存：首次 tick 用 0 全量拉（恢复最近记录），之后增量。
  const sinceRef = useRef(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)

  // 设置开关：关闭即整体隐藏。
  useEffect(() => enabledStore.subscribe(setEnabled), [])
  useEffect(() => restStore.subscribe(setRestConfig), [])
  useEffect(() => lateStore.subscribe(setLateConfig), [])
  useEffect(() => appearanceStore.subscribe(setAppearance), [])
  // 逐字符淡入动画的 keyframes（一次性注入）。
  useEffect(() => { ensurePillKeyframes() }, [])
  useEffect(() => {
    setReminderTick(t => t + 1)
    const timer = window.setInterval(() => { setReminderTick(t => t + 1) }, 30000)
    return () => { window.clearInterval(timer) }
  }, [])

  // 健康提醒激活判断（reminderTick 每 30 秒变化触发重算）。
  const nowMinutes = (() => {
    const d = new Date()
    void reminderTick
    return d.getHours() * 60 + d.getMinutes()
  })()
  const lateActive = lateConfig.enabled && inTimeRange(nowMinutes, lateConfig)
  const restActive = !lateActive && restConfig.enabled && inTimeRange(nowMinutes, restConfig)
  const reminderActive = lateActive || restActive

  // 自动居中模式（从未手动拖拽过）：胶囊宽度随文字变化（任务完成时变长），
  // 固定 left 会偏离居中——用 ResizeObserver 跟随宽度实时重算水平居中，
  // 并保持整数像素（translateX(-50%) 的半像素会让文字发糊）。
  // 一旦用户拖拽（onPointerUp moved），autoCenterRef 置 false，锁定锚点位置。
  const anchorRef = useRef<PillAnchor | null>(loadAnchor())
  const autoCenterRef = useRef(anchorRef.current === null)

  // 锁定模式：窗口尺寸变化 / 内容宽度变化时按**中心锚点**比率还原位置
  // （小窗拖到中间、最大化后仍在中间；宽度伸缩时向两侧对称扩缩）。
  const applyAnchor = useCallback((): void => {
    if (autoCenterRef.current) return
    const anchor = anchorRef.current
    if (anchor === null) return
    const el = shellRef.current
    const w = el !== null ? el.getBoundingClientRect().width : 160
    const next = anchorToPos(anchor, w)
    // 相等性检查：位置没变就不产生新 state（否则每渲染循环 setPos 无限重渲染）。
    setPos(prev => (prev !== null && prev.x === next.x && prev.y === next.y ? prev : next))
  }, [])
  useEffect(() => {
    const onResize = (): void => { applyAnchor() }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [applyAnchor])
  useLayoutEffect(() => {
    if (!autoCenterRef.current) return
    const el = wrapRef.current
    if (el === null) return
    const recenter = (): void => {
      if (!autoCenterRef.current) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      const x = Math.max(8, Math.round((window.innerWidth - rect.width) / 2))
      setPos(prev => {
        const next = { x, y: prev?.y ?? 40 }
        return prev !== null && prev.x === next.x && prev.y === next.y ? prev : next
      })
    }
    recenter()
    const observer = new ResizeObserver(recenter)
    observer.observe(el)
    window.addEventListener('resize', recenter)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', recenter)
    }
  }, [])

  // 合并新条目：按 id 去重、降序、截断上限。
  const mergeEntries = useCallback((incoming: DoneEntry[]): void => {
    if (incoming.length === 0) return
    setEntries(prev => {
      const seen = new Set(prev.map(item => item.id))
      const merged = [...prev]
      for (const item of incoming) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        merged.push(item)
      }
      merged.sort((a, b) => b.seq - a.seq)
      return merged.length > MAX_ENTRIES ? merged.slice(0, MAX_ENTRIES) : merged
    })
  }, [])

  // 轮询 host：增量拉取完成记录；页面隐藏时跳过，回前台立即补一轮。
  useEffect(() => {
    let stopped = false
    const tick = (): void => {
      if (document.hidden) return
      fetch(`/api/webui-done-pill?since=${sinceRef.current}`, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) throw new Error(`http ${res.status}`)
          return res.json() as Promise<{ ok: boolean; version: number; items: DoneEntry[]; running?: Array<{ sessionId: string; since: number; question?: string }> }>
        })
        .then((data) => {
          if (stopped || data?.ok !== true || !Array.isArray(data.items)) return
          sinceRef.current = Math.max(sinceRef.current, typeof data.version === 'number' ? data.version : 0)
          mergeEntries(data.items.filter(item => item !== null && typeof item === 'object' && typeof item.id === 'string'))
          if (Array.isArray(data.running)) {
            const next: Record<string, { since: number; question: string }> = {}
            for (const entry of data.running) {
              if (entry !== null && typeof entry === 'object'
                && typeof entry.sessionId === 'string' && typeof entry.since === 'number') {
                next[entry.sessionId] = {
                  since: entry.since,
                  question: typeof entry.question === 'string' ? entry.question : '',
                }
              }
            }
            setRunInfo(next)
          }
        })
        .catch(() => { /* 服务暂不可达时静默，下轮重试 */ })
    }
    tick()
    const timer = window.setInterval(tick, POLL_MS)
    const onVisibility = (): void => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mergeEntries])

  const unreadCount = useMemo(() => entries.filter(item => !readIds.has(item.id)).length, [entries, readIds])
  const latest = entries[0]

  // 平时轮播（无健康提醒、无未读时）：每 15 秒随机换一条开心话术 / AI 名词。
  const funIdle = !reminderActive && unreadCount === 0
  useEffect(() => {
    if (!funIdle) return
    const timer = window.setInterval(() => {
      setFunIdx(prev => {
        let next = Math.floor(Math.random() * FUN_LINES.length)
        if (next === prev) next = (next + 1) % FUN_LINES.length
        return next
      })
    }, FUN_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [funIdle])

  // 正在执行中的任务 = running 的非 subagent 会话（与完成列表口径一致），
  // 按最近更新时间降序。
  const runningSessions = useMemo(() => (
    Object.values(byId)
      .filter(session => session.running === true && session.origin !== 'subagent')
      .sort((a, b) => b.updatedAt - a.updatedAt)
  ), [byId])

  const markAllRead = useCallback((): void => {
    setReadIds(prev => {
      const next = new Set(prev)
      for (const item of entries) next.add(item.id)
      saveReadIds(next)
      return next.size === prev.size ? prev : next
    })
  }, [entries])

  // 悬停展开面板 = 全部已读（胶囊转低调态）。
  useEffect(() => {
    if (hovered) markAllRead()
  }, [hovered, markAllRead])

  // 实时时钟：运行中任务面板展开时每秒刷新，时长走字。
  useEffect(() => {
    if (!hoveredRunning || runningSessions.length === 0) return
    setNowTick(Date.now())
    const timer = window.setInterval(() => { setNowTick(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [hoveredRunning, runningSessions.length])

  const dismiss = useCallback((id: string): void => {
    setEntries(prev => prev.filter(item => item.id !== id))
    setReadIds(prev => {
      const next = new Set(prev)
      next.add(id)
      saveReadIds(next)
      return next
    })
  }, [])

  const openSession = useCallback((sessionId: string, markReadId?: string): void => {
    try { sessionsRuntime?.open(sessionId as SessionId) } catch { /* 会话可能已不在列表 */ }
    if (markReadId !== undefined) {
      setReadIds(prev => {
        if (prev.has(markReadId)) return prev
        const next = new Set(prev)
        next.add(markReadId)
        saveReadIds(next)
        return next
      })
    }
    setHovered(false)
  }, [])

  // ---- 拖拽（pointer 事件；4px 阈值区分点击与拖动）----

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const el = wrapRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { px: event.clientX, py: event.clientY, ox: rect.left, oy: rect.top, moved: false }
    try { el.setPointerCapture(event.pointerId) } catch { /* 合成事件等场景无有效 pointerId，忽略 */ }
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = event.clientX - drag.px
    const dy = event.clientY - drag.py
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    if (!drag.moved) {
      drag.moved = true
      setDragging(true)
      setHovered(false)
      setHoveredRunning(false)
    }
    setPos(clampPos(drag.ox + dx, drag.oy + dy))
  }, [])

  const onPointerUp = useCallback((): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag === null) return
    if (drag.moved) {
      // 用户手动拖拽：退出自动居中，按**胶囊中心点**的视口比率持久化锚点
      // （窗口缩放、内容伸缩时以中心为基准向两侧对称变化）。
      autoCenterRef.current = false
      setDragging(false)
      setPos(current => {
        if (current !== null) {
          const el = shellRef.current
          const w = el !== null ? el.getBoundingClientRect().width : 160
          const anchor: PillAnchor = {
            xc: clamp01((current.x + w / 2) / Math.max(1, window.innerWidth)),
            yc: clamp01((current.y + 15) / Math.max(1, window.innerHeight)),
          }
          anchorRef.current = anchor
          saveAnchor(anchor)
        }
        return current
      })
      return
    }
    // 未超过阈值 = 点击：进入最新完成的会话。
    if (latest !== undefined) openSession(latest.sessionId, unreadCount > 0 ? latest.id : undefined)
  }, [latest, openSession, unreadCount])

  const latestTitle = latest !== undefined
    ? (byId[latest.sessionId as SessionId]?.displayTitle ?? latest.title)
    : ''

  // 胶囊主文本：显示刚完成的那条对话消息（而非会话标题/AI 回复）；
  // 无消息时回退标题。
  const latestLabel = latest !== undefined
    ? (latest.question !== '' ? latest.question : latestTitle)
    : ''

  // 健康提醒文案：凌晨提示优先于休息时段；时段内持续替换胶囊主文案。
  const nowDate = new Date()
  let reminderLabel: string | null = null
  let reminderIcon: ReminderIconKind = 'moon'
  if (lateActive) {
    reminderIcon = 'moon'
    reminderLabel = `凌晨 ${nowDate.getHours()} 点了 · 注意休息`
  } else if (restActive) {
    reminderIcon = 'coffee'
    reminderLabel = `休息时间（${restConfig.start}-${restConfig.end}）· 该休息一下了`
  }

  // 平时（无提醒）：随机轮播开心话术 / AI 名词小知识。
  const funLine = FUN_LINES[funIdx % FUN_LINES.length] ?? FUN_LINES[0]

  // 优先级：未读通知 > 最近完成时间/平时轮播（图标与文字分开渲染）。
  // 健康提醒不再挤占主文案——作为独立黄色徽章常驻最左侧，与通知共存。
  const pillLabel = unreadCount > 0 && latest !== undefined
    ? `${unreadCount} 个对话完成 · ${truncate(latestLabel, 56)}`
    : latest !== undefined
      ? `对话完成 · 最近 ${formatTime(latest.endedAt)}`
      : `${funLine.icon} ${funLine.text}`

  // 面板定位：与胶囊**中心对齐**（整数像素），并做视口边界保护——
  // 面板左/右缘都不超出视口，胶囊贴边时自动向内收。
  const centeredPanelLeft = (panelW: number): number => {
    const pillW = (shellWidth ?? 0) + 2
    let left = Math.round((pillW - panelW) / 2)
    if (pos !== null) {
      const minLeft = Math.round(8 - pos.x)
      const maxLeft = Math.round(window.innerWidth - 12 - pos.x - panelW)
      left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft))
    }
    return left
  }
  const doneShift = centeredPanelLeft(DONE_PANEL_W)
  const runShift = centeredPanelLeft(RUN_PANEL_W)

  // 主文案显示上限：最多 20 字（超出省略号截断）。
  const displayText = truncate(pillLabel, 20)

  // 宽度平滑跟随：每次渲染后对**子块宽度求和**（子块均不收缩，求和不受
  // shell 自身受控宽度污染，扩/缩双向都准确），交给 CSS transition 过渡。
  useLayoutEffect(() => {
    const el = shellRef.current
    if (el === null) return
    let total = 0
    for (const child of el.children) total += child.getBoundingClientRect().width
    total += 2 // 左右 border 各 1px（受控 width 需包含边框占位）
    if (total > 0 && Math.round(total) !== shellWidthRef.current) {
      shellWidthRef.current = Math.round(total)
      setShellWidth(Math.round(total))
    }
    // 锁定模式下宽度变化后按中心锚点重放位置（向两侧对称伸缩）。
    // 拖拽进行中绝不重放——否则锚点会和拖拽对抗，把胶囊拽回去。
    if (dragRef.current !== null) return
    if (!autoCenterRef.current && anchorRef.current !== null) applyAnchor()
  })

  if (!enabled) return null

  // 逐字符淡入：key = displayText，文本变化时 React 重建字符节点重放动画。
  const chars = displayText.split('')

  return createPortal(
    <div
      ref={wrapRef}
      style={wrapStyle(dragging, pos, appearance.scale, fontStackOf(appearance.font))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseEnter={() => { if (dragRef.current === null) setHovered(true) }}
      onMouseLeave={() => { setHovered(false); setHoveredRunning(false); setFileHovered(false) }}
    >
      <div ref={shellRef} style={pillShellStyle(unreadCount, shellWidth)}>
        {/* 健康提醒徽章：设定时段内常驻显示（黄色），与完成通知共存不挤占 */}
        {reminderLabel !== null && (
          <>
            <span style={reminderBadgeStyle} title={reminderLabel}>
              <LineIcon kind={reminderIcon} size={Math.max(10, Math.round(13 * appearance.scale))} />
              <span>{reminderLabel}</span>
            </span>
            <span style={pillDividerStyle} aria-hidden />
          </>
        )}
        {/* 左块：正在执行中的任务数量（仅在有任务运行时显示），悬停滑出任务列表 */}
        {runningSessions.length > 0 && (
          <>
            <button
              type="button"
              style={{ ...runningBlockStyle(true), cursor: 'inherit' }}
              aria-label={`正在执行中的任务 ${runningSessions.length} 个；悬停查看列表`}
              title="正在执行中的任务"
              onMouseEnter={() => { setHoveredRunning(true); setHovered(false) }}
            >
              <span style={runDotStyle} aria-hidden />
              <span>{runningSessions.length}</span>
            </button>
            <span style={pillDividerStyle} aria-hidden />
          </>
        )}
        {/* 主体：点击 = 直接进入最新完成的会话；按住拖动 = 移动胶囊 */}
        <button
          type="button"
          style={{ ...pillMainStyle, ...shellChildStyle, cursor: 'inherit' }}
          aria-label={latest !== undefined
            ? `打开会话「${latestTitle}」（${unreadCount} 条对话完成未读）；拖动可移动位置`
            : reminderLabel !== null
              ? `${reminderLabel}；拖动可移动位置`
              : '对话完成胶囊（暂无记录）；拖动可移动位置'}
          onMouseEnter={() => { setHovered(true); setHoveredRunning(false) }}
        >
          {reminderLabel === null && unreadCount > 0 && latest !== undefined ? (
            <span style={checkIconStyle(unreadCount)} aria-hidden>✓</span>
          ) : (
            <span style={reminderIconStyle} aria-hidden><LineIcon kind={reminderLabel !== null ? reminderIcon : funLine.icon} size={Math.max(10, Math.round(13 * appearance.scale))} /></span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} key={displayText}>
            {chars.map((ch, i) => (
              <span
                key={`${i}-${ch}`}
                style={{
                  display: 'inline-block',
                  whiteSpace: 'pre',
                  opacity: 0,
                  animation: `dpCharIn .22s ease ${i * 28}ms forwards`,
                }}
              >
                {ch}
              </span>
            ))}
          </span>
        </button>
        {/* 分隔线 + 文件按钮：点击打开文件浏览器抽屉 */}
        <span style={pillDividerStyle} aria-hidden />
        <button
          type="button"
          style={fileButtonStyle(fileHovered)}
          aria-label="文件浏览器"
          title="文件浏览器"
          onPointerDown={(event) => { event.stopPropagation() }}
          onMouseEnter={() => { setFileHovered(true); setHovered(false); setHoveredRunning(false) }}
          onMouseLeave={() => { setFileHovered(false) }}
          onClick={toggleFileExplorer}
        >
          <IconFolderOpenOutline16 size={14} />
        </button>
      </div>
      {/* 运行中任务面板：悬停左块时从下方滑出 */}
      <div style={runPanelStyle(hoveredRunning, runShift)} role="dialog" aria-label="正在执行中的任务" aria-hidden={!hoveredRunning}>
        <div style={headStyle}>
          <span style={headTitleStyle}>正在执行中</span>
          <span style={headMetaStyle}>{`${runningSessions.length} 个任务 · 点击进入会话`}</span>
        </div>
        {runningSessions.map((session) => {
          const info = runInfo[session.id]
          // 主文本 = 当前正在执行的那条用户消息；无消息时回退会话标题。
          const label = info !== undefined && info.question !== '' ? info.question : session.displayTitle
          return (
            <button
              key={session.id}
              type="button"
              style={runRowStyle}
              title={info !== undefined && info.question !== ''
                ? `「${session.displayTitle}」正在执行：${info.question}`
                : `点击打开会话：${session.displayTitle}`}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={() => { openSession(session.id) }}
            >
              <span style={runDotStyle} aria-hidden />
              <span style={runRowTitleStyle}>{label}</span>
              {info !== undefined && (
                <span style={runRowTimeStyle}>{formatElapsed(nowTick - info.since)}</span>
              )}
              {session.pendingInteraction === 'approval' && <span style={runRowTagStyle}>待审批</span>}
              {session.pendingInteraction === 'question' && <span style={runRowTagStyle}>待回答</span>}
            </button>
          )
        })}
        {runningSessions.length === 0 && (
          <div style={emptyStyle}>没有正在运行的任务</div>
        )}
      </div>
      {/* 记录面板：悬停主体时从下方滑出 */}
      <div style={panelStyle(hovered, doneShift)} role="dialog" aria-label="对话完成记录" aria-hidden={!hovered}>
        <div style={headStyle}>
          <span style={headTitleStyle}>对话完成记录</span>
          <span style={headMetaStyle}>{`${entries.length} 条 · 点击卡片进入会话`}</span>
        </div>
        {entries.map((item) => {
          const title = byId[item.sessionId as SessionId]?.displayTitle ?? item.title
          const unread = !readIds.has(item.id)
          // 主文本 = 完成的那条对话消息；无消息时回退会话标题。
          const headLabel = item.question !== '' ? item.question : item.title
          return (
            <div
              key={item.id}
              style={cardStyle}
              role="button"
              tabIndex={unread ? 0 : -1}
              title={`「${title}」${item.question !== '' ? `问：${item.question}` : ''} — 点击打开会话`}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={() => { openSession(item.sessionId, item.id) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openSession(item.sessionId, item.id)
                }
              }}
            >
              <div style={cardHeadStyle}>
                {unread && <span style={unreadDotStyle} aria-hidden />}
                <span style={sessionTitleStyle}>{headLabel}</span>
                {item.reasonKind === 'error' && <span style={errorTagStyle}>出错结束</span>}
                <span style={metaStyle}>
                  {`回合 ${item.turn >= 0 ? item.turn + 1 : '?'} · ${formatTime(item.endedAt)}`}
                </span>
                <button
                  type="button"
                  style={closeStyle}
                  aria-label="移除这条记录（不跳转会话）"
                  onClick={(event) => { event.stopPropagation(); dismiss(item.id) }}
                >
                  ✕
                </button>
              </div>
              {item.answer !== '' && <pre style={answerStyle}>{item.answer}</pre>}
            </div>
          )
        })}
        {entries.length === 0 && <div style={emptyStyle}>暂无记录 — 任一会话的对话完成后会出现在这里</div>}
      </div>
    </div>,
    document.body,
  )
}

/** 注册 shell.overlay 顶部胶囊 + 基础设置显隐开关行。 */
export function applyDonePill(ctx: ClientContext): void {
  try { sessionsRuntime = (ctx as any).get('sessions') } catch { sessionsRuntime = undefined }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'done-pill',
    order: 90,
  }, DonePill))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill',
      order: 31,
      label: '对话完成胶囊',
    }, DonePillRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill-rest',
      order: 32,
      label: '休息时间提醒',
    }, () => (
      <ReminderRow
        titleText="休息时间提醒"
        descText="设定时间段内胶囊持续提示休息；结束时间早于开始时间表示跨午夜"
        store={restStore}
      />
    )))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill-late',
      order: 33,
      label: '凌晨注意休息',
    }, () => (
      <ReminderRow
        titleText="凌晨注意休息"
        descText="凌晨时段内胶囊持续提示注意休息（默认 00:00-07:00）"
        store={lateStore}
      />
    )))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill-scale',
      order: 34,
      label: '胶囊大小',
    }, PillScaleRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill-font',
      order: 35,
      label: '胶囊字体',
    }, PillFontRow))
}
