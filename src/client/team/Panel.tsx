/**
 * team — 团队面板（侧边栏导航行入口 + 右侧全高抽屉 + 全屏关系画布）。
 *
 * 抽屉结构：
 *  - 头部：标题 + 团队切换器（下拉 + 生成/新建/复制/重命名/删除）+ 团队默认模型；
 *  - Tab：编制（角色卡片网格 + 协作链；「全屏画布」按钮进入独立的关系画布层）
 *          / 运行（链选择 + 任务 + 本次模型覆盖 + 步骤时间线）
 *          / 历史（运行清单 + 详情 + 产物）/ 设置（globals）。
 *
 * 三条硬规则（都是踩过的坑）：
 *  1. 不用 window.prompt / window.confirm —— Electron 壳子里 prompt() 直接抛异常，
 *     调用点没 catch 就表现为「按钮点了没反应」。统一走 useDialogs()。
 *  2. 角色编辑走 RoleEditorModal 居中弹窗，不在卡片里内联展开（内联会撑高卡片、
 *     盖住邻居节点，导致控件点不到）。
 *  3. 所有 fixed 弹层/全屏层一律 createPortal 到 document.body。
 *
 * 数据全部走 /api/webui-team/*（纯 fetch），与 host 半身解耦。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ensureShellStyles } from '../popover-shell.js'
import { NavButton, ensureNavMount, ensureNavStyles, useNavSlot, useRail } from '../sidebar-nav.js'
import { ensureTeamStyles } from './styles.ts'
import * as api from './api.ts'
import { RoleCard } from './RoleCard.tsx'
import { TeamBoard } from './TeamBoard.tsx'
import { ChainEditor } from './ChainEditor.tsx'
import { ModelSelect } from './ModelSelect.tsx'
import { GenerateModal } from './GenerateModal.tsx'
import { GuideCard } from './GuideCard.tsx'
import { RoleEditorModal } from './RoleEditorModal.tsx'
import { useDialogs } from './Dialog.tsx'
import {
  GROUP_META, SOURCE_LABEL,
  type CapabilityCatalog, type Chain, type ModelBinding, type NodePos, type ProviderView, type Role, type Run, type RunSummary,
  type Team, type TeamGlobals, type TeamSummary,
} from './types.ts'
import {
  elapsedOf, formatDuration, formatTime, runStatusText, shortModel, stepStatusText,
} from './util.ts'

const RELOAD_MS = 20_000
const RUN_POLL_MS = 1200
/** 抽屉关闭动画时长（与 styles.ts 的 team-drawer-out 保持一致）。 */
const DRAWER_EXIT_MS = 220

type PanelTab = 'roster' | 'run' | 'history' | 'settings'

/** 团队入口按钮 + 右侧全高抽屉（贴侧边栏右缘铺满到屏幕右缘）。 */
export function TeamNavApp(): JSX.Element | null {
  const slot = useNavSlot('team')
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [sidebarRight, setSidebarRight] = useState(0)
  const rail = useRail()

  useEffect(() => {
    ensureNavStyles()
    ensureShellStyles()
    ensureTeamStyles()
  }, [])

  // 测量侧边栏右缘：抽屉 left 贴侧边栏右边、right=0，占满中间全部空间，不留间距。
  useLayoutEffect(() => {
    const measure = (): void => {
      const col = document.querySelector('[class*="_sidebarCol"]')
      const right = col !== null ? Math.round(col.getBoundingClientRect().right) : 0
      setSidebarRight(previous => (previous === right ? previous : right))
    }
    measure()
    const observer = new ResizeObserver(measure)
    const col = document.querySelector('[class*="_sidebarCol"]')
    if (col !== null) observer.observe(col)
    window.addEventListener('resize', measure)
    const timer = window.setInterval(measure, 1200)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.clearInterval(timer)
    }
  }, [])

  const closeTimerRef = useRef(0)
  const close = useCallback((): void => {
    // 关闭动画期间重复点击会叠加 setTimeout，导致 open/closing 状态错乱。
    if (closeTimerRef.current !== 0) return
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = 0
      setClosing(false)
      setOpen(false)
    }, DRAWER_EXIT_MS)
  }, [])

  useEffect(() => () => {
    if (closeTimerRef.current !== 0) window.clearTimeout(closeTimerRef.current)
  }, [])

  // Esc 关闭抽屉——但上层浮层（输入/确认弹窗、角色编辑弹窗、全屏画布、
  // 一句话生成、全文查看）自己消费 Esc，此处必须让行。
  useEffect(() => {
    if (!open || closing) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.team-ask') !== null) return
      if (document.querySelector('.team-editor-card') !== null) return
      if (document.querySelector('.team-canvas-layer') !== null) return
      if (document.querySelector('.team-gen-card') !== null) return
      if (document.querySelector('.team-viewer') !== null) return
      if (document.querySelector('.team-step-card') !== null) return
      close()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open, closing, close])

  // 点击抽屉外区域自动收起（含侧边栏）：pointerdown 命中判定、click 照常派发，
  // 因此「点侧边栏其他入口」会一边收起抽屉一边正常切换功能，无需点两下。
  // 团队自己的上层浮层（编辑/输入确认弹窗、全屏画布、一句话生成、全文查看、
  // toast/pop/HUD/pill）不算外部——它们 portal 在 body 上不在抽屉 DOM 内，
  // 不排除的话点一下弹窗就把抽屉连根卸了。团队入口按钮也交给它自身的
  // onClick toggle 处理（pointerdown 先关、click 再走 toggle，结果一致）。
  useEffect(() => {
    if (!open || closing) return
    const TEAM_FLOATS = '.team-drawer,.team-mask,.team-editor-card,.team-editor-mask,.team-ask,.team-ask-mask,'
      + '.team-canvas-layer,.team-gen-card,.team-gen-mask,.team-viewer,.team-pop,.team-toast,.team-hud,.team-pill,'
      + '.team-step-mask,.team-step-card'
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element | null
      if (target !== null && typeof target.closest === 'function'
        && target.closest(TEAM_FLOATS) !== null) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open, closing, close])

  const button = (
    <div>
      <NavButton
        icon={(
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="8" r="3.1" />
            <path d="M3.5 19c0-2.8 2.4-4.6 5.5-4.6s5.5 1.8 5.5 4.6" />
            <path d="M16.5 11.2a2.6 2.6 0 1 0-1.2-4.9" />
            <path d="M17 18.6c0-1.9-.9-3.3-2.4-4.1 2.9-.6 5.4 1 5.4 4.1" />
          </svg>
        )}
        label="团队"
        rail={rail}
        expanded={open}
        ariaLabel="团队 Agent 编排"
        onClick={() => { if (open || closing) close(); else setOpen(true) }}
      />
    </div>
  )

  const anim = closing ? 'out' : 'in'

  return (
    <>
      {slot !== null ? createPortal(button, slot) : null}
      {(open || closing) ? createPortal(
        <>
          <div className="team-mask" data-anim={anim} aria-hidden="true" onClick={close} style={{ left: sidebarRight }} />
          <div
            className="team-drawer"
            data-anim={anim}
            data-solid="true"
            style={{ left: sidebarRight, right: 0, width: 'auto' }}
            role="dialog"
            aria-modal="true"
            aria-label="团队编排"
          >
            <TeamPanel onClose={close} />
          </div>
        </>,
        document.body,
      ) : null}
    </>
  )
}

