/**
 * team — 角色能力装配编辑器（插件工具 + 技能 / 技能包开关）。
 *
 * 三块：
 *  1. 工具：模式（继承 / 白名单 / 黑名单）+ 带搜索的多选清单（来源 = 当前进程注册的全部工具）。
 *  2. 技能：模式（继承 / 只用所选 / 不用技能）+ 多选清单（来源 = DSH 技能注册表）。
 *  3. 技能包：多选（来源 = 技能管理面板的包账本），选中即展开包内技能一并装配。
 *
 * 生效差异在 UI 上明示：
 *  - subagent 通道：工具是**真限制**（子 agent 看不到也调不了）；技能靠提示词让子 agent 自行 `skill` 加载。
 *  - llm 直跑通道：无工具能力，工具装配只作声明；技能则把正文**内联进提示词**。
 */

import { useMemo, useState } from 'react'
import type {
  BundleOption, CapabilityCatalog, ExecutorPref, RoleCapabilities, SkillMode, ToolMode,
} from './types.ts'
import { DEFAULT_CAPABILITIES } from './types.ts'

/** 单个多选清单的可见行数上限（超出滚动）。 */
const LIST_MAX_HEIGHT = 168

export interface CapabilityEditorProps {
  value: RoleCapabilities | undefined
  catalog: CapabilityCatalog | null
  /** 角色的执行通道（决定提示文案）。 */
  executor: ExecutorPref
  onChange: (next: RoleCapabilities) => void
}

