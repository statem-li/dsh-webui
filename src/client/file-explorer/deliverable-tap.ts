/**
 * 产物 chip / 正文文件提及的点击接管：在 document 的 capture 阶段截获点击，
 * 赶在事件到达 React 挂在根容器的委托监听之前止住传播，官方 onClick 里的
 * openFile（Host 系统方式打开）便不会触发；随后派发应用内预览事件，
 * 由 FileExplorerEntry 的预览卡接手。选择器锚点：
 *  - 官方 ui-deliverables 产物行容器自带 data-produced-files-row，chip 为
 *    button[title=完整路径]（title 即路径消歧器）；
 *  - 本插件 markdown 渲染器的文件提及按钮 dsh-better-markdown__file-mention
 *    同样以 title 承载完整路径。
 */

import { requestFilePreview } from './preview-bus.ts'

const CHIP_SELECTOR = '[data-produced-files-row] button[title]'
const MENTION_SELECTOR = 'button.dsh-better-markdown__file-mention[title]'

/** 安装全局 capture 点击拦截；返回卸载函数（ctx.effect 生命周期管理）。 */
export function installDeliverableTap(): () => void {
  const onCaptureClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const hit = target.closest(CHIP_SELECTOR) ?? target.closest(MENTION_SELECTOR)
    if (hit === null) return
    const path = hit.getAttribute('title')
    if (path === null || path === '') return
    // capture 阶段止住传播：根容器上的 React 委托监听收不到，系统打开不发生。
    event.preventDefault()
    event.stopPropagation()
    requestFilePreview(path)
  }
  document.addEventListener('click', onCaptureClick, true)
  return () => { document.removeEventListener('click', onCaptureClick, true) }
}
