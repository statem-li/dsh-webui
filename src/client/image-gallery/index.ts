/**
 * dsh-image-gallery — client 半身：注册生图画廊会话节点。
 *
 * 槽位：conversation.chat.node（会话语料流节点渲染器，按 kind 键控）。
 * 事件：conversationEvents.register() 监听 generate_image 的
 *  tool/call + tool/result，累计成功图片后发布「generated-images」节点。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 拉入 ui-conversation / ui-slots 的类型契约（槽位注册）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { generatedImagesDefinition, type GeneratedImagesChatData } from './definition'
import { GeneratedImageGallery } from './GeneratedImageGallery'
import { en, zh, type GalleryKey } from './locales'
import { injectStyles } from './styles'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** 同一轮（turn）生图的成功结果（归并画廊，多图并排一行）。 */
    'generated-images': GeneratedImagesChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The image-gallery strip copy. */
    gallery: GalleryKey
  }
}

const NS = 'gallery'

/** 保护 Lightbox 内的原生右键菜单：外部注入（扩展/宿主）可能在
 * document capture 阶段 preventDefault contextmenu，导致放大后右键无反应。
 * 这里在 window capture（更早）拦截，仅对画廊遮罩内的右键生效，
 * 让浏览器原生「另存为」菜单恢复；画廊外行为完全不变。 */
function protectLightboxContextMenu(): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    if (target !== null && target.closest('.gig-backdrop') !== null) {
      event.stopImmediatePropagation()
    }
  }
  window.addEventListener('contextmenu', onContextMenu, true)
  return () => window.removeEventListener('contextmenu', onContextMenu, true)
}

export function applyImageGallery(ctx: ClientContext): void {
  injectStyles()
  ctx.effect(protectLightboxContextMenu, '@dsh-external/dsh-image-gallery: lightbox context-menu guard')
  ctx.conversationEvents.register(generatedImagesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), '@dsh-external/dsh-image-gallery: dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'generated-images',
    locale: NS,
  }, GeneratedImageGallery))
}

// 类型再导出：渲染组件通过这个窄类型接收节点数据（组件内部不需要）。
export type { GeneratedImagesChatData, GeneratedImageEntry } from './definition'
export type { GalleryKey } from './locales'