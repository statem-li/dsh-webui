/**
 * webui — PlanWeave DshExecutorAdapter（host 半身，ctx.llm 执行路径）。
 *
 * 把 PlanWeave 的「执行一个 block / 评审 / 反馈」映射到 DSH 的 `ctx.llm.stream`：
 * - 实现块：用渲染好的 block prompt 调用 DSH 已配置模型，产出实现报告文本。
 * - 评审块：调用模型产出 `{ verdict, content }` JSON，verdict ∈ passed|needs_changes。
 * - 反馈：调用模型按评审意见产出修复报告文本。
 *
 * 产物先写到系统临时目录，交给 engine.submit* 落盘到 results/（由 runtime 托管）。
 * 这是 Phase 0 的「DSH LLM 执行器」；后续可再补「DSH subagent 完整 agent」路径。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// ── 最小 LLM 服务契约（避免拉入 dsh 完整类型依赖链；与 automation-host 同款） ──

export interface DshLlmChunk {
  type: string
  text?: string
  reason?: { kind: string; failure?: { message?: string } }
}

export interface DshLlm {
  stream(opts: {
    provider: string
    model: string
    messages: unknown[]
    system?: string
    maxTokens?: number
    signal?: AbortSignal
  }): AsyncIterable<DshLlmChunk>
}

export interface ExecutorModel {
  provider: string
  model: string
  maxTokens?: number
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_MAX_TOKENS = 4096

/** 执行超时错误。 */
export class ExecutorTimeoutError extends Error {
  constructor() {
    super('PlanWeave 执行超时')
    this.name = 'ExecutorTimeoutError'
  }
}

/**
 * 用 DSH LLM 流式生成一段文本（只累积 text-delta，忽略 reasoning）。
 * 超时或模型异常终止时抛错。
 */
