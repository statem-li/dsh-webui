/**
 * session-pin — 会话置顶 store 与 sessionId 解析（client 半身）。
 *
 * 置顶列表持久化在 localStorage（`dsh-webui.pinned.sessions`），跨标签页用
 * storage 事件同步；与 sidebar-float 的 fixed 持久化同一模式，纯客户端即可
 * 满足「刷新 / 多标签页」一致性，无需 host /api 往返。
 *
 * sessionId 解析：会话行 DOM 上不携带 data-session-id（ui-workspace 的
 * SessionNodeItem 不渲染任何 id 属性），但 React 会在 DOM 元素挂
 * `__reactFiber$*`，沿 fiber 链向上即可读到 `memoizedProps.node.id`
 * （SessionNode.id === SessionId）。这是主路径；fiber 不可用（如 React 升级
 * 改变内部键名 / 非 React 环境）时降级为 displayTitle 匹配（DOM 行标题
 * 文本 ↔ sessions.list.byId[].displayTitle，按 DOM 顺序消歧）。
 */

import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** 置顶列表 localStorage key。 */
const PIN_KEY = 'dsh-webui.pinned.sessions'

// ── 置顶列表 store ──────────────────────────────────────────────────────────

let pinned: SessionId[] = loadPinned()
const listeners = new Set<() => void>()

/** 从 localStorage 恢复置顶列表（损坏 / 非法时回退空列表）。 */
function loadPinned(): SessionId[] {
  try {
    const raw = localStorage.getItem(PIN_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string') as SessionId[]
      }
    }
  } catch { /* 忽略 */ }
  return []
}

/** 写回 localStorage（失败仅跳过持久化，不破坏内存态）。 */
function persist(): void {
  try { localStorage.setItem(PIN_KEY, JSON.stringify(pinned)) } catch { /* 忽略 */ }
}

/** 当前置顶 sessionId 列表（顺序即置顶顺序，先置顶在前）。 */
export function getPinned(): readonly SessionId[] {
  return pinned
}

/** 某会话是否已置顶。 */
export function isPinned(sessionId: SessionId): boolean {
  return pinned.includes(sessionId)
}

/** 置顶：插到列表最前（重复置顶幂等）。 */
export function pin(sessionId: SessionId): void {
  if (pinned.includes(sessionId)) return
  pinned = [sessionId, ...pinned]
  persist()
  emit()
}

/** 取消置顶。 */
export function unpin(sessionId: SessionId): void {
  const next = pinned.filter(id => id !== sessionId)
  if (next.length === pinned.length) return
  pinned = next
  persist()
  emit()
}

/** 订阅置顶列表变化（返回退订函数）。 */
export function subscribePinned(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function emit(): void {
  for (const fn of [...listeners]) fn()
}

/** 跨标签页同步：其它标签页修改置顶列表时采纳。 */
export function installPinnedStorageSync(): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== PIN_KEY) return
    const next = loadPinned()
    // 引用/内容任一变化才广播，避免无谓的重排。
    if (next.length === pinned.length && next.every((id, i) => id === pinned[i])) return
    pinned = next
    emit()
  }
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener('storage', onStorage) }
}

// ── sessionId 解析 ─────────────────────────────────────────────────────────

/** React 把 fiber 挂在 DOM 元素上的属性名前缀。 */
const FIBER_KEY_PREFIX = '__reactFiber$'
/** 沿 fiber 链向上搜索的最大深度（SessionNodeItem 距 host div 通常 <10 层）。 */
const FIBER_MAX_DEPTH = 40

interface FiberLike {
  memoizedProps?: { node?: { id?: unknown } } & Record<string, unknown>
  return?: FiberLike | null
}

/** 主路径：从会话行 DOM 元素沿 React fiber 链读 SessionNode.id。 */
function resolveViaFiber(row: HTMLElement): SessionId | null {
  for (const key of Object.keys(row)) {
    if (!key.startsWith(FIBER_KEY_PREFIX)) continue
    let fiber = (row as unknown as Record<string, unknown>)[key] as FiberLike | undefined
    for (let depth = 0; fiber !== undefined && depth < FIBER_MAX_DEPTH; depth++) {
      const id = fiber.memoizedProps?.node?.id
      if (typeof id === 'string' && id.length > 0) return id as SessionId
      fiber = fiber.return ?? undefined
    }
    break
  }
  return null
}

/** 会话行的展示标题（`[class*="title"]` 文本；blank 行显示本地化「新会话」）。 */
export function rowTitle(row: HTMLElement): string | null {
  const titleEl = row.querySelector<HTMLElement>('[class*="title"]')
  return titleEl?.textContent ?? null
}

/**
 * 解析会话行对应的 sessionId。fiber 优先，降级为 displayTitle 匹配。
 * @param row - 会话行元素（`[class*="sessionRow"]`）。
 * @param sessions - 运行时会话服务；fiber 失败时按标题匹配用。
 * @param consumed - 本次扫描已消费的 sessionId（标题重名时按 DOM 顺序消歧）。
 * @returns sessionId，或无法解析时为 null。
 */
export function resolveSessionId(
  row: HTMLElement,
  sessions: ISessions | undefined,
  consumed: Set<string>,
): SessionId | null {
  const viaFiber = resolveViaFiber(row)
  if (viaFiber !== null) return viaFiber

  const title = rowTitle(row)
  if (title === null || sessions === undefined) return null
  const byId = sessions.list.getSnapshot().byId
  // 精确匹配展示标题；多个候选时跳过已消费的（按 DOM 顺序消歧）。
  for (const [id, summary] of Object.entries(byId)) {
    if (summary.displayTitle !== title) continue
    if (consumed.has(id)) continue
    return id as SessionId
  }
  return null
}

/** 会话行是否为 blank（新建会话占位行）：无 rowActions（无操作按钮/时间）。 */
export function isBlankRow(row: HTMLElement): boolean {
  return row.querySelector('[class*="rowActions"]') === null
}
