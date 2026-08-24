/**
 * ComposerContinueEnhancer — 「一键继续」发送键融合增强（渲染 null 的哨兵）。
 *
 * 不新增独立控件：任务未完成的会话里，在官方主发送键正上方覆盖一层琥珀色
 * 按钮（body 直属 fixed 元素、rAF 逐帧对齐几何），视觉上发送键「变成」了
 * 琥珀继续钮——点它即自动代填继续文字并发送；恢复后覆盖层撤下，露出原生
 * 发送键。输入框里有用户自己的文字时，点击行为与原生一致（发用户的字）。
 *
 * 未完成判定（直接回答「任务完成了吗」，全部来自持久日志重建，重启后依然成立）：
 *  - 最后回合缺 turn/end（服务重启杀掉的回合）；
 *  - 该回合 turn-tail 无 closing 最终回复（手动停止 / API 超时中断的回合）；
 *  - 辅以连接存活期的 lastAgentError / partial 内存信号兜底。
 *
 * 「不在对话中显示」开启时，发送文字末尾附加零宽空格标记，由同模块的
 * MutationObserver 在渲染层隐藏这条 user 消息（agent 收到的文字不变）。
 */
import { useEffect, useRef } from 'react'
import { css, ensureStyles } from './styles'
import { buildSendText, readHide, readText } from './store'

/** 组件完整 props：owner 共享（会话快照 + 输入状态）+ 标准 kit（结构子集）。 */
export interface ComposerContinueEnhancerProps {
  /** 会话快照子集：完成度信号源。 */
  session: {
    running: boolean
    /** 连接存活期间 host 推送的 agent 错误（纯内存态，重连后为 null）。 */
    lastAgentError: string | null
    /** 半截流残留（内存态）。 */
    partial: unknown
    /** Chat 目标内的回合顺序（持久日志重建）。 */
    chat: { timeline: { turnOrder: readonly number[] }; order?: readonly string[]; nodes?: { get: (key: string) => unknown } }
    /** 回合起止时间：最后一个回合缺 endTime = 没跑完。 */
    turnTimings: ReadonlyMap<number, { startTime: number; endTime?: number }>
  }
  /** 输入机状态子集：草稿与提交相位。 */
  input: { draft: string; phase: 'plain' | 'claimed' | 'adjudicating' | 'submitting' }
  /** 公开输入动作面子集：写草稿 + 提交（queue 模式；空闲即直发）。 */
  inputActions: { setDraft: (text: string) => void; submit: () => void }
}

/** 官方主发送按钮的 aria-label 值（ui-conversation locales）。 */
const SEND_LABELS = new Set(['发送消息', 'Send message'])
/** 官方停止按钮的 aria-label 值（运行中占据同一位置，用于排除与类名学习）。 */
const STOP_LABELS = new Set(['停止生成', 'Stop generating'])

// ─── 全局单例监听层：多会话实例共用一份 handler，读「最新挂载实例」的快照 ───

type EnhancerFace = ComposerContinueEnhancerProps

let latestFace: (() => EnhancerFace | null) | null = null
let keydownInstalled = false

/** 当前是否处于「可一键继续」的未完成态（空闲 + 任务没跑完）。 */
function interruptedFace(face: EnhancerFace): boolean {
  if (face.session.running) return false
  if (face.input.phase === 'adjudicating' || face.input.phase === 'submitting') return false
  // 主信号：最后回合未收尾或没有最终回复（持久）；辅信号：内存态错误/半截流。
  return lastTurnUnfinished(face)
    || face.session.lastAgentError !== null
    || (face.session.partial ?? null) !== null
}

/**
 * 最后一个回合是否「没跑完」。
 * 1. 缺 turn/end —— 进程被杀（服务重启）的形态；
 * 2. turn-tail 无 closing（最终 assistant 回复）—— 手动停止/出错中断的形态。
 */
