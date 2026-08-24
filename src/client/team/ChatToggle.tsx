/**
 * team — 对话框「团队」开关（conversation.input.right 槽位，order 4）。
 *
 * 位于「提示词优化」（order 5）左侧。点击弹出小卡：
 *  - 团队模式开关（会话级）
 *  - 团队选择、链条选择（自动＝由主脑判断）
 *  - 强制模式（每个任务都先走 team_run）
 *  - 团队默认模型只读回显 + 「打开团队面板」提示
 *
 * 状态双写：localStorage（立即生效、跨刷新即时）+ POST /api/webui-team/chat-mode
 * （host 提示词注入的真源）。与 prompt-optimize 的挂载范式一致，零 DSH 源码改动。
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import * as api from './api.ts'
import { ensureTeamStyles } from './styles.ts'
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
      force: parsed.force === true,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    }
  } catch {
    return null
  }
}

function writeLocal(sessionId: string, state: ChatModeState): void {
  try { window.localStorage.setItem(storageKey(sessionId), JSON.stringify(state)) } catch { /* ignore */ }
}

/** 渲染对话框团队开关。 */
export function TeamToggle({ available, sessionId }: TeamToggleInjected): JSX.Element | null {
  ensureTeamStyles()
  const sid = String(sessionId)
  const [state, setState] = useState<ChatModeState>(() => readLocal(sid) ?? {
    enabled: false, teamId: '', chainId: '', force: false, updatedAt: '',
  })
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [chains, setChains] = useState<Array<{ id: string, name: string }>>([])
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number, top: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

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

  // 打开小卡时拉团队清单。
  useEffect(() => {
    if (!open) return
    let alive = true
    void api.listTeams().then((data) => {
      if (!alive) return
      setTeams(data.teams.filter(team => team.readonly !== true))
      if (state.teamId === '' && data.activeTeamId !== '') {
        setState(previous => ({ ...previous, teamId: data.activeTeamId }))
      }
    }).catch(error => { if (alive) setErr(error instanceof Error ? error.message : String(error)) })
    return () => { alive = false }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 团队变化时拉该团队的链条列表。
  useEffect(() => {
    if (!open) return
    const teamId = state.teamId !== '' ? state.teamId : (teams[0]?.id ?? '')
    if (teamId === '') { setChains([]); return }
    let alive = true
    void api.getTeam(teamId).then((data) => {
      if (!alive) return
      setChains(data.team.chains.map(chain => ({ id: chain.id, name: chain.name })))
    }).catch(() => { if (alive) setChains([]) })
    return () => { alive = false }
  }, [open, state.teamId, teams])

  if (!available) return null

  const commit = (patch: Partial<ChatModeState>): void => {
    const next: ChatModeState = { ...state, ...patch, updatedAt: new Date().toISOString() }
    setState(next)
    writeLocal(sid, next)
    void api.setChatMode(sid, {
      enabled: next.enabled, teamId: next.teamId, chainId: next.chainId, force: next.force,
    }).catch(error => setErr(error instanceof Error ? error.message : String(error)))
  }

  const toggleOpen = (): void => {
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const width = 288
      const left = Math.max(8, Math.min(rect.left - width / 2 + rect.width / 2, window.innerWidth - width - 8))
      // 卡片弹在按钮上方，估高 260。
      const top = Math.max(8, rect.top - 268)
      setPos({ left, top })
    }
    setOpen(true)
  }

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (btnRef.current?.contains(target) === true) return
      if ((target as HTMLElement).closest?.('.team-pop') !== null) return
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
  const modelText = activeTeam !== undefined && activeTeam.model.provider !== ''
    ? `${activeTeam.model.model}`
    : '未设置（用全局默认 / 会话模型）'

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="team-toggle-btn"
        data-on={state.enabled}
        aria-label="团队模式"
        aria-expanded={open}
        title={state.enabled ? `团队模式：${activeTeam?.name ?? state.teamId}` : '团队模式（关闭）'}
        onClick={toggleOpen}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="9" cy="8" r="3.1" />
          <path d="M3.5 19c0-2.8 2.4-4.6 5.5-4.6s5.5 1.8 5.5 4.6" />
          <path d="M16.5 11.2a2.6 2.6 0 1 0-1.2-4.9" />
          <path d="M17 18.6c0-1.9-.9-3.3-2.4-4.1 2.9-.6 5.4 1 5.4 4.1" />
        </svg>
        {state.enabled && activeTeam !== undefined ? (
          <span className="team-toggle-name">{activeTeam.name}</span>
        ) : null}
      </button>

      {open && pos !== null ? createPortal(
        <div className="team-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="团队模式设置">
          <div className="team-pop-head">
            <span className="team-pop-title">团队模式</span>
            <button
              type="button"
              className="team-switch-ctl"
              role="switch"
              aria-checked={state.enabled}
              aria-label="启用团队模式"
              disabled={teams.length === 0}
              onClick={() => commit({ enabled: !state.enabled, teamId: state.teamId !== '' ? state.teamId : (teams[0]?.id ?? '') })}
            />
          </div>

          {teams.length === 0 ? (
            <div className="team-pop-hint">还没有团队。先在左侧「团队」面板新建一个。</div>
          ) : (
            <>
              <label className="team-field">
                <span>团队</span>
                <select
                  className="team-select team-select-grow"
                  value={state.teamId !== '' ? state.teamId : (teams[0]?.id ?? '')}
                  onChange={e => commit({ teamId: e.target.value, chainId: '' })}
                >
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </label>

              <label className="team-field">
                <span>协作链</span>
                <select
                  className="team-select team-select-grow"
                  value={state.chainId}
                  onChange={e => commit({ chainId: e.target.value })}
                >
                  <option value="">自动选择（由主脑判断）</option>
                  {chains.map(chain => (
                    <option key={chain.id} value={chain.id}>{chain.name}</option>
                  ))}
                </select>
              </label>

              <div className="team-model-row">
                <span>团队默认模型</span>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {modelText}
                </span>
              </div>

              <label className="team-check">
                <input type="checkbox" checked={state.force} onChange={e => commit({ force: e.target.checked })} />
                强制模式：每个任务都先交给团队
              </label>

              <div className="team-pop-divider" />
              <div className="team-pop-hint">
                {state.enabled
                  ? '开启后，需要多角色协作的任务会由该团队接力执行，产物落盘；进度显示在对话流上方的团队 HUD。'
                  : '开启后，本会话的复杂任务将交给所选团队分工执行。简单问答仍直接回答。'}
              </div>
              {state.force ? (
                <div className="team-pop-hint">强制模式下简单问题也会走团队，响应更慢、消耗更多 token。</div>
              ) : null}
            </>
          )}
          {err !== null ? <div className="team-error">{err}</div> : null}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
