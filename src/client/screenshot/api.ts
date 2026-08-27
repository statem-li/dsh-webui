/**
 * webui — 对话截图 API 客户端（client 端）。
 *
 * 三个接口：/render（渲染进内存预览）、/save（落盘）、/reveal（打开目录）。
 */
import type { ShotMessage } from './collect.js'
// 设备/画质/画幅档与 host 端 presets.ts 共用同一份类型（type-only，运行时零依赖）。
import type { ShotAspect, ShotDevice, ShotQuality } from '../../screenshot/presets.js'

const ROUTE = '/api/webui-screenshot'

/** 截图主题（与 host 端 ShotTheme 对齐）。 */
export type ShotTheme = 'light' | 'dark' | 'glass' | 'glass-dark'

/** 渲染结果。 */
export interface RenderResult {
  id: string
  imageUrl: string
  width: number
  height: number
  bytes: number
  /** 固定画幅是否精确命中（false = 内容超出比例，已保留完整长图）。 */
  aspectLocked?: boolean
  /** 本次渲染使用的完整 HTML 文档（面板「元素删除」编辑模式取页面用）。 */
  html?: string
}

/** 渲染请求参数。 */
export interface RenderRequest {
  messages: readonly ShotMessage[]
  theme: ShotTheme
  /** 设备版式（电脑横幅 / 手机窄幅）。 */
  device: ShotDevice
  /** 输出画质档（决定输出像素宽度）。 */
  quality: ShotQuality
  /** 画幅比例；缺省自适应内容长度。 */
  aspect?: ShotAspect
  /** 卡片大标题（一般是会话标题，可在面板里改）。 */
  title?: string
  /** 页头徽章文案（截图范围，可编辑）。 */
  label?: string
  /** 编辑后的完整 HTML 文档（存在时 host 跳过卡片组装，直接渲染该页面）。 */
  html?: string
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ROUTE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as { ok?: boolean; error?: string } & Record<string, unknown>
  if (data.ok !== true) throw new Error(typeof data.error === 'string' ? data.error : `请求失败（HTTP ${res.status}）`)
  return data as unknown as T
}

/**
 * 渲染截图（结果留在 host 内存，未落盘）。
 * @param request - 消息、主题、宽度与文案。
 * @returns 预览地址与像素尺寸。
 */
export async function render(request: RenderRequest): Promise<RenderResult> {
  return await post<RenderResult>('/render', request)
}

/**
 * 保存已渲染的预览到本地截图目录。
 * @param id - 渲染返回的预览 id。
 * @returns 落盘路径与所在目录。
 */
export async function save(id: string): Promise<{ path: string; dir: string }> {
  return await post<{ path: string; dir: string }>('/save', { id })
}

/** 在系统文件管理器里打开截图目录。 */
export async function reveal(): Promise<void> {
  await post<{ dir: string }>('/reveal', {})
}
