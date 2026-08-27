/**
 * dsh-memory embedding 引擎：把「语义检索」从预留变成可用。
 *
 * 背景：DSH 的 llm 服务只暴露 stream()（chat completion），无 embedding 接口，
 * 因此语义检索需要自带 embedding 提供方。参考 opencontext（@melandlabs）的做法，
 * 提供两种模式：
 *  - http：OpenAI 兼容 /v1/embeddings（兼容任意 OpenAI 兼容网关，含 ollama
 *    `openai` 兼容端点、one-api、new-api 等）。零额外依赖，用全局 fetch。
 *  - local：@xenova/transformers 本地 ONNX（默认 Xenova/all-MiniLM-L6-v2，
 *    384 维）。依赖体积大且首次加载慢，做成动态 import + 懒加载：未安装该依赖时
 *    优雅降级到 hybrid，不崩溃。
 *
 * 安全：http 模式的 apiKey 优先读环境变量 DSH_MEMORY_EMBEDDING_API_KEY，
 * 其次读配置；绝不写日志。
 *
 * 性能护栏：embedding 只在「显式 semantic 检索」时按需计算并缓存到条目
 * （entry.embedding，schema v2 已预留），不做全量预热——插件性能红线不破。
 */

export type EmbeddingBackend = 'http' | 'local'

export interface EmbeddingProvider {
  readonly backend: EmbeddingBackend
  readonly model: string
  readonly dimensions: number
  /** 批量计算文本向量。返回与输入等长的数组。 */
  embed(texts: string[]): Promise<number[][]>
}

/** 计算配置所需的 provider 是否可用（http 需 baseUrl；local 需依赖可加载）。 */
export function resolveEmbeddingProvider(config: {
  embeddingProvider: 'off' | 'http' | 'local'
  embeddingBaseUrl: string
  embeddingModel: string
  embeddingApiKey: string
  embeddingDimensions: number
}): EmbeddingProvider | null {
  if (config.embeddingProvider === 'off') return null
  if (config.embeddingProvider === 'http') {
    const baseUrl = config.embeddingBaseUrl.trim().replace(/\/+$/, '')
    if (baseUrl === '') return null
    return new HttpEmbeddingProvider({
      baseUrl,
      model: config.embeddingModel.trim() || 'text-embedding-3-small',
      apiKey: config.embeddingApiKey.trim() || envApiKey(),
      dimensions: config.embeddingDimensions > 0 ? config.embeddingDimensions : 0,
    })
  }
  // local：懒加载校验依赖，失败返回 null（调用方回退 hybrid）。
  return new LocalEmbeddingProvider(config.embeddingModel.trim() || 'Xenova/all-MiniLM-L6-v2')
}

function envApiKey(): string {
  try {
    return process.env.DSH_MEMORY_EMBEDDING_API_KEY ?? ''
  } catch {
    return ''
  }
}

// ── OpenAI 兼容 HTTP 实现 ────────────────────────────────────────────────

interface HttpOptions {
  baseUrl: string
  model: string
  apiKey: string
  dimensions: number
  timeoutMs?: number
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly backend = 'http' as const
  readonly model: string
  readonly dimensions: number
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number
  /** 单次请求最大输入条数（OpenAI 上限 2048，保守 256）。 */
  private static readonly BATCH_SIZE = 256

  constructor(options: HttpOptions) {
    this.baseUrl = options.baseUrl
    this.model = options.model
    this.apiKey = options.apiKey
    this.dimensions = options.dimensions
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += HttpEmbeddingProvider.BATCH_SIZE) {
      const chunk = texts.slice(i, i + HttpEmbeddingProvider.BATCH_SIZE)
      out.push(...await this.embedChunk(chunk))
    }
    return out
  }

  private async embedChunk(texts: string[]): Promise<number[][]> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey !== '' ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`embedding http ${response.status}: ${detail.slice(0, 200)}`)
      }
      const data = await response.json() as { data?: Array<{ embedding?: number[] }> }
      const embeddings = data.data?.map(item => item.embedding)
      if (!Array.isArray(embeddings) || embeddings.some(vec => !Array.isArray(vec))) {
        throw new Error('embedding http: unexpected response shape')
      }
      return embeddings as number[][]
    } finally {
      clearTimeout(timer)
    }
  }
}

// ── 本地 ONNX 实现（懒加载 @xenova/transformers） ───────────────────────

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly backend = 'local' as const
  readonly model: string
  dimensions = 0
  private pipeline: Promise<unknown> | null = null
  private failure: Error | null = null

  constructor(model: string) {
    this.model = model
  }

  private async ensurePipeline(): Promise<unknown> {
    if (this.failure !== null) throw this.failure
    if (this.pipeline === null) {
      this.pipeline = (async () => {
        try {
          // 动态 import：依赖未安装时抛 MODULE_NOT_FOUND，捕获后降级。
          // @xenova/transformers 是可选依赖，不加入 package.json（体积大、加载慢），
          // 类型擦除：未安装模块无类型声明，用 any 桥接。
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mod = await import(/* @vite-ignore */ '@xenova/transformers' as string) as {
            pipeline: (task: string, model: string, options: { quantized: boolean }) => Promise<EmbedFn>
          }
          const pipe = await mod.pipeline('feature-extraction', this.model, { quantized: true })
          // 探测维度：跑一次空文本。
          const probe = await pipe('', { pooling: 'mean', normalize: true })
          this.dimensions = Array.isArray(probe.data) ? probe.data.length : 384
          return pipe
        } catch (error) {
          this.failure = error instanceof Error ? error : new Error(String(error))
          this.pipeline = null
          throw this.failure
        }
      })()
    }
    return this.pipeline
  }

  async embed(texts: string[]): Promise<number[][]> {
    const pipe = await this.ensurePipeline() as EmbedFn
    const out: number[][] = []
    for (const text of texts) {
      const result = await pipe(text, { pooling: 'mean', normalize: true })
      out.push(Array.from(result.data))
    }
    return out
  }
}

/** @xenova/transformers pipeline 的最小形状（擦除类型用于可选依赖）。 */
interface EmbedFn {
  (text: string, options: { pooling: string; normalize: boolean }): Promise<{ data: ArrayLike<number> }>
}

// ── 余弦相似度 ───────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 归一化到 0-1：cosine ∈ [-1, 1] → (cos + 1) / 2。 */
export function normalizedCosine(a: number[], b: number[]): number {
  return (cosineSimilarity(a, b) + 1) / 2
}