function lastTurnUnfinished(face: EnhancerFace): boolean {
  const chat = face.session.chat
  const order = chat?.timeline?.turnOrder
  if (order === undefined || order.length === 0) return false
  const lastTurn = order[order.length - 1]
  const timing = face.session.turnTimings?.get(lastTurn)
  if (timing === undefined || timing.endTime === undefined) return true
  const keys = chat?.order
  if (keys === undefined) return false
  for (let i = keys.length - 1; i >= 0; i--) {
    const n = chat?.nodes?.get(keys[i]) as { kind?: string; data?: { turn?: number; closing?: unknown } } | undefined
    if (n === undefined || n.kind !== 'turn-tail') continue
    if (n.data?.turn !== lastTurn) return false
    return n.data.closing == null
  }
  return false
}

/** 判定按钮是否官方主发送键：优先 aria-label，退化用 stop 键的同类名学习。 */
function isPrimarySendButton(btn: HTMLElement): boolean {
  const label = btn.getAttribute('aria-label')
  if (label !== null) {
    if (SEND_LABELS.has(label)) return true
    if (STOP_LABELS.has(label)) return false
  }
  const card = btn.closest('[data-composer-card]')
  if (card === null) return false
  const stop = Array.from(card.querySelectorAll('button'))
    .find(b => STOP_LABELS.has(b.getAttribute('aria-label') ?? ''))
  return stop !== undefined && stop !== btn && btn.className === stop.className
}

/**
 * 在 composer 卡内定位主发送按钮：跳过零尺寸的隐藏卡与隐藏按钮（详情面板等
 * 处的同名按钮不该被贴附）。
 * 注意：不用 window.innerHeight 做视口判断——窗口最小化时 innerHeight 为 0，
 * 所有 rect 归零，会把真实按钮全判成不可见（dsh-webui 调试铁律）。
 */
function findPrimaryButton(): HTMLButtonElement | null {
  for (const card of document.querySelectorAll('[data-composer-card]')) {
    for (const btn of card.querySelectorAll('button')) {
      if (!isPrimarySendButton(btn)) continue
      if (btn.offsetParent === null && btn.getClientRects().length === 0) continue
      return btn
    }
  }
  return null
}

// ─── 覆盖按钮：body 直属 fixed 元素，逐帧对齐官方主发送键 ───

let overlayEl: HTMLButtonElement | null = null
const OVERLAY_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4.4 2.4 L13 8 L4.4 13.6 Z" fill="currentColor"/></svg>'
let overlayTickTimer: number | null = null

/** 确保 body 直属覆盖按钮存在并绑定一次性点击行为。 */
function ensureOverlay(): HTMLButtonElement {
  if (overlayEl !== null && overlayEl.isConnected) return overlayEl
  // 清除历史遗留：client bundle 被 HMR 重载时会出现第二份模块实例，旧实例的
  // 覆盖层与轮询仍在跑（且旧逻辑不认草稿），必须先把它们从页面上摘掉。
  for (const stale of document.querySelectorAll('#' + css.overlay)) stale.remove()
  const el = document.createElement('button')
  el.type = 'button'
  el.id = css.overlay
  el.setAttribute('aria-label', '一键继续')
  el.title = ''
  el.innerHTML = OVERLAY_SVG
  el.addEventListener('click', e => {
    e.preventDefault()
    e.stopPropagation()
    onOverlayActivate()
  })
  el.addEventListener('pointerdown', e => e.stopPropagation())
  document.body.appendChild(el)
  overlayEl = el
  return el
}

/** 覆盖按钮激活：有字发字（原生语义），没字且未完成则发隐形「继续」。 */
function onOverlayActivate(): void {
  const face = latestFace?.() ?? null
  if (face === null) return
  if (face.input.phase === 'adjudicating' || face.input.phase === 'submitting') return
  const current = face.input.draft.trim()
  // 用户有自己的内容 → 原生语义：发用户的字。
  if (current !== '') {
    face.inputActions.submit()
    return
  }
  const wanted = readText()
  const snap = latestSnap
  if (wanted === '' || snap === null || !unfinishedOf(snap)) return
  face.inputActions.setDraft(buildSendText(readText(), readHide()))
  face.inputActions.submit()
}

