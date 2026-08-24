/**
 * dsh-memory 变更通知：入口 badge 的未读计数。
 * 未读状态存 localStorage（已读 change id 集合），badge 显示当日未读数；
 * 打开面板（变更 Tab）时标记已读。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeView, MemoryApi } from './api.js'

/** localStorage key。 */
const READ_KEY = 'dsh-memory:read'

/**
 * 已读 id 上限：change id 只增不减，无上限会让这条 localStorage 记录
 * 无界增长（每天几十条，一年上万个 id）。只保留最近 N 个——更早的变更
 * 早已滚出当日窗口，不会再被算进未读。
 */
const READ_ID_CAP = 800

/** 读取已读 id 集合。 */
function readIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    if (raw === null) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

/** 写回已读 id 集合（保留最近 READ_ID_CAP 个）。 */
function writeIds(ids: Set<string>): void {
  try {
    const list = [...ids]
    localStorage.setItem(READ_KEY, JSON.stringify(list.slice(Math.max(0, list.length - READ_ID_CAP))))
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级：badge 每轮都显示。
  }
}

/**
 * 轮询当日变更并计算未读数。
 * @param api - 面板 API。
 * @param pollMs - 轮询间隔（默认 60s）。
 * @returns 未读数、刷新与标记已读方法。
 */
export function useUnreadChanges(api: MemoryApi, pollMs = 60_000): {
  count: number
  refresh: () => Promise<void>
  markRead: () => void
} {
  const [count, setCount] = useState(0)
  const idsRef = useRef<Set<string>>(readIds())
  // 最近一次拉到的变更 id（markRead 用）。放 ref 而非 state：markRead 不需要
  // 因它变化而重建，避免闭包拿到过期列表。
  const seenRef = useRef<string[]>([])
  // 固定 api 引用：slots inject 每次渲染返回新对象，若进依赖会导致
  // useEffect 每次渲染都重建 setInterval + 立即请求（请求风暴）。
  const apiRef = useRef(api)
  apiRef.current = api

  const refresh = useCallback(async () => {
    try {
      const response = await apiRef.current.changes()
      seenRef.current = response.changes.map(change => change.id)
      setCount(response.changes.filter(change => !idsRef.current.has(change.id)).length)
    } catch {
      // 静默：通知是尽力而为的副产物。
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, pollMs)
    return () => { window.clearInterval(timer) }
  }, [refresh, pollMs])

  const markRead = useCallback(() => {
    const ids = new Set(idsRef.current)
    for (const id of seenRef.current) ids.add(id)
    idsRef.current = ids
    writeIds(ids)
    setCount(0)
  }, [])

  return { count, refresh, markRead }
}

/** 变更类型再导出（入口只需要类型，不再需要动作文案——已迁到 Panel 的 changeActionLabel）。 */
export type { ChangeView }
