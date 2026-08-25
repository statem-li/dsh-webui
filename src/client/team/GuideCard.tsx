/**
 * team — 新手向导卡（面板顶部的可收起引导）。
 *
 * 首次使用默认展开；关闭后写入 localStorage 不再自动弹出，
 * 收起为一条细行可随时再展开。纯静态三步引导，不追踪完成状态。
 */

import { useCallback, useState } from 'react'

/** 收起状态持久化键。 */
const DISMISS_KEY = 'dsh-webui.team.guide.dismissed'

function readDismissed(): boolean {
  try { return window.localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

function writeDismissed(value: boolean): void {
  try { window.localStorage.setItem(DISMISS_KEY, value ? '1' : '0') } catch { /* ignore */ }
}

/** 向导步骤文案。 */
const STEPS: ReadonlyArray<{ title: string, detail: string }> = [
  { title: '① 选一支团队', detail: '顶部下拉切换；没有合适的就「✨」一句话生成，或「＋」套用出厂编制。' },
  { title: '② 设团队默认模型', detail: '所有角色默认继承它即可跑通，之后可在角色卡上按需单独覆盖。' },
  { title: '③ 打开对话流开关', detail: '对话框输入区的 👥 按钮选「随对话执行」，直接派活——各角色的实时进度会浮现在对话区。' },
]

/** 新手向导卡。 */
export function GuideCard(): JSX.Element {
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())

  const dismiss = useCallback((): void => {
    writeDismissed(true)
    setDismissed(true)
  }, [])

  const expand = useCallback((): void => {
    writeDismissed(false)
    setDismissed(false)
  }, [])

  if (dismissed) {
    return (
      <button type="button" className="team-guide-mini" onClick={expand} title="展开新手向导">
        🧭 新手向导 · 不知道从哪开始？点这里看三步上手
      </button>
    )
  }

  return (
    <div className="team-guide team-surface">
      <div className="team-guide-head">
        <span className="team-guide-title">🧭 三步上手团队模式</span>
        <button type="button" className="psh-close" aria-label="收起向导" onClick={dismiss}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="team-guide-steps">
        {STEPS.map(step => (
          <div key={step.title} className="team-guide-step">
            <span className="team-guide-step-title">{step.title}</span>
            <span className="team-guide-step-detail">{step.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