/** 把覆盖按钮对齐到主发送键几何上。 */
function alignOverlay(el: HTMLButtonElement, primary: HTMLElement): void {
  const r = primary.getBoundingClientRect()
  el.style.left = Math.round(r.left) + 'px'
  el.style.top = Math.round(r.top) + 'px'
  el.style.width = Math.round(r.width) + 'px'
  el.style.height = Math.round(r.height) + 'px'
}

/** 显示覆盖按钮（几何由主循环逐拍对齐；淡入 = 移除 dim 类，CSS transition 播放）。 */
function showOverlay(primary: HTMLElement): void {
  const el = ensureOverlay()
  el.style.display = 'inline-flex'
  alignOverlay(el, primary)
  el.classList.remove('webui-cb-dim')
  // 内联双保险：类若被外部样式意外压制，内联声明仍带着 transition 插值淡入。
  el.style.opacity = '1'
  el.style.pointerEvents = 'auto'
}

/**
 * 淡出覆盖按钮：加 dim 类 → opacity 过渡到 0 且 pointer-events:none。
 * 元素常驻 DOM（display 不切换），淡出动画才能播放；透明且不拦截点击 = 不存在。
 */
function dimOverlay(): void {
  if (overlayEl === null) return
  overlayEl.classList.add('webui-cb-dim')
  overlayEl.style.opacity = '0'
  overlayEl.style.pointerEvents = 'none'
}

/** composer 内输入即时响应：非空立刻淡出（清空后的淡入交给主循环）。 */
function onComposerInput(e: Event): void {
  const t = e.target
  if (!(t instanceof HTMLTextAreaElement)) return
  if (t.closest('[data-composer-card]') === null) return
  if (t.value.trim() !== '') dimOverlay()
}

/** 立即彻底隐藏（无 composer 卡的页面用）。 */
function hideOverlay(): void {
  if (overlayEl !== null) overlayEl.style.display = 'none'
}

// ─── 键盘路径：composer 内裸 Enter 且命中中断态 → 捕获阶段先代填再放行 ───

function onKeyDownCapture(e: KeyboardEvent): void {
  if (e.key !== 'Enter') return
  // oxlint-disable-next-line typescript/no-deprecated
  if (e.isComposing || e.keyCode === 229) return
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
  const face = latestFace?.() ?? null
  if (face === null) return
  const target = e.target
  if (!(target instanceof HTMLTextAreaElement)) return
  if (target.closest('[data-composer-card]') === null) return
  maybeFill(face)
}

/**
 * 中断态且草稿为空 → 代填继续文字（含零宽标记）。返回是否已代填。
 */
function maybeFill(face: EnhancerFace): boolean {
  if (!interruptedFace(face)) return false
  if (face.input.draft.trim() !== '') return false
  face.inputActions.setDraft(buildSendText(readText(), readHide()))
  return true
}

// ─── 渲染层隐藏：带零宽标记的 user 消息 display:none ───

let observerInstalled = false

/** 读当前隐藏开关（每次判定现读，设置行改动即时生效）。 */
function hideWanted(): boolean {
  return readHide()
}

/** 对单个 user 节点包裹层应用/清除隐藏。 */
function judgeUserNode(el: Element): void {
  if (!hideWanted()) {
    if (el instanceof HTMLElement) el.style.display = ''
    return
  }
  const marked = (el.textContent ?? '').includes('\u200B')
  if (el instanceof HTMLElement) el.style.display = marked ? 'none' : ''
}

/** 从任意根扫描 user 节点包裹层并逐个判定。 */
function sweepMarked(root: Element): void {
  if (root.getAttribute('data-chat-flow-kind') === 'user') judgeUserNode(root)
  root.querySelectorAll('[data-chat-flow-kind="user"]').forEach(judgeUserNode)
}

/** 安装渲染层隐藏（MutationObserver 单例；rAF 节流全量重扫 + 低频 interval 兜底，
 * 对抗 React 重渲染重置内联 display 的情况）。 */
