/**
 * dsh-image-gallery — 生图画廊渲染组件（会话节点）。
 *
 * 将一次会话中 generate_image 的成功结果渲染为并排缩略图：
 *   - 缩略图直接嵌入消息流（无卡片外壳、无标题行），多图并排、单图大图；
 *   - 单击缩略图打开原图 Lightbox（Esc / 点击遮罩关闭）；
 *   - Lightbox 通过 createPortal 挂到 document.body —— 祖先容器带
 *     backdrop-filter / transform 时 position:fixed 会被钉进局部坐标系，
 *     全屏遮罩塌成卡片内一块，必须 portal 出去才能真全屏居中；
 *   - Lightbox 右上角「保存图片」按钮：优先弹系统「另存为」对话框
 *     （showSaveFilePicker，位置和文件名由用户自选）；不支持该 API 的
 *     浏览器自动降级为普通下载（浏览器默认下载目录）；
 *   - 链接失效（生图链接仅 24 小时有效）时显示占位提示。
 *
 * 视图本体抽在 GalleryStrip（与 markdown image_strip 共用）；本组件只做
 * 会话节点数据 → 视图 的桥接与 locale 文案映射。
 */
import { useMemo } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { GalleryStrip, type GalleryStripLabels, type GalleryStripItem } from './GalleryStrip'

type GalleryViewProps =
  PropsRuntime<'conversation.chat.node', 'generated-images'>
  & PropsLocale<'gallery'>

export function GeneratedImageGallery({ node, t }: GalleryViewProps) {
  const labels = useMemo<GalleryStripLabels>(() => ({
    thumbTitle: t('gig.thumbTitle'),
    hint: t('gig.hint'),
    broken: t('gig.broken'),
    lightboxAria: t('gig.lightboxAria'),
    save: t('gig.save'),
    saving: t('gig.saving'),
    saved: t('gig.saved'),
    saveFailed: t('gig.saveFailed'),
    head: n => t('gig.head', { n }),
  }), [t])
  const images = useMemo<readonly GalleryStripItem[]>(
    () => node.data.images.map(image => ({ url: image.url, model: image.model })),
    [node.data.images],
  )
  return <GalleryStrip images={images} labels={labels} />
}
