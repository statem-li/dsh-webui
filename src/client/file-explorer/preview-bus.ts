/**
 * 应用内文件预览卡的开合通道：DOM 点击接管层与 shell.overlay 预览宿主
 * 之间用窗口自定义事件解耦（同 FILE_EXPLORER_TOGGLE_EVENT 的模式）。
 */

/** 窗口事件名；`detail.path` 为要预览的文件路径（绝对或工作区相对）。 */
export const PREVIEW_FILE_EVENT = 'dsh-webui-preview-file'

/**
 * 请求以应用内滑出卡片打开某文件：图片走图片查看器，markdown 渲染展示，
 * 文本/代码走高亮查看器，二进制给十六进制兜底——全程不经系统打开。
 */
export function requestFilePreview(path: string): void {
  window.dispatchEvent(new CustomEvent(PREVIEW_FILE_EVENT, { detail: { path } }))
}
