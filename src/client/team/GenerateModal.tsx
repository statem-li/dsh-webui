/**
 * team — 一句话生成团队的弹窗（对话式输入 + 生成中状态 + 结果概览）。
 *
 * 生成走 host 的 POST /teams { action:'generate' }（内部用 ctx.llm，
 * 只产结构不产模型绑定）。生成期间禁用输入并显示进度提示，失败展示可读错误。
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as api from './api.ts'
import { ModelSelect } from './ModelSelect.tsx'
import type { ModelBinding, ProviderView, Team } from './types.ts'

/** 需求示例（点击填入）。 */
const EXAMPLES = [
  '做一个短视频内容团队：选题、写脚本、审稿、做封面文案',
  '做一个技术调研团队：多源取证、交叉验证、给出选型建议',
  '做一个论文润色团队：结构梳理、语言润色、学术审查、答辩预演',
  '做一个电商运营团队：竞品分析、活动策划、文案撰写、数据复盘',
]

export interface GenerateModalProps {
  open: boolean
  providers: readonly ProviderView[]
  /** 生成用模型（缺省用全局默认）。 */
  defaultGenModel: ModelBinding | null
  onClose: () => void
  onDone: (team: Team) => void
}

/** 一句话生成团队弹窗。 */
export function GenerateModal({ open, providers, defaultGenModel, onClose, onDone }: GenerateModalProps): JSX.Element | null {
  const [brief, setBrief] = useState('')
  const [genModel, setGenModel] = useState<ModelBinding | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setElapsed(0)
    window.setTimeout(() => areaRef.current?.focus(), 60)
  }, [open])

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => { setElapsed(previous => previous + 1) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [busy])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open, busy, onClose])

  if (!open) return null

  const submit = async (): Promise<void> => {
    if (brief.trim() === '') { setError('请先描述你想要的团队'); return }
    setBusy(true)
    setError(null)
    try {
      const data = await api.generateTeam({
        brief: brief.trim(),
        ...(genModel !== null ? { provider: genModel.provider, model: genModel.model } : {}),
      })
      onDone(data.team)
      setBrief('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <>
      <div className="team-gen-mask" onClick={() => { if (!busy) onClose() }} aria-hidden="true" />
      <div className="team-gen-card" role="dialog" aria-modal="true" aria-label="一句话生成团队">
        <div className="team-gen-head">
          <span className="team-gen-title">一句话生成团队</span>
          <button type="button" className="psh-close" aria-label="关闭" disabled={busy} onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="team-gen-body">
          <label className="team-field">
            <span>你想要什么样的团队？</span>
            <textarea
              ref={areaRef}
              className="team-textarea"
              style={{ minHeight: 96 }}
              value={brief}
              disabled={busy}
              placeholder="例如：做一个短视频内容团队，要能选题、写脚本、审稿、出封面文案"
              onChange={event => setBrief(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
              }}
            />
          </label>

          <div className="team-gen-examples">
            {EXAMPLES.map(example => (
              <button
                key={example}
                type="button"
                className="team-chip"
                disabled={busy}
                onClick={() => setBrief(example)}
              >{example}</button>
            ))}
          </div>

          <label className="team-field">
            <span>生成用模型</span>
            <ModelSelect
              value={genModel}
              providers={providers}
              grow
              disabled={busy}
              inheritLabel={defaultGenModel !== null
                ? `用全局默认（${defaultGenModel.model}）`
                : '用会话当前模型'}
              ariaLabel="生成用模型"
              onChange={setGenModel}
            />
          </label>

          <div className="team-pop-hint">
            生成内容：角色（含完整系统提示词）、分组、协作链、关联关系。
            <strong>不含模型绑定</strong>——所有角色默认继承团队默认模型，生成后在面板顶部选一次即可。
          </div>

          {error !== null ? <div className="team-error" role="alert">{error}</div> : null}
          {busy ? (
            <div className="team-gen-progress">
              <span className="team-dot" data-status="running" />
              <span>正在设计团队编制…（{elapsed}s，通常 20~60s）</span>
            </div>
          ) : null}
        </div>

        <div className="team-gen-foot">
          <button type="button" className="team-btn team-btn-lg" disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button"
            className="team-btn team-btn-primary team-btn-lg"
            disabled={busy || brief.trim() === ''}
            onClick={() => void submit()}
          >{busy ? '生成中…' : '生成团队'}</button>
        </div>
      </div>
    </>,
    document.body,
  )
}