function ensureHideObserver(): void {
  if (observerInstalled) return
  observerInstalled = true
  let scheduled = false
  const resweep = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      sweepMarked(document.body)
    })
  }
  sweepMarked(document.body)
  const mo = new MutationObserver(resweep)
  mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  window.setInterval(resweep, 1500)
}

// ─── 完成度事实：从 React fiber 读会话快照（覆盖层显隐的唯一依据）───

/** 覆盖层判定所需的最小事实集（从 ConversationSnapshot 抽取）。 */
interface SnapFacts {
  running: boolean
  lastAgentError: string | null
  partialNonNull: boolean
  /** 最后回合没跑完（缺 turn/end 或 turn-tail 无 closing）。 */
  unfinished: boolean
}

let latestSnap: SnapFacts | null = null

/** 快照事实是否构成「未完成」：回合没收尾，或存活期残留错误/半截流。 */
function unfinishedOf(snap: SnapFacts): boolean {
  return snap.unfinished || snap.lastAgentError !== null || snap.partialNonNull
}

/**
 * 从哨兵 props 抽取事实集（当前会话的权威快照）。
 * 空会话（无回合）一律视为「已完成」——新建对话绝不该出现继续钮。
 * @param face - 最新挂载实例的 props；null 表示还没有会话。
 * @returns 事实集，或 null（无法判定）。
 */
function factsOfFace(face: EnhancerFace | null): SnapFacts | null {
  if (face === null) return null
  const s = face.session
  const order = s.chat?.timeline?.turnOrder
  if (order === undefined) return null
  if (order.length === 0) {
    // 空日志会话：没有任何回合可续，内存态残留也不作数。
    return { running: s.running, lastAgentError: null, partialNonNull: false, unfinished: false }
  }
  return {
    running: s.running,
    lastAgentError: s.lastAgentError,
    partialNonNull: (s.partial ?? null) !== null,
    unfinished: lastTurnUnfinished(face),
  }
}

/**
 * 从任意 DOM 锚点沿 fiber 向上读最近的 ConversationSnapshot 并抽取事实。
 * 槽位组件拿不到别的会话实例的快照，而覆盖层是 body 直属的全局元素，
 * 因此这里从锚点反查——比让每个实例上报再择一更稳。
 * @param anchor - 起始 DOM 锚点（composer 卡或任意会话内元素）。
 * @returns 事实集；读不到快照时 null。
 */
function readSnapFacts(anchor: Element | null): SnapFacts | null {
  if (anchor === null) return null
  const fk = Object.keys(anchor).find(k => k.startsWith('__reactFiber$'))
  if (fk === undefined) return null
  let f = (anchor as unknown as Record<string, any>)[fk]
  for (let i = 0; i < 260 && f; i++, f = f.return) {
    for (const pp of [f.memoizedProps, f.pendingProps]) {
      const s = pp && typeof pp === 'object' ? pp.session : null
      if (s && s.turnTimings instanceof Map && typeof s.running === 'boolean') {
        const order = s.chat && s.chat.timeline ? s.chat.timeline.turnOrder : []
        const last = order[order.length - 1]
        const tm = last !== undefined ? s.turnTimings.get(last) : undefined
        let unfinished = tm === undefined || tm.endTime === undefined
        if (!unfinished) {
          const keys = (s.chat && s.chat.order) || []
          for (let j = keys.length - 1; j >= 0; j--) {
            const n = s.chat.nodes.get(keys[j])
            if (n && n.kind === 'turn-tail') {
              unfinished = n.data.turn === last && n.data.closing == null
              break
            }
          }
        }
        if (order.length === 0) {
          // 空日志会话：没有任何回合可续（新建对话不该出现继续钮）。
          return { running: s.running, lastAgentError: null, partialNonNull: false, unfinished: false }
        }
        return {
          running: s.running,
          lastAgentError: s.lastAgentError ?? null,
          partialNonNull: s.partial != null,
          unfinished,
        }
      }
    }
  }
  return null
}

