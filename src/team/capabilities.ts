/**
 * team — 角色能力装配解析（host 半身）。
 *
 * 两类能力：
 *  1. **插件工具**：来源 = `ctx.tools.schemas()`（当前进程注册的全部工具，含各插件贡献的）。
 *     角色可选 inherit / allow（白名单）/ deny（黑名单）。
 *  2. **技能与技能包**：来源 = `ctx.skills.list()`（DSH 技能注册表）+ 技能包账本
 *     `${DSH_AGENTS_HOME}/skills/.bundles.json`（与 skill-toggles / 技能管理面板同一份）。
 *     角色可选 inherit / allow（只装配所选技能与包）/ none（不用技能）。
 *
 * 生效路径（按执行通道分流，见 engine.ts）：
 *  - `subagent` 通道：tools 解析成 `ToolRestriction` 交给 `subagents.start({ toolFilter })`
 *    —— 真实限制（工具从子 agent 提示词消失且拒绝执行）；技能白名单以提示词形式下发，
 *    子 agent 用 `skill` 工具自行加载。
 *  - `llm` 直跑通道：本无工具，tools 只作提示声明；技能则**把正文内联进 system**
 *    （按预算截断）——llm 通道唯一能真正"装配"技能的方式。
 */

import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { capabilitiesOf, type Role, type RoleCapabilities } from './types.js'

/** 注入服务均为运行时动态注册，类型上放宽。 */
type AnyContext = any

/** 技能包账本文件名（与 skill-toggles 同一约定）。 */
const BUNDLES_FILE = '.bundles.json'
/** 内联技能正文的总预算（字符）。 */
const SKILL_INLINE_BUDGET = 12_000
/** 单个技能内联的最大长度。 */
const SKILL_INLINE_EACH_MAX = 6000

// ── 目录 ────────────────────────────────────────────────────────────────────

/** 可写的用户技能根（尊重 $DSH_AGENTS_HOME）。 */
function managedSkillRoot(): string {
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  return join(agentsHome, 'skills')
}

/** DSH 技能根（尊重 $DSH_HOME）。 */
function dshSkillRoot(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'skills')
}

// ── 可选目录（供 UI 下拉）───────────────────────────────────────────────────

/** 一个可装配的工具。 */
export interface ToolOption {
  name: string
  description: string
}

/** 一个可装配的技能。 */
export interface SkillOption {
  name: string
  description: string
  /** 是否对模型可调用（禁用的技能仍列出但标注）。 */
  modelInvocable: boolean
}

/** 一个技能包。 */
export interface BundleOption {
  id: string
  name: string
  skills: string[]
}

/** 能力目录（工具 + 技能 + 技能包）。 */
export interface CapabilityCatalog {
  tools: ToolOption[]
  skills: SkillOption[]
  bundles: BundleOption[]
}

/**
 * 安全读取一个 cordis 服务。
 *
 * 【必须走 ctx.get(name)，且绝不能写 `ctx.get(name) ?? ctx.name`】
 * cordis 的 context 是 Proxy：对**未在插件 inject 声明**的服务做裸属性访问
 * （`ctx.skills`）会直接抛 `cannot get property "<name>" without inject`。
 * 而 `??` 的右操作数恰恰在 `get()` 返回 undefined（服务未挂载）时求值 ——
 * 于是「本想兜底」的写法在服务缺失时必然抛错，是真正的故障源。
 * `ctx.get()` 走 reflect store，对缺失服务返回 undefined，可安全降级。
 *
 * 注意：不要把这些可选服务加进 index.ts 的 inject 数组 —— inject 里的服务
 * 全部视为**必需**，任一缺失会让整个插件 fiber 变 INACTIVE（插件整体停摆）。
 */
function serviceOf(ctx: AnyContext, name: string): any {
  try {
    return ctx.get?.(name)
  } catch {
    return undefined
  }
}

