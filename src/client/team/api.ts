/**
 * team — client 侧 API 封装（/api/webui-team/*）。
 */

import type {
  CapabilityCatalog, ChatModeState, ProviderView, Run, RunSummary, Team, TeamGlobals, TeamSummary,
} from './types.ts'

const BASE = '/api/webui-team'

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store', ...init })
  const data = await res.json().catch(() => ({})) as T & { ok?: boolean, error?: string }
  if (!res.ok || data.ok === false) {
    throw new Error(typeof data.error === 'string' && data.error !== '' ? data.error : `HTTP ${res.status}`)
  }
  return data
}

function post<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── 团队 ──

export function listTeams(): Promise<{ teams: TeamSummary[], activeTeamId: string }> {
  return requestJson('/teams')
}

export function getTeam(id: string): Promise<{ team: Team }> {
  return requestJson(`/teams/${encodeURIComponent(id)}`)
}

export function saveTeam(team: Team): Promise<{ team: Team, teams: TeamSummary[] }> {
  return post(`/teams/${encodeURIComponent(team.id)}`, { team })
}

export function createTeam(name: string, seed: boolean): Promise<{ team: Team, teams: TeamSummary[], activeTeamId: string }> {
  return post('/teams', { action: 'create', name, seed })
}

/** 一句话生成团队（host 用 ctx.llm 设计编制并落盘）。 */
export function generateTeam(payload: {
  brief: string
  provider?: string
  model?: string
  teamModel?: { provider: string, model: string }
}): Promise<{ team: Team, teams: TeamSummary[], activeTeamId: string }> {
  return post('/teams', { action: 'generate', ...payload })
}

export function duplicateTeam(id: string, name?: string): Promise<{ team: Team, teams: TeamSummary[], activeTeamId: string }> {
  return post('/teams', { action: 'duplicate', id, ...(name !== undefined ? { name } : {}) })
}

export function removeTeam(id: string): Promise<{ teams: TeamSummary[], activeTeamId: string }> {
  return post('/teams', { action: 'remove', id })
}

export function renameTeam(id: string, name: string): Promise<{ team: Team, teams: TeamSummary[] }> {
  return post('/teams', { action: 'rename', id, name })
}

export function activateTeam(id: string): Promise<{ activeTeamId: string, teams: TeamSummary[] }> {
  return post('/teams', { action: 'activate', id })
}

export function resetTeam(id: string): Promise<{ team: Team, teams: TeamSummary[] }> {
  return post('/teams', { action: 'reset', id })
}

// ── globals / providers ──

export function getGlobals(): Promise<{ globals: TeamGlobals }> {
  return requestJson('/globals')
}

export function patchGlobals(patch: Partial<TeamGlobals>): Promise<{ globals: TeamGlobals }> {
  return post('/globals', patch)
}

export function getProviders(): Promise<{ providers: ProviderView[] }> {
  return requestJson('/providers')
}

/** 能力目录：可装配的插件工具 / 技能 / 技能包。 */
export function getCapabilities(): Promise<CapabilityCatalog> {
  return requestJson('/capabilities')
}

// ── 对话框团队开关 ──

export function getChatMode(sessionId: string): Promise<{ state: ChatModeState }> {
  return requestJson(`/chat-mode?sessionId=${encodeURIComponent(sessionId)}`)
}

export function setChatMode(sessionId: string, patch: Partial<ChatModeState>): Promise<{ state: ChatModeState }> {
  return post('/chat-mode', { sessionId, ...patch })
}

// ── 运行 ──

export interface StartRunPayload {
  teamId: string
  chainId?: string
  roles?: string[]
  task: string
  modelOverrides?: Record<string, { provider: string, model: string }>
  sessionId?: string
  synthesize?: boolean
}

export function startRun(payload: StartRunPayload): Promise<{ run: Run }> {
  return post('/runs', payload)
}

export function listRuns(teamId?: string, limit = 50): Promise<{ runs: RunSummary[], activeRunIds: string[] }> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (teamId !== undefined && teamId !== '') query.set('teamId', teamId)
  return requestJson(`/runs?${query.toString()}`)
}

export function getActiveRuns(sessionId: string): Promise<{ runs: Run[], lastFinished?: Run }> {
  return requestJson(`/runs/active?sessionId=${encodeURIComponent(sessionId)}`)
}

export function getRun(id: string): Promise<{ run: Run }> {
  return requestJson(`/runs/${encodeURIComponent(id)}`)
}

export function getRunOutput(id: string, name: string): Promise<{ content: string }> {
  return requestJson(`/runs/${encodeURIComponent(id)}/output?name=${encodeURIComponent(name)}`)
}

export function cancelRun(id: string): Promise<{ cancelled: boolean }> {
  return post(`/runs/${encodeURIComponent(id)}/cancel`, {})
}

export function removeRun(id: string): Promise<unknown> {
  return post(`/runs/${encodeURIComponent(id)}/remove`, {})
}
