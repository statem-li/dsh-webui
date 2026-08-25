/**
 * dsh-image-gallery — 生图 URL 注册表（client 内共享）。
 *
 * definition 监听会话事件流，凡是从 generate_image 的 tool/result 里成功解析出的
 * 图片 URL 都登记到这里；markdown 渲染器（better-markdown 的 image_strip）
 * 用它识别「模型在回复正文里用 ![]() 引用的这张图是不是生图结果」——
 * 命中才把 markdown 大图降级为画廊缩略图（并排 + 点击全屏），普通图片不受影响。
 *
 * 模块级 Set、跨会话累积：URL 是一次性资源（24h 失效），条目极小，
 * 不做清理也不会有内存压力；幂等 add 无需去重逻辑。
 */

const known = new Set<string>()

/** 归一化：去 query/hash 与尾斜杠——模型引用同一张图时可能带上无关参数。 */
function normalize(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.href.replace(/\/+$/, '')
  } catch {
    return url.trim().replace(/\/+$/, '')
  }
}

/** 登记一批生图结果 URL（definition 解析 tool/result 成功后调用）。 */
export function registerGeneratedImageUrls(urls: readonly string[]): void {
  for (const url of urls) {
    if (typeof url === 'string' && url !== '') known.add(normalize(url))
  }
}

/** 该 URL 是否是本会话已知的生图结果。 */
export function isGeneratedImageUrl(url: string): boolean {
  return known.has(normalize(url))
}