/** 读取当前进程注册的全部工具（名称 + 描述首句）。 */
export function listTools(ctx: AnyContext): ToolOption[] {
  try {
    const tools = serviceOf(ctx, 'tools')
    const schemas = tools?.schemas?.() as Array<{ name?: unknown, description?: unknown }> | undefined
    if (!Array.isArray(schemas)) return []
    return schemas
      .map((schema) => {
        const name = typeof schema.name === 'string' ? schema.name : ''
        const raw = typeof schema.description === 'string' ? schema.description : ''
        // 描述可能很长（本插件自己的工具就是），取首句/首 100 字做下拉提示。
        const description = raw.split(/[。\n]/)[0]?.slice(0, 100) ?? ''
        return { name, description }
      })
      .filter(tool => tool.name !== '')
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** 读取技能注册表（失败返回空数组，不抛）。 */
export async function listSkills(ctx: AnyContext): Promise<SkillOption[]> {
  try {
    const registry = serviceOf(ctx, 'skills')
    if (registry?.list === undefined) return []
    const listed = await registry.list() as Array<{
      name?: unknown
      description?: unknown
      invocation?: { modelInvocable?: unknown }
    }>
    if (!Array.isArray(listed)) return []
    return listed
      .map(skill => ({
        name: typeof skill.name === 'string' ? skill.name : '',
        description: typeof skill.description === 'string' ? skill.description.slice(0, 160) : '',
        modelInvocable: skill.invocation?.modelInvocable !== false,
      }))
      .filter(skill => skill.name !== '')
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** 读技能包账本（与 skill-toggles 同一份文件）。 */
export async function listBundles(): Promise<BundleOption[]> {
  try {
    const raw = await readFile(join(managedSkillRoot(), BUNDLES_FILE), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') return []
    const bundles = (parsed as { bundles?: unknown }).bundles
    if (!Array.isArray(bundles)) return []
    return bundles
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>
        return {
          id: typeof record.id === 'string' ? record.id : '',
          name: typeof record.name === 'string' && record.name !== ''
            ? record.name
            : (typeof record.id === 'string' ? record.id : ''),
          skills: Array.isArray(record.skills)
            ? record.skills.filter((s): s is string => typeof s === 'string')
            : [],
        }
      })
      .filter(bundle => bundle.id !== '')
  } catch {
    return []
  }
}

/** 组装完整能力目录（供 UI 的 /capabilities 接口）。 */
export async function capabilityCatalog(ctx: AnyContext): Promise<CapabilityCatalog> {
  const [skills, bundles] = await Promise.all([listSkills(ctx), listBundles()])
  return { tools: listTools(ctx), skills, bundles }
}

// ── 解析 ────────────────────────────────────────────────────────────────────

/** DSH 的 ToolRestriction 形状（subagents.start 的 toolFilter）。 */
export interface ToolRestrictionLike {
  allow?: readonly string[]
  deny?: readonly string[]
}

/** 一个角色解析后的能力。 */
export interface ResolvedCapabilities {
  /** subagent 通道用的工具过滤器；inherit 时为 null（不限制）。 */
  toolFilter: ToolRestrictionLike | null
  /** 提示词里声明的工具名单（allow 模式=可用清单，deny 模式=禁用清单）。 */
  toolNames: string[]
  toolMode: RoleCapabilities['toolMode']
  /** 展开后的技能名（skills + 包内技能，去重）。 */
  skillNames: string[]
  skillMode: RoleCapabilities['skillMode']
  /** 名单里在当前环境找不到的项（UI/运行记录里提示，不阻断执行）。 */
  missingTools: string[]
  missingSkills: string[]
}

/**
 * 解析角色能力：展开技能包、剔除当前环境不存在的名字（记入 missing*），
 * 生成 subagent 通道可用的 toolFilter。
 */
export async function resolveCapabilities(
  ctx: AnyContext,
  role: Role,
  catalog?: CapabilityCatalog,
): Promise<ResolvedCapabilities> {
  const caps = capabilitiesOf(role)
  const cat = catalog ?? await capabilityCatalog(ctx)

  // ── 工具 ──
  const knownTools = new Set(cat.tools.map(tool => tool.name))
  const wantedTools = caps.toolMode === 'inherit' ? [] : caps.tools
  const missingTools = wantedTools.filter(name => !knownTools.has(name))
  const validTools = wantedTools.filter(name => knownTools.has(name))
  let toolFilter: ToolRestrictionLike | null = null
  if (caps.toolMode === 'allow' && validTools.length > 0) {
    toolFilter = { allow: validTools }
  } else if (caps.toolMode === 'deny' && validTools.length > 0) {
    toolFilter = { deny: validTools }
  }

  // ── 技能（展开包）──
  const bundleById = new Map(cat.bundles.map(bundle => [bundle.id, bundle]))
  const expanded = new Set<string>()
  const missingBundles: string[] = []
  for (const bundleId of caps.skillBundles) {
    const bundle = bundleById.get(bundleId)
    if (bundle === undefined) { missingBundles.push(bundleId); continue }
    for (const skill of bundle.skills) expanded.add(skill)
  }
  for (const skill of caps.skills) expanded.add(skill)
  const knownSkills = new Set(cat.skills.map(skill => skill.name))
  const skillNames = [...expanded].filter(name => knownSkills.has(name)).sort()
  const missingSkills = [...expanded].filter(name => !knownSkills.has(name))
    .concat(missingBundles.map(id => `技能包 ${id}`))

  return {
    toolFilter,
    toolNames: validTools,
    toolMode: caps.toolMode,
    skillNames: caps.skillMode === 'allow' ? skillNames : [],
    skillMode: caps.skillMode,
    missingTools,
    missingSkills,
  }
}

// ── 提示词片段 ──────────────────────────────────────────────────────────────

/**
 * 生成能力声明片段（两个通道都用）：说明本角色可用/禁用的工具与允许使用的技能。
 * 无任何装配时返回空串。
 */
export function renderCapabilityNotice(resolved: ResolvedCapabilities, channel: 'llm' | 'subagent'): string {
  const lines: string[] = []
  if (resolved.toolMode === 'allow' && resolved.toolNames.length > 0) {
    lines.push(channel === 'subagent'
      ? `## 可用工具（已按角色装配限制）\n你**只有**以下工具可用：${resolved.toolNames.join('、')}。其余工具在本次执行中不可用。`
      : `## 本角色的能力范围\n本角色被装配为只使用：${resolved.toolNames.join('、')}。当前通道无工具执行能力，请据此说明需要哪些操作，由主脑或下游角色执行。`)
  } else if (resolved.toolMode === 'deny' && resolved.toolNames.length > 0) {
    lines.push(`## 工具限制\n以下工具在本次执行中**不可用**：${resolved.toolNames.join('、')}。不要尝试调用它们。`)
  }
  if (resolved.skillMode === 'none') {
    lines.push('## 技能\n本角色不使用技能包，直接按你的角色提示词工作。')
  } else if (resolved.skillMode === 'allow' && resolved.skillNames.length > 0 && channel === 'subagent') {
    lines.push(`## 装配的技能\n本角色装配了以下技能：${resolved.skillNames.join('、')}。开始工作前先用 \`skill\` 工具加载与当前任务相关的技能，并遵循其完整说明。`)
  }
  if (resolved.missingTools.length > 0 || resolved.missingSkills.length > 0) {
    const missing = [...resolved.missingTools, ...resolved.missingSkills]
    lines.push(`（注意：装配清单里有当前环境不存在的项，已跳过：${missing.join('、')}）`)
  }
  return lines.join('\n\n')
}

/**
 * llm 直跑通道的技能内联：把所选技能的正文按预算拼进 system。
 * 这是 llm 通道唯一能"装配"技能的方式（该通道无 `skill` 工具）。
 * 读取失败的技能静默跳过。
 */
export async function renderInlineSkills(
  ctx: AnyContext,
  resolved: ResolvedCapabilities,
): Promise<string> {
  if (resolved.skillMode !== 'allow' || resolved.skillNames.length === 0) return ''
  const registry = serviceOf(ctx, 'skills')
  if (registry?.get === undefined) return ''
  const perSkill = Math.max(600, Math.min(SKILL_INLINE_EACH_MAX, Math.floor(SKILL_INLINE_BUDGET / resolved.skillNames.length)))
  const parts: string[] = []
  let used = 0
  for (const name of resolved.skillNames) {
    if (used >= SKILL_INLINE_BUDGET) break
    try {
      const definition = await registry.get(name) as { content?: unknown, description?: unknown } | undefined
      const content = typeof definition?.content === 'string' ? definition.content : ''
      if (content.trim() === '') continue
      const clipped = content.length > perSkill ? `${content.slice(0, perSkill)}\n…（技能正文已截断）` : content
      used += clipped.length
      const description = typeof definition?.description === 'string' ? definition.description : ''
      parts.push(`### 技能：${name}${description !== '' ? `（${description}）` : ''}\n${clipped}`)
    } catch {
      // 读不到的技能跳过（可能刚被删除/禁用）。
    }
  }
  if (parts.length === 0) return ''
  return ['## 已装配技能的完整说明（务必遵循）', ...parts].join('\n\n')
}

/** 技能目录自检：两个技能根是否存在（供诊断用）。 */
export async function skillRootsStatus(): Promise<Array<{ root: string, count: number }>> {
  const out: Array<{ root: string, count: number }> = []
  for (const root of [managedSkillRoot(), dshSkillRoot()]) {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      out.push({ root, count: entries.filter(entry => entry.isDirectory()).length })
    } catch {
      out.push({ root, count: -1 })
    }
  }
  return out
}