/**
 * 页面上所有 composer 文本域是否都为空。直接读 DOM 值（打字即时反映，不等
 * React 渲染）；跨卡取并集，避免「按钮在 A 卡、用户在 B 卡打字」的漏判。
 * @returns 草稿是否为空。
 */
function composerDraftEmpty(): boolean {
  for (const card of document.querySelectorAll('[data-composer-card]')) {
    for (const ta of card.querySelectorAll('textarea')) {
      if (ta.value.trim() !== '') return false
    }
  }
  return true
}

/**
 * 主循环：每拍对齐覆盖按钮几何，并按最新事实切换显隐（opacity 淡入淡出）。
 * 输入框一旦有内容即淡出让位（原生发送接管用户的文字），清空后若仍未完成再淡入。
 * 用 setInterval 而非 rAF —— 屏外/最小化窗口的 rAF 可能冻结（dsh-webui 调试铁律）。
 */
function overlayLoop(): void {
  // 隐藏扫描并入主循环：MutationObserver 的单例守卫会被 HMR 旧模块实例劫持
  // （旧实例先置 observerInstalled=true 然后随 bundle 失效），并入这里后由
  // window 级注册表统一保活。
  sweepMarked(document.body)
  const primary = findPrimaryButton()
  if (primary === null) {
    hideOverlay()
    return
  }
  // 事实源优先级：哨兵自身 props（当前会话的权威快照，切会话即换）>
  // fiber 反查（兜底）。反过来会踩「新会话贴着上一个会话的陈旧 fiber」的坑，
  // 表现为点了新对话按钮却仍是橙色继续钮。
  const snap = factsOfFace(latestFace?.() ?? null)
    ?? readSnapFacts(primary.closest('[data-composer-card]'))
  latestSnap = snap
  const idle = snap !== null && !snap.running
  const unfinished = snap !== null
    && (snap.unfinished || snap.lastAgentError !== null || snap.partialNonNull)
  if (idle && unfinished && composerDraftEmpty()) showOverlay(primary)
  else dimOverlay()
}

/** window 级注册表键：跨模块实例（HMR 重载后新旧两份 bundle）互相可见。 */
const LOOP_REGISTRY_KEY = '__dshWebuiContinueLoop'

/**
 * 启动主循环（幂等）。先撤销上一份模块实例的定时器与遗留 DOM：HMR 重载 client
 * bundle 时旧实例仍在跑，旧逻辑不认草稿状态，会让覆盖层「打字也不消失」。
 */
function startOverlayLoop(): void {
  if (overlayTickTimer !== null) return
  const reg = window as unknown as Record<string, unknown>
  const previous = reg[LOOP_REGISTRY_KEY]
  if (typeof previous === 'number') window.clearInterval(previous)
  for (const stale of document.querySelectorAll('#' + css.overlay)) stale.remove()
  overlayEl = null
  overlayTickTimer = window.setInterval(overlayLoop, 250)
  reg[LOOP_REGISTRY_KEY] = overlayTickTimer
  overlayLoop()
}

/**
 * 渲染 null 的哨兵组件：只负责把最新快照面暴露给全局单例监听层，
 * 并保证键盘捕获、渲染层隐藏与覆盖层主循环各安装一次。
 * @param props - 会话快照 + 输入状态 + 输入动作面。
 * @returns null（本增强不产出任何自有 DOM 节点）。
 */
export function ComposerContinueEnhancer(props: ComposerContinueEnhancerProps): null {
  ensureStyles()
  const faceRef = useRef(props)
  faceRef.current = props
  useEffect(() => {
    latestFace = () => faceRef.current
    if (!keydownInstalled) {
      keydownInstalled = true
      document.addEventListener('keydown', onKeyDownCapture, true)
      // 打字瞬间淡出（不等 250ms 轮询到点），清空后由主循环淡回。
      document.addEventListener('input', onComposerInput, true)
    }
    ensureHideObserver()
    startOverlayLoop()
    return () => { latestFace = null }
  }, [])
  return null
}