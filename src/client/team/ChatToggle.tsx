/**
 * team — 对话框「团队」选择器（conversation.input.right 槽位，order 4）。
 *
 * 交互与模型切换（ModelSeat）完全一致：
 *  - 胶囊触发按钮：图标 + 当前团队名（或「团队模式」）+ chevron 箭头；
 *  - hover 弹出菜单（80ms 延迟关闭），未开启时点击也打开菜单；
 *  - 菜单列出团队，选中项打勾；点选团队即开启团队模式（enabled=true）
 *    且默认就是强制模式（force=true）；
 *  - **团队模式已开启时，左键点击按钮本体直接关闭**（不需要进菜单）。
 *
 * 状态双写：localStorage（立即生效、跨刷新即时）+ POST /api/webui-team/chat-mode
 * （host 提示词注入的真源）。与 prompt-optimize 的挂载范式一致，零 DSH 源码改动。
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconCheckOutline16, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import * as api from './api.ts'
import { ensureTeamStyles } from './styles.ts'
import { TeamAura, type AuraPulse } from './Aura.tsx'
import type { ChatModeState, TeamSummary } from './types.ts'

/** 注入面（inject 返回）。 */
export interface TeamToggleInjected {
  available: boolean
  sessionId: SessionId
}

/** localStorage 键（按会话）。 */
function storageKey(sessionId: string): string {
  return `dsh-webui.team.chat-mode.${sessionId}`
}

function readLocal(sessionId: string): ChatModeState | null {
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<ChatModeState>
    return {
      enabled: parsed.enabled === true,
      teamId: typeof parsed.teamId === 'string' ? parsed.teamId : '',
      chainId: typeof parsed.chainId === 'string' ? parsed.chainId : '',
      force: parsed.force !== false, // 默认强制
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    }
  } catch {
    return null
  }
}

function writeLocal(sessionId: string, state: ChatModeState): void {
  try { window.localStorage.setItem(storageKey(sessionId), JSON.stringify(state)) } catch { /* ignore */ }
}

