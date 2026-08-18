/**
 * dsh-memory 变更通知：入口 badge + 会话后变更列表。
 * 未读状态存 localStorage（已读 change id 集合），badge 显示当日未读数；
 * 打开面板时若存在未读则默认定位到「变更」Tab。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeView, MemoryApi } from './api.js'

/** localStorage 前缀。 */
const READ_KEY = 'dsh-memory:read'

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

function writeIds(ids: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]))
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级：badge 每轮都显示。
  }
}

/**
 * 轮询当日变更并计算未读数。
 * @param api - 面板 API。
 * @param pollMs - 轮询间隔（默认 60s）。
 */
export function useUnreadChanges(api: MemoryApi, pollMs = 60_000): {
  count: number
  changes: ChangeView[]
  today: string
  refresh: () => Promise<void>
  markRead: () => void
} {
  const [changes, setChanges] = useState<ChangeView[]>([])
  const [today, setToday] = useState('')
  const [count, setCount] = useState(0)
  const idsRef = useRef<Set<string>>(readIds())
  // 固定 api 引用：slots inject 每次渲染返回新对象，若进依赖会导致
  // useEffect 每次渲染都重建 setInterval + 立即请求（请求风暴）。
  const apiRef = useRef(api)
  apiRef.current = api

  const refresh = useCallback(async () => {
    try {
      const response = await apiRef.current.changes()
      setChanges(response.changes)
      setToday(response.date)
      const unread = response.changes.filter(change => !idsRef.current.has(change.id)).length
      setCount(unread)
    } catch {
      // 静默：通知是尽力而为的副产物。
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, pollMs)
    return () => window.clearInterval(timer)
  }, [refresh, pollMs])

  const markRead = useCallback(() => {
    const ids = new Set(idsRef.current)
    for (const change of changes) ids.add(change.id)
    idsRef.current = ids
    writeIds(ids)
    setCount(0)
  }, [changes])

  return { count, changes, today, refresh, markRead }
}

/** 变更动作徽标文案（zh）。 */
export function changeActionLabel(action: ChangeView['action']): string {
  switch (action) {
    case 'add': return '新增'
    case 'update': return '更新'
    case 'promote': return '沉淀'
    case 'delete': return '删除'
  }
}