export async function llmGenerate(
  llm: DshLlm,
  model: ExecutorModel,
  system: string,
  prompt: string,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), model.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let out = ''
  try {
    const messages = [createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'dsh-webui' },
    })]
    for await (const chunk of llm.stream({
      provider: model.provider,
      model: model.model,
      messages,
      system,
      maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
      signal: controller.signal,
    })) {
      if (chunk.type === 'text-delta') {
        out += chunk.text ?? ''
        continue
      }
      if (chunk.type !== 'finish') continue
      const reason = chunk.reason
      if (reason === undefined) continue
      if (reason.kind === 'error' || reason.kind === 'aborted') {
        const message = reason.failure?.message
          ?? (reason.kind === 'aborted' ? 'PlanWeave 执行超时' : '模型调用失败')
        throw new Error(String(message))
      }
      if (reason.kind !== 'stop' && reason.kind !== 'max-tokens') {
        throw new Error(`模型未正常结束：${reason.kind}`)
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw new ExecutorTimeoutError()
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (out.trim() === '') throw new Error('模型未返回内容（可能触发了纯思考模型，请换一个有文本输出的模型）')
  return out
}

// ── 产物落盘（临时目录，交由 engine.submit* 托管） ──

const pwTmpDir = join(tmpdir(), 'dsh-planweave')

function writeTempFile(name: string, content: string): string {
  mkdirSync(pwTmpDir, { recursive: true })
  const path = join(pwTmpDir, `${Date.now()}-${randomUUID().slice(0, 8)}-${name}`)
  writeFileSync(path, content, 'utf8')
  return path
}

// ── 三类执行 prompt ──

function implementationSystem(): string {
  return [
    'You are a focused implementation agent executing one assigned PlanWeave block.',
    'Complete the block precisely using the rendered prompt below.',
    'Output a clear implementation report covering: what changed, behavior changed vs kept, validation run and result, remaining risks.',
    'Write the report in the SAME language as the prompt. No preamble outside the report.',
  ].join('\n')
}

function reviewSystem(): string {
  return [
    'You are a review gate for a PlanWeave implementation block.',
    'Judge the work against the acceptance criteria in the prompt.',
    'Output ONLY a single JSON object, no markdown fence, no prose, shaped exactly as:',
    '{"verdict":"passed"|"needs_changes","content":"..."}',
    'Use "passed" only when the work fully satisfies the criteria; otherwise "needs_changes" with concrete, actionable feedback in "content".',
    'Write "content" in the SAME language as the prompt.',
  ].join('\n')
}

function feedbackSystem(): string {
  return [
    'You are fixing a PlanWeave implementation block after a review returned "needs_changes".',
    'Apply the review feedback precisely.',
    'Output a short fix report: what was changed to address each feedback point, and the validation result.',
    'Write the report in the SAME language as the feedback.',
  ].join('\n')
}

/** 从 LLM 输出里稳健提取 JSON（容忍 markdown fence / 前后缀噪声）。 */
function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('评审模型未返回合法 JSON 对象')
  }
  const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('评审模型返回的不是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

export interface ReviewOutcome {
  verdict: 'passed' | 'needs_changes'
  content: string
}

// ── 对外执行接口 ──

/** 执行实现块：返回已写好的 report.md 路径。 */
export async function executeImplementation(
  llm: DshLlm,
  model: ExecutorModel,
  prompt: string,
  ref: string,
): Promise<{ reportPath: string }> {
  const text = await llmGenerate(llm, model, implementationSystem(), prompt)
  const reportPath = writeTempFile('report.md', `# ${ref}\n\n${text}\n`)
  return { reportPath }
}

/** 执行评审块：返回已写好的 review-result.json 路径 + 解析出的结论。 */
export async function executeReview(
  llm: DshLlm,
  model: ExecutorModel,
  prompt: string,
  ref: string,
  taskId: string,
): Promise<{ resultPath: string; outcome: ReviewOutcome }> {
  const text = await llmGenerate(llm, model, reviewSystem(), prompt)
  const obj = extractJsonObject(text)
  const verdict = obj.verdict === 'passed' ? 'passed' : 'needs_changes'
  const content = typeof obj.content === 'string' && obj.content.trim() !== ''
    ? obj.content
    : '评审未给出具体意见。'
  const resultPath = writeTempFile(
    'review-result.json',
    JSON.stringify({ reviewBlockRef: ref, taskId, verdict, content }, null, 2),
  )
  return { resultPath, outcome: { verdict, content } }
}

/** 执行反馈修复：返回已写好的 feedback report.md 路径。 */
export async function executeFeedback(
  llm: DshLlm,
  model: ExecutorModel,
  feedbackContent: string,
  ref: string,
): Promise<{ reportPath: string }> {
  const text = await llmGenerate(llm, model, feedbackSystem(), feedbackContent)
  const reportPath = writeTempFile('feedback-report.md', `# Fix for ${ref}\n\n${text}\n`)
  return { reportPath }
}

// ── Subagent 路径（完整 agent：能改文件/跑校验，最贴近 PlanWeave 原生 executor） ──

/** ContentBlock 最小形状（从 dsh-llm）。 */
export interface ContentBlockLike {
  type: string
  text?: string
}

/** SubagentRun 最小形状。 */
export interface SubagentRunLike {
  result: Promise<{
    output: ContentBlockLike[]
    structured?: unknown
    stopReason: string
    diagnostic?: string
  }>
  dispose(): Promise<void>
}

/** `ctx.subagents`（SubagentRuntime）最小形状。 */
export interface SubagentRuntimeLike {
  list(): string[]
  start(name: string, request: {
    parent: unknown
    prompt: ContentBlockLike[]
    label?: string
    signal?: AbortSignal
  }): Promise<SubagentRunLike>
}

/** 工具 execute 的 exec 参数（ToolRunContext）最小形状。 */
export interface ExecLike {
  agent?: unknown
  signal?: AbortSignal
}

/**
 * 从 host ctx 取 subagents 服务；未挂载返回 null（fallback 到 llm 路径）。
 *
 * 必须走 `ctx.get('subagents')`：cordis 对未在 inject 声明的服务做裸属性访问
 * （`ctx.subagents`）会抛 `cannot get property "subagents" without inject`，
 * 而不是返回 undefined —— 那会让整条执行链在此崩掉而非优雅降级。
 */
export function subagentRuntime(ctx: unknown): SubagentRuntimeLike | null {
  let rt: SubagentRuntimeLike | undefined
  try {
    rt = (ctx as { get?: (key: string) => unknown }).get?.('subagents') as SubagentRuntimeLike | undefined
  } catch {
    return null
  }
  return rt !== undefined && rt !== null && typeof rt.list === 'function' ? rt : null
}

/** 首个可用 subagent provider（spawn/fork/acp…）。 */
export function defaultSubagentProvider(ctx: unknown): string | null {
  const rt = subagentRuntime(ctx)
  if (rt === null) return null
  const names = rt.list()
  return names.length > 0 ? names[0] : null
}

function extractText(blocks: ContentBlockLike[] | undefined): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
}