/** 渲染对话框团队选择器（与模型切换同款交互）。 */
export function TeamToggle({ available, sessionId }: TeamToggleInjected): JSX.Element | null {
  ensureTeamStyles()
  const sid = String(sessionId)
  const [state, setState] = useState<ChatModeState>(() => readLocal(sid) ?? {
    enabled: false, teamId: '', chainId: '', force: true, updatedAt: '',
  })
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** 切换信号（仅驱动横幅关闭动画窗口期；坐标不再使用）。 */
  const [pulse, setPulse] = useState<AuraPulse | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const pulseSeq = useRef(0)
  const pulseTimer = useRef(0)
  /** hover 移出后的延迟关闭定时器（与模型切换/推理等级一致）。 */
  const hoverHideTimer = useRef<number | null>(null)

  // 从 host 校正状态（真源）。
  useEffect(() => {
    let alive = true
    void api.getChatMode(sid).then((data) => {
      if (!alive) return
      setState(data.state)
      writeLocal(sid, data.state)
    }).catch(() => {})
    return () => { alive = false }
  }, [sid])

  // 切换会话：清掉上一会话残留的脉冲（避免换会话后氛围动画错位）。
  useEffect(() => {
    setPulse(null)
  }, [sid])

  // 卸载时清理定时器。
  useEffect(() => () => {
    window.clearTimeout(pulseTimer.current)
    if (hoverHideTimer.current !== null) window.clearTimeout(hoverHideTimer.current)
  }, [])

  // 拉团队清单：挂载即拉（横幅/按钮都需要团队名），open 时刷新兜底。
  useEffect(() => {
    let alive = true
    void api.listTeams().then((data) => {
      if (!alive) return
      setTeams(data.teams.filter(team => team.readonly !== true))
      if (state.teamId === '' && data.activeTeamId !== '') {
        setState(previous => ({ ...previous, teamId: data.activeTeamId }))
      }
    }).catch(error => { if (alive) setErr(error instanceof Error ? error.message : String(error)) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, open])

  if (!available) return null

  /** 开关翻转 → 维持横幅的"关闭动画窗口期"（横幅自身播退出动画后卸载）。 */
  const firePulse = (dir: 'in' | 'out'): void => {
    pulseSeq.current += 1
    setPulse({ key: pulseSeq.current, dir })
    window.clearTimeout(pulseTimer.current)
    // 窗口期 1300ms：横幅退出动画（640ms）内保持渲染。
    pulseTimer.current = window.setTimeout(() => { setPulse(null) }, 1300)
  }

  const commit = (patch: Partial<ChatModeState>): void => {
    const next: ChatModeState = { ...state, ...patch, updatedAt: new Date().toISOString() }
    // 团队开关翻转：维持横幅关闭动画窗口期（仅用户操作触发，host 校正不算）。
    if (patch.enabled !== undefined && patch.enabled !== state.enabled) {
      firePulse(next.enabled ? 'in' : 'out')
    }
    setState(next)
    writeLocal(sid, next)
    void api.setChatMode(sid, {
      enabled: next.enabled, teamId: next.teamId, chainId: next.chainId, force: next.force,
    }).catch(error => setErr(error instanceof Error ? error.message : String(error)))
  }

  /** 取消「移出后延迟关闭」的定时器。 */
  const cancelHoverHide = (): void => {
    if (hoverHideTimer.current !== null) {
      window.clearTimeout(hoverHideTimer.current)
      hoverHideTimer.current = null
    }
  }

  /** hover 进入按钮/菜单：立即显示并取消延迟关闭。 */
  const showPanel = (): void => {
    cancelHoverHide()
    setOpen(true)
  }

  /** hover 移出：延迟 0.08 秒再关闭，给用户时间从按钮移入菜单点选。 */
  const scheduleHide = (): void => {
    cancelHoverHide()
    hoverHideTimer.current = window.setTimeout(() => {
      hoverHideTimer.current = null
      setOpen(false)
    }, 80)
  }

  /** 点选团队：开启团队模式（默认就是强制）。 */
  const pickTeam = (teamId: string): void => {
    setOpen(false)
    commit({ enabled: true, teamId, chainId: '', force: true })
  }

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (rootRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const activeTeam = teams.find(team => team.id === state.teamId) ?? teams[0]
  const buttonLabel = state.enabled && activeTeam !== undefined ? activeTeam.name : '团队模式'

  return (
    <div ref={rootRef} className="team-seat">
      {/* 中心光晕过场：开关翻转瞬间从窗口中心扩散（in）/收拢（out） */}
      {state.enabled || pulse !== null ? (
        <TeamAura active={state.enabled} pulse={pulse} />
      ) : null}
      <button
        ref={btnRef}
        type="button"
        className="team-toggle-btn"
        data-on={state.enabled}
        aria-label="团队模式"
        aria-haspopup="menu"
        aria-expanded={open}
        title={state.enabled ? `团队模式：${activeTeam?.name ?? state.teamId}（强制）` : '团队模式（关闭）'}
        onMouseEnter={showPanel}
        onMouseLeave={scheduleHide}
        onClick={() => {
          // 团队模式已开启：左键点击按钮直接关闭（不进菜单）。
          // 未开启：点击打开菜单选择团队。
          if (state.enabled) {
            setOpen(false)
            commit({ enabled: false })
          } else if (open) {
            cancelHoverHide()
            setOpen(false)
          } else {
            showPanel()
          }
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="9" cy="8" r="3.1" />
          <path d="M3.5 19c0-2.8 2.4-4.6 5.5-4.6s5.5 1.8 5.5 4.6" />
          <path d="M16.5 11.2a2.6 2.6 0 1 0-1.2-4.9" />
          <path d="M17 18.6c0-1.9-.9-3.3-2.4-4.1 2.9-.6 5.4 1 5.4 4.1" />
        </svg>
        <span className="team-toggle-name">{buttonLabel}</span>
        <IconChevronDownOutline14 className={clsx('team-toggle-chevron', open && 'team-toggle-chevron-open')} />
      </button>

      {open && (
        <div
          className="team-pop"
          role="menu"
          aria-label="选择团队"
          onMouseEnter={showPanel}
          onMouseLeave={scheduleHide}
        >
          {teams.length === 0 ? (
            <div className="team-pop-empty">还没有团队。先在左侧「团队」面板新建一个。</div>
          ) : (
            <>
              {teams.map(team => {
                const selected = state.enabled && team.id === state.teamId
                return (
                  <button
                    key={team.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={clsx('team-pop-item', selected && 'team-pop-item-on')}
                    title={team.name}
                    onClick={() => pickTeam(team.id)}
                  >
                    <span className="team-pop-item-copy">
                      <span className="team-pop-item-name">{team.name}</span>
                      <span className="team-pop-item-sub">
                        {team.description ?? `${team.roleCount} 个角色 · ${team.chainCount} 条协作链`}
                      </span>
                    </span>
                    <span className="team-pop-check">{selected ? <IconCheckOutline16 /> : null}</span>
                  </button>
                )
              })}
            </>
          )}
          <div className="team-pop-divider" />
          <div className="team-pop-foot">
            ⚡ 强制模式：选中团队即开启，每个任务都先交给团队执行
          </div>
          {err !== null ? <div className="team-error">{err}</div> : null}
        </div>
      )}
    </div>
  )
}