/** 面板主体。 */
function TeamPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<PanelTab>('roster')
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [activeId, setActiveId] = useState('')
  const [team, setTeam] = useState<Team | null>(null)
  const [providers, setProviders] = useState<ProviderView[]>([])
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null)
  const [globals, setGlobals] = useState<TeamGlobals | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [openChainIds, setOpenChainIds] = useState<Record<string, boolean>>({})
  const [viewing, setViewing] = useState<{ title: string, content: string } | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  /** 正在编辑的角色 id（非空 = 打开 RoleEditorModal 弹窗）。 */
  const [editingRoleId, setEditingRoleId] = useState('')
  /** 全屏关系画布是否打开。 */
  const [canvasOpen, setCanvasOpen] = useState(false)
  /** 连线模式起点（非空 = 正在等待点目标卡片建关联）。 */
  const [linkFrom, setLinkFrom] = useState('')
  /** 当前选中角色（卡片描边高亮）。 */
  const [selectedRoleId, setSelectedRoleId] = useState('')
  /** 输入 / 确认弹窗（替代 window.prompt / confirm）。 */
  const dlg = useDialogs()

  // 运行态
  const [chainId, setChainId] = useState('')
  const [task, setTask] = useState('')
  const [overrides, setOverrides] = useState<Record<string, ModelBinding | null>>({})
  const [showOverrides, setShowOverrides] = useState(false)
  const [currentRun, setCurrentRun] = useState<Run | null>(null)
  const [starting, setStarting] = useState(false)
  const [history, setHistory] = useState<RunSummary[]>([])
  const [now, setNow] = useState(() => Date.now())

  const notify = useCallback((text: string): void => {
    setToast(text)
    window.setTimeout(() => { setToast(current => (current === text ? null : current)) }, 3500)
  }, [])

  const fail = useCallback((err: unknown): void => {
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  /** 拉团队清单 + 当前团队 + providers + globals。 */
  const loadAll = useCallback(async (preferId?: string): Promise<void> => {
    try {
      const [teamList, providerList, globalsData] = await Promise.all([
        api.listTeams(), api.getProviders(), api.getGlobals(),
      ])
      setTeams(teamList.teams)
      setProviders(providerList.providers)
      setGlobals(globalsData.globals)
      const wanted = preferId ?? (activeId !== '' ? activeId : teamList.activeTeamId)
      const exists = teamList.teams.some(t => t.id === wanted && t.readonly !== true)
      const target = exists ? wanted : (teamList.teams.find(t => t.readonly !== true)?.id ?? '')
      setActiveId(target)
      if (target !== '') {
        const detail = await api.getTeam(target)
        setTeam(detail.team)
        setChainId(previous => (detail.team.chains.some(c => c.id === previous) ? previous : (detail.team.chains[0]?.id ?? '')))
      } else {
        setTeam(null)
      }
      setError(null)
    } catch (err) {
      fail(err)
    }
  }, [activeId, fail])

  // 能力目录（工具/技能/技能包）独立拉取：失败不阻塞面板，角色编辑里显示"读不到"。
  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      setCatalog(await api.getCapabilities())
    } catch {
      setCatalog(null)
    }
  }, [])

  useEffect(() => { void loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadCatalog() }, [loadCatalog])

  // 秒级 tick（运行计时）。
  useEffect(() => {
    if (currentRun === null || (currentRun.status !== 'running' && currentRun.status !== 'queued')) return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [currentRun])

  // 运行快照轮询。
  useEffect(() => {
    if (currentRun === null) return
    if (currentRun.status !== 'running' && currentRun.status !== 'queued') return
    let alive = true
    const timer = window.setInterval(() => {
      void api.getRun(currentRun.id).then((data) => {
        if (alive) setCurrentRun(data.run)
      }).catch(() => {})
    }, RUN_POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [currentRun])

  // 历史列表（切到 history tab 时拉取）。
  const loadHistory = useCallback(async (): Promise<void> => {
    try {
      const data = await api.listRuns(activeId !== '' ? activeId : undefined, 50)
      setHistory(data.runs)
    } catch (err) {
      fail(err)
    }
  }, [activeId, fail])

  useEffect(() => {
    if (tab !== 'history') return
    void loadHistory()
    const timer = window.setInterval(() => { void loadHistory() }, RELOAD_MS)
    return () => { window.clearInterval(timer) }
  }, [tab, loadHistory])

  // ── 团队操作 ──

  const saveTeam = async (next: Team): Promise<void> => {
    try {
      const data = await api.saveTeam(next)
      setTeam(data.team)
      setTeams(data.teams)
      notify('已保存')
    } catch (err) {
      fail(err)
      throw err
    }
  }

  const switchTeam = async (id: string): Promise<void> => {
    try {
      await api.activateTeam(id)
      await loadAll(id)
    } catch (err) {
      fail(err)
    }
  }

  const createTeam = async (seed: boolean): Promise<void> => {
    const name = await dlg.prompt({
      title: seed ? '新建团队（套用出厂编制）' : '新建空白团队',
      message: seed ? '会带上出厂的角色与协作链，可再改。' : '只含一个主脑角色和一条空链。',
      defaultValue: seed ? '我的团队' : '空白团队',
      placeholder: '团队名称',
      confirmLabel: '创建',
    })
    if (name === null) return
    try {
      const data = await api.createTeam(name, seed)
      await loadAll(data.team.id)
      notify(`已创建团队「${data.team.name}」`)
    } catch (err) {
      fail(err)
    }
  }

  const duplicateTeam = async (): Promise<void> => {
    if (team === null) return
    try {
      const data = await api.duplicateTeam(team.id)
      await loadAll(data.team.id)
      notify(`已复制为「${data.team.name}」`)
    } catch (err) {
      fail(err)
    }
  }

  const renameTeam = async (): Promise<void> => {
    if (team === null) return
    const name = await dlg.prompt({ title: '重命名团队', defaultValue: team.name, confirmLabel: '保存' })
    if (name === null) return
    try {
      await api.renameTeam(team.id, name)
      await loadAll(team.id)
      notify('已重命名')
    } catch (err) {
      fail(err)
    }
  }

  const removeTeam = async (): Promise<void> => {
    if (team === null) return
    const ok = await dlg.confirm({
      title: `删除团队「${team.name}」？`,
      message: '该团队的角色、链条与设置将一并删除（运行历史保留）。',
      confirmLabel: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      const data = await api.removeTeam(team.id)
      await loadAll(data.activeTeamId)
      notify('团队已删除')
    } catch (err) {
      fail(err)
    }
  }

  const resetTeam = async (): Promise<void> => {
    if (team === null) return
    const ok = await dlg.confirm({
      title: `把「${team.name}」恢复为出厂编制？`,
      message: '当前的角色、链条、关联会被覆盖（团队默认模型保留）。',
      confirmLabel: '恢复',
      danger: true,
    })
    if (!ok) return
    try {
      const data = await api.resetTeam(team.id)
      setTeam(data.team)
      setTeams(data.teams)
      notify('已恢复出厂编制')
    } catch (err) {
      fail(err)
    }
  }

  const setTeamModel = async (binding: ModelBinding | null): Promise<void> => {
    if (team === null) return
    await saveTeam({ ...team, model: binding ?? { provider: '', model: '' } })
  }

  const saveRole = async (next: Role): Promise<void> => {
    if (team === null) return
    await saveTeam({ ...team, roles: team.roles.map(role => (role.id === next.id ? next : role)) })
  }

  const removeRole = async (roleId: string): Promise<void> => {
    if (team === null) return
    const role = team.roles.find(r => r.id === roleId)
    if (role === undefined) return
    const ok = await dlg.confirm({
      title: `删除角色「${role.name}」？`,
      message: '引用它的链步骤与关联也会被移除。',
      confirmLabel: '删除',
      danger: true,
    })
    if (!ok) return
    setEditingRoleId(current => (current === roleId ? '' : current))
    await saveTeam({ ...team, roles: team.roles.filter(r => r.id !== roleId) })
  }

  const addRole = async (): Promise<void> => {
    if (team === null) return
    const name = await dlg.prompt({
      title: '添加角色',
      message: '创建后会直接打开编辑弹窗，填提示词、模型与能力装配。',
      defaultValue: '新角色',
      placeholder: '角色名称，如「核」',
      confirmLabel: '创建',
    })
    if (name === null) return
    // 角色 id 只允许 [A-Za-z0-9_-]（host 侧 normalizeRole 会拒绝其它字符）；
    // 中文名派生不出 ascii 时用随机短 id 兜底。
    const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '') || `r${Date.now().toString(36).slice(-4)}`
    let id = base
    for (let i = 2; team.roles.some(r => r.id === id); i += 1) id = `${base}${i}`
    const role: Role = {
      id, name, en: id, tagline: '', group: 'act', prompt: '',
      model: null, executor: 'auto',
    }
    try {
      await saveTeam({ ...team, roles: [...team.roles, role] })
      setSelectedRoleId(id)
      setEditingRoleId(id)
    } catch {
      // saveTeam 已上报错误
    }
  }

  const saveChain = async (next: Chain): Promise<void> => {
    if (team === null) return
    await saveTeam({ ...team, chains: team.chains.map(chain => (chain.id === next.id ? next : chain)) })
  }

  const removeChain = async (id: string): Promise<void> => {
    if (team === null) return
    const ok = await dlg.confirm({
      title: `删除链条「${team.chains.find(c => c.id === id)?.name ?? id}」？`,
      confirmLabel: '删除',
      danger: true,
    })
    if (!ok) return
    await saveTeam({ ...team, chains: team.chains.filter(chain => chain.id !== id) })
  }

  const addChain = async (): Promise<void> => {
    if (team === null) return
    const name = await dlg.prompt({
      title: '添加协作链',
      message: '创建后在链条卡片里按顺序添加角色步骤。',
      defaultValue: '新链条',
      placeholder: '链条名称',
      confirmLabel: '创建',
    })
    if (name === null) return
    const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '') || `c${Date.now().toString(36).slice(-4)}`
    let id = base
    for (let i = 2; team.chains.some(c => c.id === id); i += 1) id = `${base}${i}`
    await saveTeam({ ...team, chains: [...team.chains, { id, name, steps: [], finalSynthesize: true }] })
    setOpenChainIds(previous => ({ ...previous, [id]: true }))
  }

  // ── 关联（左键连线模式）──

  /** 进入连线模式：本卡作为起点。 */
  const startLink = (roleId: string): void => {
    setLinkFrom(previous => (previous === roleId ? '' : roleId))
  }

  /** 连线模式中点目标卡片：建立双向关联。 */
  const finishLink = (targetId: string): void => {
    if (linkFrom === '' || linkFrom === targetId) { setLinkFrom(''); return }
    void addLink(linkFrom, targetId)
    setLinkFrom('')
  }

  /** 新建关联（去重：同一对角色只保留一条）。 */
  const addLink = async (from: string, to: string): Promise<void> => {
    if (team === null) return
    const exists = team.directLinks.some(link =>
      (link.from === from && link.to === to) || (link.from === to && link.to === from))
    if (exists) { notify('这两个角色已经关联了'); return }
    await saveTeam({ ...team, directLinks: [...team.directLinks, { from, to, kind: 'bidirectional' }] })
  }

  const removeLink = async (index: number): Promise<void> => {
    if (team === null) return
    await saveTeam({ ...team, directLinks: team.directLinks.filter((_, i) => i !== index) })
  }

  /** 切换某条关联的方向（双向 ↔ 单向）。 */
  const flipLink = async (index: number): Promise<void> => {
    if (team === null) return
    await saveTeam({
      ...team,
      directLinks: team.directLinks.map((link, i) => (
        i === index ? { ...link, kind: link.kind === 'directed' ? 'bidirectional' as const : 'directed' as const } : link
      )),
    })
  }

  /** 画布拖拽结束：把全部节点位置固化进 role.pos（静默保存，不弹 toast）。 */
  const commitPositions = async (positions: Record<string, NodePos>): Promise<void> => {
    if (team === null) return
    try {
      const data = await api.saveTeam({
        ...team,
        roles: team.roles.map(role => (positions[role.id] !== undefined ? { ...role, pos: positions[role.id] } : role)),
      })
      setTeam(data.team)
      setTeams(data.teams)
    } catch (err) {
      fail(err)
    }
  }

  /** 自动重排：清空手工位置，回到网格自动布局。 */
  const resetPositions = async (): Promise<void> => {
    if (team === null) return
    await saveTeam({
      ...team,
      roles: team.roles.map((role) => {
        const next = { ...role }
        delete next.pos
        return next
      }),
    })
  }

  // ── 运行操作 ──

  const startRun = async (): Promise<void> => {
    if (team === null) return
    if (task.trim() === '') { notify('请先填写任务描述'); return }
    setStarting(true)
    try {
      const payload: api.StartRunPayload = {
        teamId: team.id,
        task: task.trim(),
        ...(chainId !== '' ? { chainId } : {}),
      }
      const picked: Record<string, { provider: string, model: string }> = {}
      for (const [roleId, binding] of Object.entries(overrides)) {
        if (binding !== null && binding.provider !== '' && binding.model !== '') picked[roleId] = binding
      }
      if (Object.keys(picked).length > 0) payload.modelOverrides = picked
      const data = await api.startRun(payload)
      setCurrentRun(data.run)
      setError(null)
      notify('已启动运行')
    } catch (err) {
      fail(err)
    } finally {
      setStarting(false)
    }
  }

  const cancelRun = async (): Promise<void> => {
    if (currentRun === null) return
    try {
      await api.cancelRun(currentRun.id)
      notify('已请求取消')
    } catch (err) {
      fail(err)
    }
  }

  const openOutput = async (runId: string, name: string, title: string): Promise<void> => {
    try {
      const data = await api.getRunOutput(runId, name)
      setViewing({ title, content: data.content })
    } catch (err) {
      fail(err)
    }
  }

  const openRun = async (id: string): Promise<void> => {
    try {
      const data = await api.getRun(id)
      setCurrentRun(data.run)
      setTab('run')
    } catch (err) {
      fail(err)
    }
  }

  // ── 渲染 ──

  const currentChain = team?.chains.find(chain => chain.id === chainId) ?? null

  /** 选中链里每个角色的步序号（1-based；核心整合步算在 core 角色上）。 */
  const chainOrder = useMemo(() => {
    const map: Record<string, number> = {}
    if (team === null || currentChain === null) return map
    const core = team.roles.find(role => role.group === 'core')
    let step = 1
    for (const item of currentChain.steps) {
      if (item.kind === 'synthesize') {
        const id = item.roleId ?? core?.id
        if (id !== undefined) { map[id] = step; step += 1 }
        continue
      }
      map[item.roleId] = step
      step += 1
    }
    if (currentChain.finalSynthesize && !currentChain.steps.some(s => s.kind === 'synthesize') && core !== undefined) {
      map[core.id] = step
    }
    return map
  }, [team, currentChain])

  /** 每个角色参与的关联（含对方名与原始索引）。 */
  const linksByRole = useMemo(() => {
    const map: Record<string, Array<{ index: number, peerId: string, peerName: string, kind: 'bidirectional' | 'directed' }>> = {}
    if (team === null) return map
    team.directLinks.forEach((link, index) => {
      const fromName = team.roles.find(r => r.id === link.from)?.name ?? link.from
      const toName = team.roles.find(r => r.id === link.to)?.name ?? link.to
      ;(map[link.from] ??= []).push({ index, peerId: link.to, peerName: toName, kind: link.kind })
      ;(map[link.to] ??= []).push({ index, peerId: link.from, peerName: fromName, kind: link.kind })
    })
    return map
  }, [team])

  const readonlyIssue = teams.find(t => t.id === activeId)?.issue

  /** 正在编辑的角色对象（团队重载后自动跟随最新数据）。 */
  const editingRole = useMemo(
    () => (editingRoleId === '' ? null : team?.roles.find(role => role.id === editingRoleId) ?? null),
    [team, editingRoleId],
  )

  // 全屏画布的 Esc 退出（角色编辑弹窗/输入框优先消费）。
  useEffect(() => {
    if (!canvasOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.team-ask') !== null) return
      if (document.querySelector('.team-editor-card') !== null) return
      event.stopPropagation()
      event.preventDefault()
      if (linkFrom !== '') { setLinkFrom(''); return }
      setCanvasOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [canvasOpen, linkFrom])

  return (
    <div className="team-panel">
      {/* 抽屉头部：标题 + 团队切换器 + 团队默认模型 + 关闭 */}
      <div className="team-drawer-head">
        <span className="team-drawer-title">团队编排</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="psh-close" aria-label="关闭" onClick={onClose}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="team-switch">
        <div className="team-switch-row" style={{ flex: '1 1 280px' }}>
          <select
            className="team-select team-select-grow"
            value={activeId}
            aria-label="选择团队"
            onChange={(e) => { void switchTeam(e.target.value) }}
          >
            {teams.length === 0 ? <option value="">（还没有团队）</option> : null}
            {teams.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}{item.readonly === true ? '（只读）' : ` · ${item.roleCount} 角色`}
              </option>
            ))}
          </select>
          <button type="button" className="team-btn team-btn-primary" title="用一句话让模型设计一支团队" onClick={() => setGenOpen(true)}>✨ 一句话生成</button>
          <button type="button" className="team-icon-btn" title="新建团队（出厂编制）" aria-label="新建团队" onClick={() => void createTeam(true)}>＋</button>
          <button type="button" className="team-icon-btn" title="新建空白团队" aria-label="新建空白团队" onClick={() => void createTeam(false)}>◻</button>
          <button type="button" className="team-icon-btn" title="复制当前团队" aria-label="复制团队" disabled={team === null} onClick={() => void duplicateTeam()}>⧉</button>
          <button type="button" className="team-icon-btn" title="重命名" aria-label="重命名团队" disabled={team === null} onClick={() => void renameTeam()}>✎</button>
          <button type="button" className="team-icon-btn" title="删除团队" aria-label="删除团队" disabled={team === null} onClick={() => void removeTeam()}>🗑</button>
        </div>
        <div className="team-model-row" style={{ flex: '1 1 260px' }}>
          <span>团队默认模型</span>
          <ModelSelect
            value={team !== null && team.model.provider !== '' ? team.model : null}
            providers={providers}
            inheritLabel={globals !== null && globals.defaultModel.provider !== ''
              ? `用全局默认（${globals.defaultModel.model}）`
              : '未设置（用会话当前模型）'}
            disabled={team === null}
            grow
            ariaLabel="团队默认模型"
            onChange={(next) => { void setTeamModel(next) }}
          />
        </div>
      </div>

      {/* 新手向导卡：首次使用展开，关闭后收成细行（localStorage 记忆） */}
      <GuideCard />

      {/* Tab */}
      <div className="team-tabs" role="tablist">
        {([['roster', '编制'], ['run', '运行'], ['history', '历史'], ['settings', '设置']] as Array<[PanelTab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="team-tab"
            role="tab"
            data-active={tab === key}
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
      </div>

      {team === null ? (
        <div className="team-scroll">
          {error !== null ? <div className="team-error" role="alert">{error}</div> : null}
          <div className="team-empty">
            <span>还没有可用团队</span>
            <span>点上方「✨ 一句话生成」让模型设计一支，或用「＋」套用出厂编制</span>
          </div>
        </div>
      ) : tab === 'roster' ? (
        /* ── 编制页：角色卡片网格 + 协作链；关系画布走全屏层 ── */
        <div className="team-scroll">
          <div className="team-roster-bar">
            <button type="button" className="team-btn team-btn-primary" onClick={() => void addRole()}>＋ 添加角色</button>
            <button
              type="button"
              className="team-btn"
              title="在全屏画布里拖拽排布、连线（Esc 退出）"
              onClick={() => setCanvasOpen(true)}
            >
              <span aria-hidden="true" style={{ marginRight: 5 }}>⛶</span>全屏关系画布
            </button>
            <select
              className="team-select"
              value={chainId}
              aria-label="高亮协作链"
              onChange={e => setChainId(e.target.value)}
            >
              <option value="">不高亮链条</option>
              {team.chains.map(chain => (
                <option key={chain.id} value={chain.id}>链条：{chain.name}</option>
              ))}
            </select>
            <span style={{ flex: 1 }} />
            <button type="button" className="team-btn team-btn-danger" onClick={() => void resetTeam()}>恢复出厂编制</button>
          </div>

          {error !== null ? <div className="team-error" role="alert">{error}</div> : null}
          {readonlyIssue !== undefined ? <div className="team-error">{readonlyIssue}</div> : null}

          <div className="team-section-title">角色（{team.roles.length}）</div>
          {team.roles.length === 0 ? (
            <div className="team-empty">
              <span>这个团队还没有角色</span>
              <span>点「＋ 添加角色」新建第一个</span>
            </div>
          ) : (
            <div className="team-role-grid">
              {team.roles.map(role => (
                <RoleCard
                  key={role.id}
                  role={role}
                  teamModel={team.model}
                  selected={selectedRoleId === role.id}
                  linking={linkFrom === role.id}
                  linkMode={linkFrom !== ''}
                  chainIndex={chainOrder[role.id] ?? null}
                  links={linksByRole[role.id] ?? []}
                  onOpen={() => { setSelectedRoleId(role.id); setEditingRoleId(role.id) }}
                  onRemove={() => { void removeRole(role.id) }}
                  onStartLink={() => startLink(role.id)}
                  onFinishLink={() => finishLink(role.id)}
                  onRemoveLink={(index) => { void removeLink(index) }}
                />
              ))}
            </div>
          )}

          {linkFrom !== '' ? (
            <div className="team-link-tip">
              已选中「{team.roles.find(r => r.id === linkFrom)?.name ?? linkFrom}」，点另一张卡片建立关联
              <button type="button" className="team-btn" onClick={() => setLinkFrom('')}>取消</button>
            </div>
          ) : null}

          {/* 协作链 */}
          <div className="team-section-title" style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
            <span style={{ flex: 1 }}>协作链（{team.chains.length}）</span>
            <button type="button" className="team-btn" onClick={() => void addChain()}>＋ 添加链条</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {team.chains.length === 0 ? (
              <div className="team-empty"><span>还没有协作链</span><span>链条决定角色的接力顺序</span></div>
            ) : team.chains.map(chain => (
              <ChainEditor
                key={chain.id}
                chain={chain}
                roles={team.roles}
                open={openChainIds[chain.id] === true}
                onToggleOpen={() => {
                  setChainId(chain.id)
                  setOpenChainIds(p => ({ ...p, [chain.id]: p[chain.id] !== true }))
                }}
                onSave={saveChain}
                onRemove={() => void removeChain(chain.id)}
                onRun={(id) => { setChainId(id); setTab('run') }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="team-scroll">
          {error !== null ? <div className="team-error" role="alert">{error}</div> : null}
          {readonlyIssue !== undefined ? <div className="team-error">{readonlyIssue}</div> : null}

          {tab === 'run' ? (
            <div className="team-scroll-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="team-run-form">
                <label className="team-field">
                  <span>协作链</span>
                  <select className="team-select team-select-grow" value={chainId} onChange={e => setChainId(e.target.value)}>
                    {team.chains.length === 0 ? <option value="">（该团队没有链条）</option> : null}
                    {team.chains.map(chain => (
                      <option key={chain.id} value={chain.id}>{chain.name}</option>
                    ))}
                  </select>
                </label>
                <label className="team-field">
                  <span>任务描述（越具体产出越可用）</span>
                  <textarea
                    className="team-textarea"
                    value={task}
                    placeholder="要团队完成什么？目标、边界、验收标准。"
                    onChange={e => setTask(e.target.value)}
                  />
                </label>

                <button
                  type="button"
                  className="team-btn"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => setShowOverrides(v => !v)}
                >
                  {showOverrides ? '收起本次运行模型' : '本次运行模型（逐角色覆盖）'}
                </button>
                {showOverrides ? (
                  <div className="team-role-editor" style={{ margin: 0 }}>
                    {team.roles.map(role => (
                      <label className="team-field" key={role.id}>
                        <span>{role.name} · {role.tagline}</span>
                        <ModelSelect
                          value={overrides[role.id] ?? null}
                          providers={providers}
                          inheritLabel={`用角色/团队设置（${role.model !== null ? role.model.model : (team.model.model !== '' ? team.model.model : '全局默认')}）`}
                          grow
                          ariaLabel={`${role.name} 本次运行模型`}
                          onChange={next => setOverrides(p => ({ ...p, [role.id]: next }))}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                <div className="team-actions">
                  <button
                    type="button"
                    className="team-btn team-btn-primary team-btn-lg"
                    disabled={starting || team.chains.length === 0}
                    onClick={() => void startRun()}
                  >{starting ? '启动中…' : '启动运行'}</button>
                  {currentRun !== null && (currentRun.status === 'running' || currentRun.status === 'queued') ? (
                    <button type="button" className="team-btn team-btn-danger team-btn-lg" onClick={() => void cancelRun()}>取消运行</button>
                  ) : null}
                </div>
                <div className="team-pop-hint">
                  面板触发走 llm 直跑（精确使用设定模型，但角色无工具）。需要角色能读写文件/跑命令时，
                  在对话框打开「团队」开关，由模型调用 team_run（subagent 通道）。
                </div>
              </div>

              {currentRun !== null ? (
                <RunTimeline
                  run={currentRun}
                  now={now}
                  onOpenOutput={(name, title) => void openOutput(currentRun.id, name, title)}
                />
              ) : null}
            </div>
          ) : tab === 'history' ? (
            history.length === 0 ? (
              <div className="team-empty"><span>还没有运行记录</span><span>在「运行」页发起一次团队协作</span></div>
            ) : (
              <div className="team-scroll-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map(item => (
                  <div className="team-hist" key={item.id} onClick={() => void openRun(item.id)} role="button">
                    <div className="team-hist-head">
                      <span className="team-status-text" data-status={item.status}>{runStatusText(item.status)}</span>
                      <span>{item.chainName}</span>
                      <span style={{ marginLeft: 'auto' }}>{item.doneSteps}/{item.totalSteps} 步</span>
                    </div>
                    <div className="team-hist-task">{item.task}</div>
                    <div className="team-hist-head">
                      <span>{item.teamName}</span>
                      <span>{formatTime(item.startedAt)}</span>
                      <span style={{ marginLeft: 'auto' }}>
                        {item.finishedAt !== undefined ? formatDuration(Date.parse(item.finishedAt) - Date.parse(item.startedAt)) : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="team-scroll-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SettingsTab
                globals={globals}
                providers={providers}
                onPatch={async (patch) => {
                  try {
                    const data = await api.patchGlobals(patch)
                    setGlobals(data.globals)
                    notify('已保存')
                  } catch (err) {
                    fail(err)
                  }
                }}
              />
            </div>
          )}
        </div>
      )}

      <GenerateModal
        open={genOpen}
        providers={providers}
        defaultGenModel={globals !== null && globals.defaultModel.provider !== '' ? globals.defaultModel : null}
        onClose={() => setGenOpen(false)}
        onDone={(created) => {
          setGenOpen(false)
          void loadAll(created.id)
          notify(`已生成团队「${created.name}」（${created.roles.length} 个角色）`)
        }}
      />

      {/* ── 全屏关系画布（独立浮层，portal 到 body）── */}
      {canvasOpen && team !== null ? createPortal(
        <div className="team-canvas-layer" role="dialog" aria-modal="true" aria-label="团队关系画布">
          <TeamBoard
            team={team}
            chain={currentChain}
            chainOrder={chainOrder}
            linkFrom={linkFrom}
            selectedRoleId={selectedRoleId}
            linksByRole={linksByRole}
            toolbar={(
              <>
                <span className="team-canvas-title">{team.name}</span>
                <button type="button" className="team-btn team-btn-primary" onClick={() => void addRole()}>＋ 添加角色</button>
                <select
                  className="team-select"
                  value={chainId}
                  aria-label="高亮协作链"
                  onChange={e => setChainId(e.target.value)}
                >
                  <option value="">不高亮链条</option>
                  {team.chains.map(chain => (
                    <option key={chain.id} value={chain.id}>链条：{chain.name}</option>
                  ))}
                </select>
                <button type="button" className="team-btn" onClick={() => void resetPositions()}>自动重排</button>
                <span style={{ flex: 1 }} />
                {linkFrom !== '' ? (
                  <span className="team-link-tip">
                    点目标卡片完成关联
                    <button type="button" className="team-btn" onClick={() => setLinkFrom('')}>取消</button>
                  </span>
                ) : (
                  <span className="team-pop-hint">拖卡片头部移动 · 空白处拖拽平移 · Ctrl+滚轮缩放 · 右键连线删除</span>
                )}
                <button
                  type="button"
                  className="team-btn"
                  onClick={() => { setLinkFrom(''); setCanvasOpen(false) }}
                >退出画布（Esc）</button>
              </>
            )}
            onOpenRole={(roleId) => { setSelectedRoleId(roleId); setEditingRoleId(roleId) }}
            onRemoveRole={(roleId) => { void removeRole(roleId) }}
            onStartLink={roleId => startLink(roleId)}
            onFinishLink={roleId => finishLink(roleId)}
            onRemoveLink={(index) => { void removeLink(index) }}
            onFlipLink={(index) => { void flipLink(index) }}
            onCommitPositions={(positions) => { void commitPositions(positions) }}
          />
        </div>,
        document.body,
      ) : null}

      {/* ── 角色编辑弹窗 ── */}
      {editingRole !== null && team !== null ? (
        <RoleEditorModal
          role={editingRole}
          teamModel={team.model}
          providers={providers}
          catalog={catalog}
          links={(linksByRole[editingRole.id] ?? []).map(link => ({
            index: link.index, peerName: link.peerName, kind: link.kind,
          }))}
          onClose={() => setEditingRoleId('')}
          onSave={saveRole}
          onRemove={() => { void removeRole(editingRole.id) }}
          onRemoveLink={(index) => { void removeLink(index) }}
        />
      ) : null}

      {viewing !== null ? (
        <div className="team-viewer">
          <div className="team-viewer-head">
            <span className="team-viewer-title" title={viewing.title}>{viewing.title}</span>
            <button type="button" className="psh-close" aria-label="关闭" onClick={() => setViewing(null)}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <pre className="team-viewer-body">{viewing.content}</pre>
        </div>
      ) : null}

      {toast !== null ? createPortal(
        <div className="team-toast" role="status" onClick={() => setToast(null)}>{toast}</div>,
        document.body,
      ) : null}

      {/* 输入 / 确认弹窗出口（内部走 body portal，z-index 最高） */}
      {dlg.node}
    </div>
  )
}

/** 运行步骤时间线（面板内）。 */
function RunTimeline({ run, now, onOpenOutput }: {
  run: Run
  now: number
  onOpenOutput: (name: string, title: string) => void
}): JSX.Element {
  const done = run.steps.filter(s => s.status === 'done').length
  const failed = run.steps.filter(s => s.status === 'error' || s.status === 'skipped').length
  const total = Math.max(1, run.steps.length)
  return (
    <>
      <div className="team-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="team-status-text" data-status={run.status}>{runStatusText(run.status)}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.chainName}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{formatDuration(elapsedOf(run.startedAt, run.finishedAt, now))}</span>
      </div>
      <div className="team-progress">
        <div className="team-progress-fill" style={{ width: `${(done / total) * 100}%` }} />
        {failed > 0 ? (
          <div className="team-progress-fail" style={{ left: `${(done / total) * 100}%`, width: `${(failed / total) * 100}%` }} />
        ) : null}
      </div>
      <div className="team-progress-text">
        <span>{done}/{run.steps.length} 完成</span>
        {run.steps.some(s => s.status === 'running') ? <span>1 进行中</span> : null}
        {failed > 0 ? <span style={{ color: 'var(--dsw-alias-state-error-primary, #e0434b)' }}>{failed} 异常</span> : null}
      </div>

      <div className="team-step-list">
        {run.steps.map(step => (
          <div className="team-step" data-status={step.status} key={step.index}>
            <span className="team-dot" data-status={step.status} />
            <div className="team-step-body">
              <div className="team-step-head">
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {step.index + 1}. {step.roleName}
                </span>
                <span style={{ flex: 'none', fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #888)' }}>
                  {stepStatusText(step.status)}
                  {step.startedAt !== undefined ? ` · ${formatDuration(elapsedOf(step.startedAt, step.finishedAt, now))}` : ''}
                </span>
              </div>
              <div className="team-step-meta">
                <span className="team-tag" style={{ borderColor: GROUP_META[step.group].color, color: GROUP_META[step.group].color }}>
                  {GROUP_META[step.group].label}
                </span>
                {step.modelUsed.provider !== '' ? (
                  <>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{shortModel(step.modelUsed)}</span>
                    <span className="team-card-src" data-src={step.modelSource}>{SOURCE_LABEL[step.modelSource]}</span>
                  </>
                ) : null}
                {step.channel !== undefined ? <span>{step.channel}</span> : null}
                {step.retries !== undefined && step.retries > 0 ? <span>重试 {step.retries}</span> : null}
              </div>
              {step.warning !== undefined ? <div className="team-card-inherit" style={{ fontSize: 11 }}>{step.warning}</div> : null}
              {step.error !== undefined ? <div className="team-card-err">{step.error}</div> : null}
              {step.output !== '' ? <div className="team-step-out">{step.output}</div> : null}
              {step.outputFile !== undefined ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="team-btn"
                    style={{ height: 24, fontSize: 11, lineHeight: '22px', padding: '0 10px' }}
                    onClick={() => onOpenOutput(step.outputFile as string, `${step.roleName} · 第 ${step.index + 1} 步`)}
                  >查看全文</button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {run.finalFile !== undefined ? (
        <div className="team-actions">
          <button type="button" className="team-btn team-btn-primary" onClick={() => onOpenOutput('final', `最终交付物 · ${run.teamName}`)}>
            打开最终交付物
          </button>
        </div>
      ) : null}
      {run.error !== undefined ? <div className="team-error">{run.error}</div> : null}
    </>
  )
}

/** 设置页（globals）。 */
function SettingsTab({ globals, providers, onPatch }: {
  globals: TeamGlobals | null
  providers: readonly ProviderView[]
  onPatch: (patch: Partial<TeamGlobals>) => Promise<void>
}): JSX.Element {
  if (globals === null) return <div className="team-empty"><span>加载中…</span></div>
  return (
    <>
      <label className="team-field">
        <span>全局默认模型（团队未设时的兜底）</span>
        <ModelSelect
          value={globals.defaultModel.provider !== '' ? globals.defaultModel : null}
          providers={providers}
          inheritLabel="未设置（用会话当前模型）"
          grow
          ariaLabel="全局默认模型"
          onChange={(next) => { void onPatch({ defaultModel: next ?? { provider: '', model: '' } }) }}
        />
      </label>
      <div className="team-inline">
        <label className="team-field">
          <span>每步超时（秒）</span>
          <input
            className="team-input"
            type="number"
            min={10}
            value={globals.timeoutSec}
            onChange={(e) => { void onPatch({ timeoutSec: Number(e.target.value) }) }}
          />
        </label>
        <label className="team-field">
          <span>失败重试次数</span>
          <input
            className="team-input"
            type="number"
            min={0}
            max={5}
            value={globals.maxRetries}
            onChange={(e) => { void onPatch({ maxRetries: Number(e.target.value) }) }}
          />
        </label>
      </div>
      <div className="team-inline">
        <label className="team-field">
          <span>最大并发运行</span>
          <input
            className="team-input"
            type="number"
            min={1}
            max={5}
            value={globals.maxConcurrentRuns}
            onChange={(e) => { void onPatch({ maxConcurrentRuns: Number(e.target.value) }) }}
          />
        </label>
        <label className="team-field">
          <span>上游注入预算（字符）</span>
          <input
            className="team-input"
            type="number"
            min={500}
            step={500}
            value={globals.outputChunkChars}
            onChange={(e) => { void onPatch({ outputChunkChars: Number(e.target.value) }) }}
          />
        </label>
      </div>
      <label className="team-field">
        <span>上游上下文窗口</span>
        <select
          className="team-select team-select-grow"
          value={globals.upstreamWindow}
          onChange={(e) => { void onPatch({ upstreamWindow: e.target.value as TeamGlobals['upstreamWindow'] }) }}
        >
          <option value="last">最近一步全量 + 更早摘要</option>
          <option value="all-summary">全部步骤摘要（均分预算）</option>
        </select>
      </label>
      <label className="team-check">
        <input
          type="checkbox"
          checked={globals.stopOnError}
          onChange={(e) => { void onPatch({ stopOnError: e.target.checked }) }}
        />
        某步失败即终止整链（关闭则跳过失败步继续）
      </label>
    </>
  )
}

/** 挂载团队面板入口（供 index.ts 调用）。 */
export function mountTeamNav(): void {
  ensureNavMount()
}
