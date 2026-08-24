/**
 * ProviderIcon — 供应商标官方图标。
 *
 * 按 provider route id 匹配内置的官方 SVG（品牌色标 / currentColor 单色标，
 * 数据见 {@link ./provider-icons.data.ts}），未收录的供应商回退为
 * 「首字母圆标」，保证任何自定义网关都有稳定占位。
 *
 * 单色标使用 fill="currentColor"，随主题文字色变化；彩色标保留官方品牌色，
 * 深浅两套主题下均可读。SVG 以 width/height="1em" 书写，尺寸由 font-size 控制。
 */
import type { CSSProperties, ReactNode } from 'react'
import { PROVIDER_ICON_SVGS } from './provider-icons.data.ts'

/**
 * provider route id → 图标 key 的精确映射（覆盖 pi-ai 内置目录与常见聚合/国产厂商）。
 */
const EXACT_KEYS: Record<string, string> = {
  // pi-ai 内置目录
  'amazon-bedrock': 'bedrock',
  'anthropic': 'anthropic',
  'azure-openai-responses': 'azure',
  'cerebras': 'cerebras',
  'deepseek': 'deepseek',
  'fireworks': 'fireworks',
  'github-copilot': 'githubcopilot',
  'google': 'gemini',
  'google-vertex': 'vertexai',
  'groq': 'groq',
  'huggingface': 'huggingface',
  'kimi-coding': 'kimi',
  'minimax': 'minimax',
  'mistral': 'mistral',
  'moonshotai': 'moonshot',
  'nvidia': 'nvidia',
  'openai': 'openai',
  'openai-codex': 'openai',
  'opencode': 'opencode',
  'openrouter': 'openrouter',
  'together': 'together',
  'vercel-ai-gateway': 'vercel',
  'xai': 'xai',
  'xiaomi': 'mimo',
  'zai': 'zai',
  // 常见自定义 / 聚合网关 / 国产厂商别名
  'siliconflow': 'siliconflow',
  'siliconcloud': 'siliconflow',
  'volcengine': 'volcengine',
  'doubao': 'doubao',
  'hunyuan': 'hunyuan',
  'spark': 'spark',
  'stepfun': 'stepfun',
  'baichuan': 'baichuan',
  'yi': 'yi',
  '01ai': 'yi',
  'perplexity': 'perplexity',
  'cohere': 'cohere',
  'meta': 'meta',
  'llama': 'meta',
}

/**
 * 解析一个 provider route id 的图标 key：先查精确表，再按家族前缀归一化
 * （同一厂商的 -cn / 区域变体共用一个标）。
 * @param provider - provider route id，如 `moonshotai-cn`。
 * @returns 图标 key；未收录返回 undefined。
 */
export function iconKeyForProvider(provider: string): string | undefined {
  const exact = EXACT_KEYS[provider]
  if (exact !== undefined) return exact
  if (provider.startsWith('qwen')) return 'qwen'
  if (provider.startsWith('xiaomi')) return 'mimo'
  if (provider.startsWith('cloudflare')) return 'cloudflare'
  if (provider.startsWith('opencode')) return 'opencode'
  if (provider.startsWith('openrouter')) return 'openrouter'
  if (provider.startsWith('moonshot')) return 'moonshot'
  if (provider.startsWith('minimax')) return 'minimax'
  if (provider.startsWith('vercel')) return 'vercel'
  if (provider.startsWith('azure')) return 'azure'
  if (provider.includes('bedrock') || provider.startsWith('amazon')) return 'bedrock'
  if (provider.startsWith('google')) return provider.includes('vertex') ? 'vertexai' : 'gemini'
  if (provider.startsWith('zai')) return provider === 'zai' || provider.startsWith('zai-web') ? 'zai' : 'zhipu'
  return undefined
}

/** 圆形首字母占位标的样式（与行卡片 14px 名字视觉平衡）。 */
function monogramStyle(size: number): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    border: '1px solid var(--dsw-alias-border-l3, #c9cdd4)',
    background: 'var(--dsw-alias-bg-module-platform, #f2f3f5)',
    color: 'var(--dsw-alias-label-secondary, #4e5969)',
    fontSize: Math.max(10, Math.round(size * 0.52)), lineHeight: 1,
    fontWeight: 600,
  }
}

/**
 * 渲染供应商标图标：命中内置 SVG 时注入原始标记（构建期内置静态内容，
 * 不含任何用户输入）；否则渲染显示名首字符的圆形占位标。
 * @param props - provider route id、展示名（fallback 与 title 用）、尺寸 px。
 */
export function ProviderIcon({ provider, name, size = 18 }: {
  provider: string
  /** 展示名：用于 fallback 首字母与悬停提示。 */
  name?: string
  /** 边长 px，默认 18。 */
  size?: number
}): ReactNode {
  const key = iconKeyForProvider(provider)
  const svg = key === undefined ? undefined : PROVIDER_ICON_SVGS[key]
  if (svg !== undefined) {
    return (
      <span
        aria-hidden={true}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: size, height: size, fontSize: size, flexShrink: 0,
        }}
        title={name}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }
  const letter = (name ?? provider).trim().charAt(0).toUpperCase() || '?'
  return (
    <span style={monogramStyle(size)} title={name ?? provider} aria-hidden={true}>{letter}</span>
  )
}