/** 用 subagent 执行并返回提取的文本（失败/未完成抛错）。 */
async function runSubagentText(
  ctx: unknown,
  exec: ExecLike,
  provider: string,
  prompt: string,
  label: string,
): Promise<string> {
  const rt = subagentRuntime(ctx)
  if (rt === null) throw new Error('subagents 服务不可用')
  if (exec.agent === undefined) throw new Error('当前无 agent 上下文，无法派发 subagent')
  const run = await rt.start(provider, {
    parent: exec.agent,
    prompt: [{ type: 'text', text: prompt }],
    label,
    signal: exec.signal,
  })
  try {
    const result = await run.result
    if (result.stopReason !== 'completed' && result.stopReason !== 'max-tokens') {
      throw new Error(`subagent 未正常结束：${result.stopReason}${result.diagnostic ? ' — ' + result.diagnostic : ''}`)
    }
    const text = extractText(result.output)
    if (text === '') throw new Error('subagent 未返回内容')
    return text
  } finally {
    await run.dispose()
  }
}

function implementationPrompt(prompt: string): string {
  return [
    '你是实现 agent，完成下面这个 PlanWeave 实现块。',
    '完成后写一份清晰的实现报告（改了什么、行为变化、验证结果、剩余风险），报告语言与提示词一致。',
    '',
    prompt,
  ].join('\n')
}

function reviewPrompt(prompt: string): string {
  return [
    '你是评审门禁，评审下面的实现块是否满足验收标准。',
    '只输出一个 JSON 对象，无 markdown 围栏、无其它文字：{"verdict":"passed"|"needs_changes","content":"..."}',
    '只在完全满足时用 "passed"，否则 "needs_changes" 并在 content 给出具体可执行的反馈。content 语言与提示词一致。',
    '',
    prompt,
  ].join('\n')
}

function feedbackPrompt(feedbackContent: string): string {
  return [
    '你是实现 agent，按下面的评审反馈修复实现块。',
    '输出简短修复报告（改了哪些点、验证结果），语言与反馈一致。',
    '',
    feedbackContent,
  ].join('\n')
}

/** subagent 执行实现块。 */
export async function executeImplementationSubagent(
  ctx: unknown,
  exec: ExecLike,
  provider: string,
  prompt: string,
  ref: string,
): Promise<{ reportPath: string }> {
  const text = await runSubagentText(ctx, exec, provider, implementationPrompt(prompt), `实现 ${ref}`)
  const reportPath = writeTempFile('report.md', `# ${ref}\n\n${text}\n`)
  return { reportPath }
}

/** subagent 执行评审块。 */
export async function executeReviewSubagent(
  ctx: unknown,
  exec: ExecLike,
  provider: string,
  prompt: string,
  ref: string,
  taskId: string,
): Promise<{ resultPath: string; outcome: ReviewOutcome }> {
  const text = await runSubagentText(ctx, exec, provider, reviewPrompt(prompt), `评审 ${ref}`)
  const obj = extractJsonObject(text)
  const verdict = obj.verdict === 'passed' ? 'passed' : 'needs_changes'
  const content = typeof obj.content === 'string' && obj.content.trim() !== ''
    ? obj.content
    : '评审未给出具体意见。'
  const resultPath = writeTempFile(
    'review-result.json',
    JSON.stringify({ reviewBlockRef: ref, taskId, verdict, content }, null, 2),
  )
  return { resultPath, outcome: { verdict, content } }
}

/** subagent 执行反馈修复。 */
export async function executeFeedbackSubagent(
  ctx: unknown,
  exec: ExecLike,
  provider: string,
  feedbackContent: string,
  ref: string,
): Promise<{ reportPath: string }> {
  const text = await runSubagentText(ctx, exec, provider, feedbackPrompt(feedbackContent), `修复 ${ref}`)
  const reportPath = writeTempFile('feedback-report.md', `# Fix for ${ref}\n\n${text}\n`)
  return { reportPath }
}