/** 渲染能力装配编辑器。 */
export function CapabilityEditor({ value, catalog, executor, onChange }: CapabilityEditorProps): JSX.Element {
  const caps = value ?? DEFAULT_CAPABILITIES
  const [toolQuery, setToolQuery] = useState('')
  const [skillQuery, setSkillQuery] = useState('')

  const patch = (fields: Partial<RoleCapabilities>): void => { onChange({ ...caps, ...fields }) }

  const tools = catalog?.tools ?? []
  const skills = catalog?.skills ?? []
  const bundles = catalog?.bundles ?? []

  const visibleTools = useMemo(() => {
    const query = toolQuery.trim().toLowerCase()
    if (query === '') return tools
    return tools.filter(tool =>
      tool.name.toLowerCase().includes(query) || tool.description.toLowerCase().includes(query))
  }, [tools, toolQuery])

  const visibleSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase()
    if (query === '') return skills
    return skills.filter(skill =>
      skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query))
  }, [skills, skillQuery])

  /** 技能包展开出的技能名（用于在技能清单里标注「已由包带入」）。 */
  const fromBundles = useMemo(() => {
    const set = new Set<string>()
    const byId = new Map(bundles.map((bundle: BundleOption) => [bundle.id, bundle]))
    for (const id of caps.skillBundles) {
      for (const skill of byId.get(id)?.skills ?? []) set.add(skill)
    }
    return set
  }, [bundles, caps.skillBundles])

  const toggleIn = (list: string[], name: string): string[] =>
    (list.includes(name) ? list.filter(item => item !== name) : [...list, name])

  const toolHint = executor === 'llm'
    ? '当前通道为 llm 直跑（无工具执行能力）：此处装配只会写进提示词作为能力声明。需要真限制请把通道设为 auto/subagent。'
    : 'subagent 通道下为真实限制：未获授权的工具会从子 agent 的提示词中消失并拒绝执行。'
  const skillHint = executor === 'llm'
    ? 'llm 直跑通道会把所选技能的正文**内联进提示词**（按预算截断）。'
    : 'subagent 通道会把技能清单写进提示词，由子 agent 自行用 skill 工具加载完整说明。'

  return (
    <div className="team-caps">
      {/* ── 工具 ── */}
      <div className="team-caps-block">
        <div className="team-caps-head">
          <span className="team-caps-title">插件工具</span>
          <select
            className="team-select"
            style={{ maxWidth: 150 }}
            value={caps.toolMode}
            aria-label="工具装配模式"
            onChange={e => patch({ toolMode: e.target.value as ToolMode })}
          >
            <option value="inherit">继承会话全部</option>
            <option value="allow">只允许所选</option>
            <option value="deny">禁用所选</option>
          </select>
          {caps.toolMode !== 'inherit' ? (
            <span className="team-caps-count">{caps.tools.length} 项</span>
          ) : null}
        </div>
        <div className="team-pop-hint">{toolHint}</div>

        {caps.toolMode !== 'inherit' ? (
          <>
            <div className="team-caps-bar">
              <input
                className="team-input"
                style={{ height: 28, fontSize: 12 }}
                value={toolQuery}
                placeholder={`搜索工具（共 ${tools.length} 个）`}
                onChange={e => setToolQuery(e.target.value)}
              />
              <button type="button" className="team-btn" onClick={() => patch({ tools: [] })}>清空</button>
            </div>
            <div className="team-caps-list" style={{ maxHeight: LIST_MAX_HEIGHT }}>
              {tools.length === 0 ? (
                <div className="team-pop-hint">读不到工具清单（需要重启服务让 host 侧 /capabilities 生效）。</div>
              ) : visibleTools.length === 0 ? (
                <div className="team-pop-hint">没有匹配的工具。</div>
              ) : visibleTools.map(tool => (
                <label className="team-caps-item" key={tool.name}>
                  <input
                    type="checkbox"
                    checked={caps.tools.includes(tool.name)}
                    onChange={() => patch({ tools: toggleIn(caps.tools, tool.name) })}
                  />
                  <span className="team-caps-name">{tool.name}</span>
                  {tool.description !== '' ? <span className="team-caps-desc">{tool.description}</span> : null}
                </label>
              ))}
            </div>
            {caps.tools.length > 0 ? (
              <div className="team-caps-chips">
                {caps.tools.map(name => (
                  <button
                    key={name}
                    type="button"
                    className="team-chip"
                    title="点击移除"
                    onClick={() => patch({ tools: caps.tools.filter(item => item !== name) })}
                  >{name} ×</button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {/* ── 技能 ── */}
      <div className="team-caps-block">
        <div className="team-caps-head">
          <span className="team-caps-title">技能</span>
          <select
            className="team-select"
            style={{ maxWidth: 150 }}
            value={caps.skillMode}
            aria-label="技能装配模式"
            onChange={e => patch({ skillMode: e.target.value as SkillMode })}
          >
            <option value="inherit">继承（不限制）</option>
            <option value="allow">只装配所选</option>
            <option value="none">不用技能</option>
          </select>
          {caps.skillMode === 'allow' ? (
            <span className="team-caps-count">{caps.skills.length + fromBundles.size} 项</span>
          ) : null}
        </div>
        <div className="team-pop-hint">{skillHint}</div>

        {caps.skillMode === 'allow' ? (
          <>
            {bundles.length > 0 ? (
              <div className="team-caps-sub">
                <span className="team-caps-subtitle">技能包（选中即装配包内全部技能）</span>
                <div className="team-caps-chips">
                  {bundles.map(bundle => {
                    const on = caps.skillBundles.includes(bundle.id)
                    return (
                      <button
                        key={bundle.id}
                        type="button"
                        className="team-chip"
                        data-on={on || undefined}
                        title={`${bundle.skills.length} 个技能：${bundle.skills.slice(0, 8).join('、')}${bundle.skills.length > 8 ? '…' : ''}`}
                        onClick={() => patch({ skillBundles: toggleIn(caps.skillBundles, bundle.id) })}
                      >{on ? '✓ ' : ''}{bundle.name} · {bundle.skills.length}</button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className="team-caps-bar">
              <input
                className="team-input"
                style={{ height: 28, fontSize: 12 }}
                value={skillQuery}
                placeholder={`搜索技能（共 ${skills.length} 个）`}
                onChange={e => setSkillQuery(e.target.value)}
              />
              <button type="button" className="team-btn" onClick={() => patch({ skills: [] })}>清空</button>
            </div>
            <div className="team-caps-list" style={{ maxHeight: LIST_MAX_HEIGHT }}>
              {skills.length === 0 ? (
                <div className="team-pop-hint">读不到技能清单（需要重启服务让 host 侧 /capabilities 生效）。</div>
              ) : visibleSkills.length === 0 ? (
                <div className="team-pop-hint">没有匹配的技能。</div>
              ) : visibleSkills.map(skill => {
                const byBundle = fromBundles.has(skill.name)
                return (
                  <label className="team-caps-item" key={skill.name}>
                    <input
                      type="checkbox"
                      checked={caps.skills.includes(skill.name) || byBundle}
                      disabled={byBundle}
                      onChange={() => patch({ skills: toggleIn(caps.skills, skill.name) })}
                    />
                    <span className="team-caps-name">{skill.name}</span>
                    {byBundle ? <span className="team-tag">来自技能包</span> : null}
                    {!skill.modelInvocable ? <span className="team-tag">已禁用</span> : null}
                    {skill.description !== '' ? <span className="team-caps-desc">{skill.description}</span> : null}
                  </label>
                )
              })}
            </div>
            {caps.skills.length > 0 ? (
              <div className="team-caps-chips">
                {caps.skills.map(name => (
                  <button
                    key={name}
                    type="button"
                    className="team-chip"
                    title="点击移除"
                    onClick={() => patch({ skills: caps.skills.filter(item => item !== name) })}
                  >{name} ×</button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

/** 角色卡片副标题里的能力摘要（无装配时返回空串）。 */
export function capabilitySummary(caps: RoleCapabilities | undefined): string {
  if (caps === undefined) return ''
  const parts: string[] = []
  if (caps.toolMode === 'allow' && caps.tools.length > 0) parts.push(`工具 ${caps.tools.length}`)
  else if (caps.toolMode === 'deny' && caps.tools.length > 0) parts.push(`禁用工具 ${caps.tools.length}`)
  if (caps.skillMode === 'none') parts.push('无技能')
  else if (caps.skillMode === 'allow') {
    const count = caps.skills.length + caps.skillBundles.length
    if (count > 0) parts.push(`技能 ${caps.skills.length}${caps.skillBundles.length > 0 ? `+${caps.skillBundles.length}包` : ''}`)
  }
  return parts.join(' · ')
}
