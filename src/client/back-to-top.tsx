/**
 * back-to-top — 移动端「回到顶部」浮钮。
 *
 * 长会话在手机上无便捷回到顶部，本组件在会话滚动容器滚动超过阈值后淡入一个
 * 44px 圆形浮钮，点击平滑回到顶部。挂载于 conversation.composer.dock 槽
 * （与 StatsLineShadow 同槽，order 更大置顶，id=webui-back-to-top）。
 *
 * 红线 A：注入式 CSS 注释未写出「星号紧跟正斜杠」两字符序列。
 * 红线 C：浮钮 transform/opacity 过渡均包在 @media (prefers-reduced-motion: reduce)
 *         里降级到终态，不写入任何媒体外全局选择器。
 * 动效偏好：淡入 + 上移 + 缩放三合一，且按压缩放反馈；用户体验「减少动态」时直接到终态。
 */
import { useEffect, useState } from 'react'

const STYLE_ID = 'dsh-webui-back-to-top'

/** 显示阈值：滚动超过该 px 才淡入浮钮。 */
const SHOW_THRESHOLD = 400

const SHEET = `
#webui-back-to-top {
  position: fixed;
  right: calc(var(--webui-safe-right, 0px) + 14px);
  bottom: calc(var(--webui-safe-bottom, 0px) + 80px);
  z-index: 200;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-elevated, rgba(28,30,34,.92));
  color: var(--dsw-alias-text-primary, #fff);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
  cursor: pointer;
  opacity: 0;
  transform: translateY(8px) scale(.92);
  pointer-events: none;
  transition: opacity 200ms ease, transform 200ms ease, background-color 120ms ease;
}
#webui-back-to-top.show {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
#webui-back-to-top:active {
  transform: scale(.94);
  background-color: rgba(80,90,120,.92);
}
@media (prefers-reduced-motion: reduce) {
  #webui-back-to-top { transition: none; }
  #webui-back-to-top.show { transform: none; }
  #webui-back-to-top:active { transform: none; }
}
`

/** 幂等注入样式；返回移除函数。 */
function ensureStyle(): () => void {
  if (typeof document === 'undefined') return () => {}
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = '@dsh-external/dsh-webui'
    tag.dataset.pluginCss = 'webui/back-to-top'
    tag.textContent = SHEET
    document.head.appendChild(tag)
  }
  return () => { tag?.remove() }
}

/** 回到顶部浮钮。 */
export function BackToTopButton(): JSX.Element | null {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const removeStyle = ensureStyle()
    const scroller = document.querySelector('[data-conversation-scroll]')
    const onScroll = (): void => {
      const el = (scroller as HTMLElement | null) ?? document.scrollingElement
      setShow((el?.scrollTop ?? 0) > SHOW_THRESHOLD)
    }
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      scroller?.removeEventListener('scroll', onScroll)
      removeStyle()
    }
  }, [])

  const scrollTop = (): void => {
    const el = document.querySelector('[data-conversation-scroll]') as HTMLElement | null
    el?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <button
      id="webui-back-to-top"
      type="button"
      className={show ? 'show' : ''}
      aria-label="回到顶部"
      onClick={scrollTop}
    >
      ▲
    </button>
  )
}
