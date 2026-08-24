/**
 * dsh-provider-hub — 全局样式注入 + 隐藏官方「模型」导航项。
 */
const STYLE_ID = 'dsh-provider-hub-styles'
let injected = false

/** 注入全局样式；返回移除函数。 */
export function injectStyles(): () => void {
  if (!injected) {
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-provider-hub'
    tag.textContent = `
.phub-host{display:flex;flex-direction:column;gap:20px}
.phub-block-title{font-size:14px;font-weight:600;margin-bottom:8px}
.phub-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#888);margin-bottom:10px}
`
    document.head.appendChild(tag)
    injected = true
  }
  return () => {
    if (!injected) return
    document.getElementById(STYLE_ID)?.remove()
    injected = false
  }
}

/** 官方「模型」页导航项 label（中英文），用于文本匹配隐藏。 */
const MODEL_LABELS = new Set(['模型', 'Models'])

/**
 * 隐藏设置导航中官方「模型」项。官方导航项没有稳定 DOM 锚点
 * （SettingsRoot.tsx 里 nav 项是 <button>，仅 React key + navLabel 文本），
 * 故用 MutationObserver 匹配 label 文本隐藏；匹配失败则官方页与「供应商」
 * 页并存（设计文档 §8 已预见的降级路径）。
 */
export function hideOfficialModelsNav(): () => void {
  /** 被本模块隐藏的按钮：dispose 时逐个还原，避免关闭模块后官方页永久消失。 */
  const hidden = new Set<HTMLElement>()
  const hide = (): void => {
    // 设置弹窗未打开时整页没有 nav>button：直接返回，省掉逐按钮读文本。
    const buttons = document.querySelectorAll<HTMLElement>('nav button')
    if (buttons.length === 0) return
    for (const btn of buttons) {
      const label = btn.querySelector('span')?.textContent?.trim() ?? btn.textContent?.trim() ?? ''
      if (!MODEL_LABELS.has(label)) continue
      if (btn.style.display === 'none') continue
      btn.style.display = 'none'
      hidden.add(btn)
    }
  }
  // 观察器挂在 body 全子树上，对话流式渲染期间每秒可触发上百次；回调只允许
  // 排一个短延时任务，真正的查询按批合并执行（未节流版本会在每个 mutation
  // 批次里跑一次全树 querySelectorAll + 逐按钮读文本，属性能红线）。
  let timer: number | undefined
  const schedule = (): void => {
    if (timer !== undefined) return
    timer = window.setTimeout(() => {
      timer = undefined
      hide()
    }, 60)
  }
  hide()
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    if (timer !== undefined) window.clearTimeout(timer)
    for (const btn of hidden) btn.style.removeProperty('display')
    hidden.clear()
  }
}
