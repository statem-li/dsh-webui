/**
 * automation — 单条运行记录行（任务卡内「最近运行」与「记录」Tab 共用）。
 *
 * 一行信息密度：状态点 + 状态字 +（任务名，合并视图才有）+ 触发来源徽章 +
 * 相对时间（title 里放绝对时间）→ 摘要/错误（最多 3 行）→ 查看全文。
 */

import type { RunRow as RunRowData } from './types.ts'
import { formatAbsolute, formatRelative, t } from './locales.ts'

const STATUS_TEXT: Record<string, string> = {
  success: 'statusSuccess',
  error: 'statusError',
  skipped: 'statusSkipped',
}

export function RunRow({ run, showJob = false, onViewOutput }: {
  run: RunRowData
  /** 合并视图：显示所属任务名。 */
  showJob?: boolean
  /** 有完整产出时的查看回调（无产出则不渲染按钮）。 */
  onViewOutput?: () => void
}): JSX.Element {
  const detail = run.summary ?? run.error ?? run.reason ?? ''
  const hasFile = typeof run.file === 'string' && run.file !== '' && run.status === 'success'
  return (
    <div className="auto-run">
      <div className="auto-run-head">
        <span className="auto-run-status" data-status={run.status}>
          {t(STATUS_TEXT[run.status] ?? 'statusSkipped')}
        </span>
        {showJob ? <span className="auto-run-job">{run.jobLabel ?? run.jobId}</span> : null}
        {run.trigger === 'manual' ? <span className="auto-badge">{t('triggerManual')}</span> : null}
        <span className="auto-run-time" title={formatAbsolute(run.timestamp)}>
          {formatRelative(run.timestamp)}
        </span>
      </div>
      {detail !== '' ? (
        <div className="auto-run-detail" data-tone={run.status === 'error' ? 'error' : undefined}>{detail}</div>
      ) : null}
      {(hasFile && onViewOutput !== undefined) || run.model !== undefined ? (
        <div className="auto-run-foot">
          {run.model !== undefined ? <span>{run.model}</span> : null}
          {hasFile && onViewOutput !== undefined ? (
            <button type="button" className="auto-btn" onClick={onViewOutput}>{t('viewFull')}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
