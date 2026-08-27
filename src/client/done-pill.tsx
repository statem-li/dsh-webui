/**
 * webui — 对话完成胶囊（client 半身）。
 *
 * shell.overlay 顶部悬浮胶囊（常驻、可拖拽、位置持久化）：
 *  - 轮询 host 端 /api/webui-done-pill，任一会话（含后台会话）回合完成时
 *    显示「N 个对话完成 · 「会话」摘要」；
 *  - 点击胶囊主体直接跳进最新完成的会话；鼠标悬停时记录面板从下方滑出，
 *    展示每条的用户问题 + 助手回复全文；
 *  - 胶囊右侧内嵌「文件」按钮（事件桥开合文件浏览器抽屉）；
 *  - 整体黑色底（不随主题），按住拖拽可移动位置（pointer 拖拽，4px 阈值
 *    区分点击），位置存 localStorage（dsh.donePill.pos）；
 *  - 基础设置「对话完成胶囊」开关可整体隐藏（dsh.donePill.enabled）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { isMobileViewport } from './responsive'

export type DonePillProps = PropsRuntime<'shell.overlay'>

interface DoneEntry {
  seq: number
  id: string
  sessionId: string
  title: string
  question: string
  answer: string
  endedAt: number
  turn: number
  reasonKind: string
}

/** 轮询间隔（ms）。 */
const POLL_MS = 3000
/** 形变共同节奏：外壳宽度伸缩、位置滑动、主文案淡入三者同速，
 *  对称拉伸才严丝合缝；偏慢一档显得从容不抢眼。 */
const MORPH_DUR = '.65s'
/** 内存保留条目上限。 */
const MAX_ENTRIES = 100
/** localStorage 已读 id 上限。 */
const MAX_READ_IDS = 300

const READ_KEY = 'dsh.donePill.read'
const POS_KEY = 'dsh.donePill.pos'
const ENABLED_KEY = 'dsh.donePill.enabled'

// 运行时会话服务（点击跳转会话用；未提供时降级为不可跳转）。
let sessionsRuntime: { open(id: SessionId): void } | undefined

// ---- localStorage 工具 ----
// 持久化：已读 id 集合、胶囊位置、显隐开关；完成记录每次页面加载从 host
// 全量拉取恢复（host 保留最近 MAX_ITEMS 条），增量水位仅存内存。

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === 'string'))
    }
  } catch { /* 忽略 */ }
  return new Set()
}

function saveReadIds(ids: Set<string>): void {
  try {
    const arr = [...ids]
    localStorage.setItem(READ_KEY, JSON.stringify(arr.length > MAX_READ_IDS ? arr.slice(-MAX_READ_IDS) : arr))
  } catch { /* 忽略 */ }
}

interface PillPos { x: number; y: number }

/** 持久化的位置锚点：胶囊**中心点**的视口比率（0~1）。以中心为锚，
 *  内容扩宽/收窄、窗口缩放/最大化时都向两侧对称伸缩，不会只往一边跑。 */
interface PillAnchor { xc: number; yc: number }

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * 未拖拽时胶囊的默认纵向位置：移动端避让左上角菜单按钮（44px 浮钮，
 * top 8 + 高 44 → 底缘 52），胶囊从 60 起（间隔 8px）；桌面维持 40。
 */
function defaultShellTop(): number {
  return isMobileViewport() ? 60 : 40
}

/** 把位置夹回视口内并取整（防拖出屏幕；非整数像素会让文字发糊）。
 *  w/h = 胶囊**实际渲染尺寸**：旧实现固定按 160×56 估算，600px 宽的胶囊
 *  能被拖出屏幕大半（右缘算不进去）；缩放到 160% 时高度同理。 */
function clampPos(x: number, y: number, w = 160, h = 30): PillPos {
  const margin = 8
  const maxX = Math.max(margin, window.innerWidth - w - margin)
  const maxY = Math.max(margin, window.innerHeight - h - margin)
  return {
    x: Math.round(Math.min(Math.max(x, margin), maxX)),
    y: Math.round(Math.min(Math.max(y, margin), maxY)),
  }
}

/** localStorage 里可能出现过的全部历史格式字段。 */
type ParsedAnchor = Partial<PillAnchor & PillPos & { xr: number; yr: number }>

function loadAnchor(): PillAnchor | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as ParsedAnchor
      // 新格式：中心点视口比率。
      if (typeof parsed?.xc === 'number' && Number.isFinite(parsed.xc)
        && typeof parsed?.yc === 'number' && Number.isFinite(parsed.yc)) {
        return { xc: clamp01(parsed.xc), yc: clamp01(parsed.yc) }
      }
      // 更旧格式（左上角比率）：一次性迁移为中心点比率（按估宽 160 补正）。
      if (typeof parsed?.xr === 'number' && typeof parsed?.yr === 'number'
        && Number.isFinite(parsed.xr) && Number.isFinite(parsed.yr)) {
        return { xc: clamp01((parsed.xr * window.innerWidth + 80) / window.innerWidth), yc: clamp01(parsed.yr) }
      }
      // 最旧格式（绝对像素）：迁移为中心点比率。
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number'
        && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
        && window.innerWidth > 0 && window.innerHeight > 0) {
        return {
          xc: clamp01((parsed.x + 80) / window.innerWidth),
          yc: clamp01((parsed.y + 15) / window.innerHeight),
        }
      }
    }
  } catch { /* 忽略 */ }
  return null
}

function saveAnchor(anchor: PillAnchor): void {
  try { localStorage.setItem(POS_KEY, JSON.stringify(anchor)) } catch { /* 忽略 */ }
}

/** 胶囊外壳高度（px）：与 pillShellStyle 的 height 同源（30px × 缩放）。 */
function pillHeight(scale: number): number {
  return Math.max(1, Math.round(30 * scale))
}

/** 中心锚点 → 当前视口下的左上角坐标（shellWidth/shellHeight 为当前渲染尺寸）。
 *  高度必须参与换算：缩放到 160% 时半高是 24px 而非 15px，写死会让垂直位置漂移。 */
function anchorToPos(anchor: PillAnchor, shellWidth: number, shellHeight = 30): PillPos {
  return clampPos(
    Math.round(anchor.xc * window.innerWidth - shellWidth / 2),
    Math.round(anchor.yc * window.innerHeight - shellHeight / 2),
    shellWidth,
    shellHeight,
  )
}

// ---- 健康提醒（休息时间段 / 凌晨提示）----

const REST_KEY = 'dsh.donePill.rest'
const LATE_KEY = 'dsh.donePill.late'

interface ReminderConfig {
  /** 是否启用该提醒。 */
  enabled: boolean
  /** 开始 "HH:mm"。 */
  start: string
  /** 结束 "HH:mm"（早于 start 表示跨午夜，如 22:00-07:00）。 */
  end: string
}

/** 提醒配置 store（localStorage 持久化）。 */
interface ReminderStore {
  get: () => ReminderConfig
  set: (next: ReminderConfig) => void
  subscribe: (fn: (next: ReminderConfig) => void) => () => void
}

function createReminderStore(key: string, defaults: ReminderConfig): ReminderStore {
  let value: ReminderConfig = { ...defaults }
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<ReminderConfig>
      value = {
        enabled: parsed?.enabled === true,
        start: typeof parsed?.start === 'string' && /^\d{2}:\d{2}$/.test(parsed.start) ? parsed.start : defaults.start,
        end: typeof parsed?.end === 'string' && /^\d{2}:\d{2}$/.test(parsed.end) ? parsed.end : defaults.end,
      }
    }
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: ReminderConfig) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const restStore = createReminderStore(REST_KEY, { enabled: false, start: '13:00', end: '14:00' })
const lateStore = createReminderStore(LATE_KEY, { enabled: true, start: '00:00', end: '07:00' })

/** "HH:mm" → 当日分钟数；非法返回 null。 */
function parseHM(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm)
  if (match === null) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

/** 当前时刻是否落在 [start, end) 内；start === end 视为永不；跨午夜（start > end）取并集。 */
function inTimeRange(nowMinutes: number, config: ReminderConfig): boolean {
  const s = parseHM(config.start)
  const e = parseHM(config.end)
  if (s === null || e === null || s === e) return false
  return s < e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e
}

// ---- 平时轮播：开心话术 + AI 名词小知识 ----

type FunIconKind = 'sparkle' | 'bulb'

interface FunLine {
  icon: FunIconKind
  text: string
}

const FUN_LINES: FunLine[] = [
  // 开心话术（13 条）
  { icon: 'sparkle', text: '今天也是充满可能的一天！' },
  { icon: 'sparkle', text: '你解决问题的样子真的很酷' },
  { icon: 'sparkle', text: '每一行代码都在靠近目标' },
  { icon: 'sparkle', text: '休息一下，灵感往往在放松时出现' },
  { icon: 'sparkle', text: '已完成的每一个任务都算数' },
  { icon: 'sparkle', text: '保持好奇，世界会给你答案' },
  { icon: 'sparkle', text: '进步不必巨大，持续就很了不起' },
  { icon: 'sparkle', text: '深呼吸，一切都会顺利的' },
  { icon: 'sparkle', text: '记得喝水，身体是革命的本钱' },
  { icon: 'sparkle', text: '星光不问赶路人，时光不负有心人' },
  { icon: 'sparkle', text: '小步前进也是一种抵达' },
  { icon: 'sparkle', text: '你的努力，时间看得见' },
  { icon: 'sparkle', text: '笑一笑，bug 都会少一点' },
  // AI 名词小知识（100+ 条）
  { icon: 'bulb', text: 'LLM 大语言模型：通过海量文本训练、能理解并生成自然语言的 AI 模型' },
  { icon: 'bulb', text: 'Token 词元：模型处理文本的最小单位，一个汉字通常是 1~2 个' },
  { icon: 'bulb', text: 'Transformer：2017 年提出的注意力架构，现代大模型的基石' },
  { icon: 'bulb', text: 'Prompt 提示词：你发给 AI 的指令，写得越清晰回答越靠谱' },
  { icon: 'bulb', text: '微调 Fine-tuning：用特定数据继续训练，让它更擅长某个领域' },
  { icon: 'bulb', text: 'RAG 检索增强生成：先查资料再回答，让答案有据可依' },
  { icon: 'bulb', text: '幻觉 Hallucination：AI 一本正经编造不存在的事实，记得核实' },
  { icon: 'bulb', text: '多模态 Multimodal：能同时理解文字、图片、音频等信息的模型' },
  { icon: 'bulb', text: 'Agent 智能体：能自主规划步骤、调用工具、完成任务的 AI' },
  { icon: 'bulb', text: '上下文窗口 Context Window：模型一次能「看到」的最大文本长度' },
  { icon: 'bulb', text: '温度 Temperature：控制回答随机性的参数，越低越严谨' },
  { icon: 'bulb', text: 'Embedding 向量嵌入：把文字变成数字向量，可计算语义相似度' },
  { icon: 'bulb', text: '思维链 Chain-of-Thought：让 AI 一步步推理，复杂题正确率大增' },
  { icon: 'bulb', text: '蒸馏 Distillation：用大模型教小模型，更快更便宜' },
  { icon: 'bulb', text: '对齐 Alignment：让 AI 行为符合人类意图与价值观' },
  { icon: 'bulb', text: 'RLHF 人类反馈强化学习：用人类偏好训练，回答更合意' },
  { icon: 'bulb', text: '机器学习 ML：让计算机从数据中自动学规律，无需显式编程' },
  { icon: 'bulb', text: '深度学习 DL：用多层神经网络自动抽取特征的分支' },
  { icon: 'bulb', text: '神经网络：模拟人脑神经元连接的计算模型，深度学习的基石' },
  { icon: 'bulb', text: '参数 Parameter：模型内部可学习的数值，决定「记忆」与能力' },
  { icon: 'bulb', text: '权重 Weight：神经网络连接的强度数值，训练时不断被调整' },
  { icon: 'bulb', text: '训练 Training：用海量数据反复调整参数、让模型学会任务' },
  { icon: 'bulb', text: '推理 Inference：训练好的模型对输入计算并输出结果' },
  { icon: 'bulb', text: '数据集 Dataset：用于训练与评估模型的样本集合' },
  { icon: 'bulb', text: '语料库 Corpus：大规模文本集合，大模型训练的主要原料' },
  { icon: 'bulb', text: '注意力机制 Attention：让模型聚焦输入中关键部分的技术' },
  { icon: 'bulb', text: '自注意力 Self-Attention：让每个词关联上下文中的所有词' },
  { icon: 'bulb', text: '多头注意力 Multi-Head：并行多组注意力，捕捉不同关系' },
  { icon: 'bulb', text: '编码器 Encoder：把输入编码成向量表示的模块' },
  { icon: 'bulb', text: '解码器 Decoder：根据编码信息逐字生成的模块' },
  { icon: 'bulb', text: '位置编码 Positional Encoding：让模型感知词序的方法' },
  { icon: 'bulb', text: '残差连接 Residual：跨层直连通道，缓解深层网络退化' },
  { icon: 'bulb', text: '归一化 Normalization：稳定数值分布、加速训练的技巧' },
  { icon: 'bulb', text: '激活函数 Activation：引入非线性，让网络能学复杂关系' },
  { icon: 'bulb', text: '预训练 Pre-training：在大规模语料上无监督学习通用知识' },
  { icon: 'bulb', text: '监督微调 SFT：用问答范例教模型按指令作答' },
  { icon: 'bulb', text: '损失函数 Loss：衡量预测与目标的差距，指导参数更新' },
  { icon: 'bulb', text: '梯度下降 Gradient Descent：沿梯度方向迭代减小误差' },
  { icon: 'bulb', text: '学习率 Learning Rate：每步参数更新的步幅' },
  { icon: 'bulb', text: '批大小 Batch Size：一次训练喂给模型的样本数' },
  { icon: 'bulb', text: '轮次 Epoch：完整过一遍训练数据的次数' },
  { icon: 'bulb', text: '过拟合 Overfitting：模型死记训练数据、泛化能力差' },
  { icon: 'bulb', text: '欠拟合 Underfitting：模型没学到足够规律，训练集都做不好' },
  { icon: 'bulb', text: '正则化 Regularization：抑制过拟合的一系列手段' },
  { icon: 'bulb', text: '早停 Early Stopping：验证集不再提升就提前结束训练' },
  { icon: 'bulb', text: '量化 Quantization：压缩数值精度，减小体积加速推理' },
  { icon: 'bulb', text: '剪枝 Pruning：移除冗余参数，给模型瘦身' },
  { icon: 'bulb', text: '迁移学习 Transfer Learning：把已学知识迁移到新任务' },
  { icon: 'bulb', text: '分词器 Tokenizer：把文本切分成词元序列的工具' },
  { icon: 'bulb', text: '生成 Generation：模型逐字预测下一个词元的过程' },
  { icon: 'bulb', text: '自回归 Autoregressive：用已生成的词预测下一个词' },
  { icon: 'bulb', text: '采样 Sampling：按概率分布随机选择下一个词' },
  { icon: 'bulb', text: 'Top-p 核采样：只在累计概率达 p 的候选词中采样' },
  { icon: 'bulb', text: 'Top-k 采样：只在概率最高的 k 个词中采样' },
  { icon: 'bulb', text: '贪心解码 Greedy：每步都选概率最高的词，稳定但易重复' },
  { icon: 'bulb', text: '束搜索 Beam Search：保留多条候选路径，兼顾质量与多样' },
  { icon: 'bulb', text: '停止词 Stop Token：标记生成结束的特殊词元' },
  { icon: 'bulb', text: '长度惩罚 Length Penalty：调节输出长短倾向的参数' },
  { icon: 'bulb', text: '推理 Reasoning：模型推导、计算、多步思考的能力' },
  { icon: 'bulb', text: '提示工程 Prompt Engineering：设计输入让模型表现更好' },
  { icon: 'bulb', text: '少样本提示 Few-shot：给几个范例，模型照着格式做' },
  { icon: 'bulb', text: '零样本 Zero-shot：不给范例，直接提问' },
  { icon: 'bulb', text: '上下文学习 In-Context Learning：靠提示词临时学会任务' },
  { icon: 'bulb', text: '自一致性 Self-Consistency：多次采样投票，取多数答案' },
  { icon: 'bulb', text: '思维树 Tree-of-Thoughts：多分支探索推理路径并回溯' },
  { icon: 'bulb', text: '规划 Planning：把复杂任务拆解成可执行步骤' },
  { icon: 'bulb', text: '向量数据库 Vector DB：存储并检索高维向量的数据库' },
  { icon: 'bulb', text: '相似度检索 Similarity Search：按向量距离找最相关内容' },
  { icon: 'bulb', text: '余弦相似度 Cosine：衡量两向量方向接近程度的指标' },
  { icon: 'bulb', text: '知识库 Knowledge Base：供检索引用的结构化资料集合' },
  { icon: 'bulb', text: '分块 Chunking：把长文档切成便于检索的小段' },
  { icon: 'bulb', text: '重排序 Rerank：对召回结果二次排序，提升相关性' },
  { icon: 'bulb', text: '语义搜索 Semantic Search：按含义而非关键词匹配' },
  { icon: 'bulb', text: '混合检索 Hybrid：关键词 + 向量两种方式结合' },
  { icon: 'bulb', text: '工具调用 Function Calling：模型按需调用外部函数或 API' },
  { icon: 'bulb', text: '多智能体 Multi-Agent：多个智能体分工协作完成目标' },
  { icon: 'bulb', text: '记忆 Memory：智能体跨轮次保留上下文与事实' },
  { icon: 'bulb', text: '反思 Reflection：让智能体自我审查并改进输出' },
  { icon: 'bulb', text: '自主性 Autonomy：智能体不依赖人逐步指挥的能力' },
  { icon: 'bulb', text: '视觉语言模型 VLM：能看图识图、图文推理的模型' },
  { icon: 'bulb', text: '文生图 Text-to-Image：根据文字描述生成图片' },
  { icon: 'bulb', text: '扩散模型 Diffusion：逐步去噪生成图像的主流方法' },
  { icon: 'bulb', text: '文生视频 Text-to-Video：根据文字生成视频' },
  { icon: 'bulb', text: '语音识别 ASR：把语音转成文字' },
  { icon: 'bulb', text: '语音合成 TTS：把文字转成语音' },
  { icon: 'bulb', text: 'OCR 文字识别：从图片中提取文字' },
  { icon: 'bulb', text: '基准 Benchmark：标准化测试集，用来衡量模型能力' },
  { icon: 'bulb', text: '困惑度 Perplexity：衡量语言模型预测能力的指标' },
  { icon: 'bulb', text: 'BLEU：机器翻译质量的自动评分指标' },
  { icon: 'bulb', text: 'ROUGE：摘要质量的自动评分指标' },
  { icon: 'bulb', text: '安全性 Safety：防止模型输出有害、违规内容' },
  { icon: 'bulb', text: '越狱 Jailbreak：用诱导话术突破模型安全限制' },
  { icon: 'bulb', text: '红队测试 Red Teaming：主动攻击模型找漏洞' },
  { icon: 'bulb', text: '偏见 Bias：模型放大训练数据中的刻板印象' },
  { icon: 'bulb', text: '可解释性 Interpretability：理解模型为何如此决策' },
  { icon: 'bulb', text: '数据污染 Data Contamination：测试题混进训练数据、分数虚高' },
  { icon: 'bulb', text: '小模型 SLM：参数少、可本地运行的高效模型' },
  { icon: 'bulb', text: '开源模型 Open-source：权重公开，可自由使用与微调' },
  { icon: 'bulb', text: '流式输出 Streaming：边生成边返回，体验更顺滑' },
  { icon: 'bulb', text: '系统提示词 System Prompt：设定角色与规则的顶层指令' },
  { icon: 'bulb', text: '多轮对话 Multi-turn：带历史上下文的连续问答' },
  { icon: 'bulb', text: '缓存 Cache：缓存重复请求，省钱又提速' },
]

/** 轮播间隔（ms）：30 秒换一条。 */
const FUN_INTERVAL_MS = 30000

// ---- 胶囊外观（大小缩放 + 字体风格）----

const APPEARANCE_KEY = 'dsh.donePill.appearance'

interface AppearanceConfig {
  /** 缩放系数：0.8 ~ 1.6（1 = 默认）。 */
  scale: number
  /** 字体方案 id。 */
  font: string
}

/** 字体方案（Windows 常见字体栈）。 */
const FONT_OPTIONS: Array<{ id: string; label: string; stack: string }> = [
  { id: 'system', label: '跟随系统', stack: '' },
  { id: 'yahei', label: '雅黑', stack: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { id: 'songti', label: '宋体 · 衬线', stack: "SimSun, 'Songti SC', serif" },
  { id: 'kaiti', label: '楷体 · 手写感', stack: "KaiTi, 'Kaiti SC', cursive" },
  { id: 'simhei', label: '黑体 · 厚重', stack: 'SimHei, sans-serif' },
  { id: 'mono', label: '等宽 · 代码', stack: "Consolas, 'Courier New', monospace" },
  { id: 'cute', label: '可爱 · 圆润', stack: "'Yuanti SC', 'YouYuan', '幼圆', 'HYWenHei-85W', 'Microsoft YaHei', sans-serif" },
  { id: 'comic', label: '可爱 · 漫画', stack: "'Comic Sans MS', 'Comic Neue', 'Segoe UI', cursive" },
]

function fontStackOf(id: string): string {
  return FONT_OPTIONS.find(option => option.id === id)?.stack ?? ''
}

interface AppearanceStore {
  get: () => AppearanceConfig
  set: (next: AppearanceConfig) => void
  subscribe: (fn: (next: AppearanceConfig) => void) => () => void
}

function createAppearanceStore(key: string): AppearanceStore {
  let value: AppearanceConfig = { scale: 1, font: 'system' }
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<AppearanceConfig>
      value = {
        scale: typeof parsed?.scale === 'number' && Number.isFinite(parsed.scale)
          ? Math.min(1.6, Math.max(0.8, parsed.scale))
          : 1,
        font: typeof parsed?.font === 'string' ? parsed.font : 'system',
      }
    }
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: AppearanceConfig) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const appearanceStore = createAppearanceStore(APPEARANCE_KEY)

/** 显隐开关 store（localStorage 持久化，默认显示）。 */
function createEnabledStore(): {
  get: () => boolean
  set: (next: boolean) => void
  subscribe: (fn: (next: boolean) => void) => () => void
} {
  let value = true
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    if (raw === '0' || raw === 'false') value = false
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: boolean) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(ENABLED_KEY, next ? '1' : '0') } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const enabledStore = createEnabledStore()

// ---- 展示工具 ----

function formatTime(ts: number): string {
  if (ts <= 0) return ''
  const d = new Date(ts)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${mo}-${day} ${hh}:${mm}`
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/** 执行时长（实时跳动）：mm:ss，超过 1 小时 h:mm:ss。 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/** 请求开合文件浏览器抽屉（FileExplorerEntry 监听同一事件）。 */
function toggleFileExplorer(): void {
  window.dispatchEvent(new CustomEvent('dsh-file-explorer-toggle'))
}

/**
 * 胶囊自带样式表（一次性注入）：keyframes + 全部配色规则。
 *
 * ⚠ 必须由胶囊自己注入，不能塞进 client/styles.ts 的 dsh-webui-styles 表——
 * 那张表由 Webui.tsx 在**会话视图内**挂载时才注入，而胶囊挂在 shell.overlay
 * 上全局常驻：打开首页/无会话时胶囊拿不到任何样式（透明无底无描边，浅色
 * 主题下彻底看不见）。实测就是「浅色主题看不出胶囊」的根因之一。
 *
 * 配色跟随主题：旧实现把「黑底白字 + 蓝辉光」写死在内联样式里，浅色主题下
 * 白字落在白底上直接隐形。这里收敛成一组 --dpl-* 变量（深/浅各一套），
 * 组件内联样式只负责几何，颜色全部引用变量。
 */
function ensurePillKeyframes(): void {
  if (document.getElementById(PILL_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = PILL_STYLE_ID
  style.dataset.plugin = '@dsh-external/dsh-webui'
  style.dataset.pluginCss = 'webui/done-pill'
  style.textContent = PILL_CSS
  document.head.appendChild(style)
}

const PILL_STYLE_ID = 'dsh-done-pill-css'

const PILL_CSS = `
@keyframes dpLineIn{from{opacity:0}to{opacity:1}}
/* 浅色主题（默认）：白色半透明表面 + 深色文字 + 实体描边与投影。辉光在白底
   上几乎不可见，形状感必须靠描边 + 投影建立。 */
.dsh-done-pill{
  --dpl-fg:var(--dsw-alias-label-primary,#0f1115);
  --dpl-fg-dim:var(--dsw-alias-label-secondary,#61666b);
  --dpl-fg-weak:var(--dsw-alias-label-tertiary,#81858c);
  --dpl-accent:var(--dsw-alias-state-business-primary,#4176e6);
  --dpl-warn:var(--dsw-alias-state-warn-label,#dd8629);
  --dpl-ok:var(--dsw-alias-state-success-primary,#22c55e);
  --dpl-surface:rgba(255,255,255,.88);
  --dpl-surface-hover:#ffffff;
  --dpl-border:rgba(15,17,21,.12);
  --dpl-border-hover:color-mix(in srgb,var(--dpl-accent) 34%,transparent);
  --dpl-divider:rgba(15,17,21,.10);
  --dpl-hover:rgba(15,17,21,.06);
  --dpl-shadow:0 1px 2px rgba(15,17,21,.06),0 4px 14px rgba(15,17,21,.10);
  --dpl-shadow-hover:0 2px 4px rgba(15,17,21,.08),0 8px 22px rgba(15,17,21,.16),0 0 0 3px color-mix(in srgb,var(--dpl-accent) 12%,transparent);
  --dpl-panel-bg:var(--dsw-specific-menu,#ffffff);
  --dpl-panel-border:var(--dsw-alias-border-l2,rgba(0,0,0,.1));
  --dpl-panel-shadow:0 12px 40px rgba(15,17,21,.16),0 2px 8px rgba(15,17,21,.06);
}
/* 深色主题：回到原来的「浅纱浮层 + 蓝辉光」观感。 */
body[data-ds-dark-theme] .dsh-done-pill{
  --dpl-surface:rgba(255,255,255,.07);
  --dpl-surface-hover:rgba(255,255,255,.12);
  --dpl-border:rgba(255,255,255,.14);
  --dpl-divider:rgba(255,255,255,.14);
  --dpl-hover:rgba(255,255,255,.12);
  --dpl-shadow:0 2px 10px rgba(0,0,0,.36);
  --dpl-shadow-hover:0 4px 18px rgba(0,0,0,.46),0 0 12px color-mix(in srgb,var(--dpl-accent) 30%,transparent);
  --dpl-panel-bg:var(--dsw-specific-menu,#1b1b1c);
  --dpl-panel-border:var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  --dpl-panel-shadow:0 16px 44px rgba(0,0,0,.5);
}
/* 外壳：几何由内联样式给，表面/描边/投影/文字色在此（内联写死会盖掉这里）。 */
.dsh-done-pill-shell{
  border:1px solid var(--dpl-border);
  background:var(--dpl-surface);
  color:var(--dpl-fg-dim);
  box-shadow:var(--dpl-shadow);
}
.dsh-done-pill-shell:hover{
  background:var(--dpl-surface-hover);
  border-color:var(--dpl-border-hover);
  box-shadow:var(--dpl-shadow-hover);
}
/* 未读态：文字转主色号 + 加重，描边染一点品牌蓝（不改底色，避免浅色下发灰）。 */
.dsh-done-pill-shell[data-unread="1"]{
  color:var(--dpl-fg);
  font-weight:500;
  border-color:color-mix(in srgb,var(--dpl-accent) 30%,var(--dpl-border));
}
/* 拖拽中：保持抬升态，不随指针进出闪烁。 */
.dsh-done-pill-shell[data-dragging="1"]{box-shadow:var(--dpl-shadow-hover)}
/* 面板内可点行（任务行 / 完成记录卡）：原先无任何 hover 反馈，看不出可点。 */
.dsh-done-pill-row{transition:background .12s ease}
.dsh-done-pill-row:hover{background:var(--dpl-hover)}
.dsh-done-pill-row:focus-visible{outline:2px solid var(--dpl-accent);outline-offset:-2px}
.dsh-done-pill-close{transition:background .12s ease,color .12s ease}
.dsh-done-pill-close:hover{background:var(--dpl-hover);color:var(--dpl-fg)}
/* 面板滚动条跟随主题（默认深色滚动条压在浅色面板上很突兀）。 */
.dsh-done-pill [role="dialog"]{scrollbar-width:thin;scrollbar-color:var(--dpl-border) transparent}
.dsh-done-pill [role="dialog"]::-webkit-scrollbar{width:8px}
.dsh-done-pill [role="dialog"]::-webkit-scrollbar-thumb{background:var(--dpl-border);border-radius:4px}
.dsh-done-pill [role="dialog"]::-webkit-scrollbar-track{background:transparent}
`

// ---- 样式（配色跟随主题：颜色全部走 .dsh-done-pill 上的 --dpl-* 变量 +
// 官方主题令牌，浅色下白底深字、深色下深底浅字；变量定义见上方 PILL_CSS）----
// 尺寸缩放：wrap 上注入 --dps（缩放系数），核心尺寸用 calc 等比缩放，
// 字体随之变大变小；不用 transform scale（非整数渲染会发糊）。

/** 悬停容器：包住胶囊 + 滑出面板，保证两者间移动鼠标不丢 hover；也是拖拽手柄。 */
const wrapStyle = (dragging: boolean, pos: PillPos | null, scale: number, fontStack: string): CSSProperties => ({
  position: 'fixed',
  // pos 恒为整数像素（挂载后由 useLayoutEffect 把居中模式换算成整数坐标）：
  // translateX(-50%) 居中会落在半像素上，文字亚像素渲染发糊。
  // null 仅存在于首帧（绘制前即被 useLayoutEffect 修正）。
  ...(pos === null
    ? { top: defaultShellTop(), left: '50%', transform: 'translateX(-50%)' }
    : { top: pos.y, left: pos.x }),
  zIndex: 9400,
  cursor: dragging ? 'grabbing' : 'grab',
  userSelect: 'none',
  touchAction: 'none',
  ...(fontStack !== '' ? { fontFamily: fontStack } : {}),
  '--dps': String(scale),
  // 上下内衬各 8px：面板贴着 padding box 定位（下方 top:100% / 上方
  // bottom:100%），胶囊与面板之间的视觉缝隙落在容器内，鼠标滑过去不会触发
  // mouseleave。marginTop 抵消上内衬——外壳本体仍精确落在 pos.y，拖拽与
  // 锚点换算都以**外壳**矩形为基准（见 onPointerDown 用 shellRef 取 rect）。
  paddingTop: 'calc(8px * var(--dps))',
  paddingBottom: 'calc(8px * var(--dps))',
  marginTop: 'calc(-8px * var(--dps))',
  // 核心动画：left 与外壳 width 同节奏（MORPH_DUR）过渡。位置按目标宽
  // 一步算准（见 syncPosition），Δw 的过渡期里左缘滑动的量恒为
  // ∓Δw/2，与右缘对称——胶囊呈「两侧拉伸 / 两侧收窄」，而不是先单边
  // 伸缩、再瞬移回中。拖拽中必须关闭，否则位置被过渡拖着走、毫无跟手性。
  ...(dragging ? {} : { transition: `left ${MORPH_DUR} ease` }),
} as unknown as CSSProperties)

/** 胶囊外壳最大宽度（px）：与 pillShellStyle 的 maxWidth 同源——
 *  居中/锚定计算要复刻同一钳制规则，超宽胶囊的位置才算得准。 */
const SHELL_MAX_W = 720

/** 居中/锚定计算用的「实际渲染宽」：优先取受控目标宽（宽度过渡的终点，
 *  用它算出的坐标才与宽度动画同时抵达），并复刻外壳 maxWidth 的钳制；
 *  尚无目标宽（首帧）时回退实测宽度。 */
function effectiveShellWidth(target: number | null, el: HTMLDivElement | null): number {
  const maxW = Math.min(SHELL_MAX_W, window.innerWidth - 48)
  if (target !== null && target > 0) return Math.min(target, maxW)
  return el !== null ? el.getBoundingClientRect().width : 160
}

/** 胶囊外壳：只管几何（尺寸/圆角/受控宽度）。表面色、描边、文字色、投影与
 *  hover/未读态一律由样式表 .dsh-done-pill-shell 提供——内联写死
 *  background:'transparent' + 白字曾造成两个 bug：① 优先级高于样式表，
 *  把常态底色整个盖掉（胶囊只剩一圈辉光）；② 白字在浅色主题下等于隐形。
 *  boxSizing:border-box：受控 width 已含左右各 1px 描边（见宽度测量 +2）。 */
const pillShellStyle = (width: number | null): CSSProperties => ({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'stretch',
  height: 'calc(30px * var(--dps))',
  maxWidth: `min(${SHELL_MAX_W}px, calc(100vw - 48px))`,
  ...(width !== null ? { width } : {}),
  borderRadius: 'calc(15px * var(--dps))',
  fontSize: 'calc(12px * var(--dps))',
  lineHeight: 'calc(18px * var(--dps))',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  // 宽度伸缩与位置滑动/文字淡入同节奏（MORPH_DUR）；颜色类过渡也写在内联，
  // 否则内联 transition 会整条覆盖样式表里的 transition。
  transition: `width ${MORPH_DUR} ease, background-color .14s ease, box-shadow .14s ease, border-color .14s ease, color .14s ease`,
})

/** 胶囊主体（点击 = 进入最新完成的会话；按住拖动 = 移动胶囊）。 */
const pillMainStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(7px * var(--dps))',
  minWidth: 0,
  padding: '0 calc(10px * var(--dps)) 0 calc(14px * var(--dps))',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontWeight: 'inherit',
  cursor: 'inherit',
  overflow: 'hidden',
}

/** ✓ 状态点：未读 = 品牌蓝底白勾；已读 = 中性底绿勾（底色随主题，
 *  原先的 rgba(255,255,255,.10) 在浅色主题下是隐形的白）。 */
const checkIconStyle = (unread: number): CSSProperties => ({
  flex: 'none',
  width: 'calc(15px * var(--dps))',
  height: 'calc(15px * var(--dps))',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'calc(10px * var(--dps))',
  lineHeight: 1,
  background: unread > 0 ? 'var(--dpl-accent)' : 'var(--dpl-hover)',
  color: unread > 0 ? '#ffffff' : 'var(--dpl-ok)',
})

/** 健康提醒态图标（月亮 / 咖啡）：单色 SVG。 */
const reminderIconStyle: CSSProperties = {
  flex: 'none',
  width: 'calc(15px * var(--dps))',
  height: 'calc(15px * var(--dps))',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

/** 健康提醒徽章：时段内常驻最左侧，黄字不挤占完成通知。 */
const reminderBadgeStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(5px * var(--dps))',
  padding: '0 calc(10px * var(--dps)) 0 calc(14px * var(--dps))',
  // 琥珀色走官方 warn-label 令牌：浅色主题下 #f5c542 对白底几乎不可读。
  color: 'var(--dpl-warn)',
  fontSize: 'calc(12px * var(--dps))',
  lineHeight: 'calc(18px * var(--dps))',
  fontWeight: 500,
}

type ReminderIconKind = 'moon' | 'coffee'

/** 单色线性图标（currentColor 跟随胶囊文字色）。 */
function LineIcon(props: { kind: 'sparkle' | 'bulb' | 'moon' | 'coffee'; size?: number }): JSX.Element {
  const size = props.size ?? 13
  if (props.kind === 'sparkle') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ flex: 'none' }}>
        <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
      </svg>
    )
  }
  if (props.kind === 'bulb') {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}
      >
        <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
        <line x1="9" y1="18" x2="15" y2="18" />
        <line x1="10" y1="21" x2="14" y2="21" />
      </svg>
    )
  }
  if (props.kind === 'moon') {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    )
  }
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}
    >
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <line x1="7" y1="2" x2="7" y2="5" />
      <line x1="12" y1="2" x2="12" y2="5" />
    </svg>
  )
}

/** 主体与文件钮之间的细分隔线。 */
const pillDividerStyle: CSSProperties = {
  flex: 'none',
  width: 1,
  margin: 'calc(7px * var(--dps)) 0',
  background: 'var(--dpl-divider)',
}

/** 胶囊右侧「文件」按钮：点击打开文件浏览器抽屉。 */
const fileButtonStyle = (hovered: boolean): CSSProperties => ({
  flex: 'none',
  width: 'calc(30px * var(--dps))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 0,
  background: hovered ? 'var(--dpl-hover)' : 'transparent',
  color: hovered ? 'var(--dpl-fg)' : 'var(--dpl-fg-dim)',
  cursor: 'pointer',
  transition: 'background .12s ease, color .12s ease',
})

/** shell 直接子项统一禁止收缩：宽度测量（子块求和）才不受受控宽度污染。 */
const shellChildStyle: CSSProperties = { flex: 'none' }

/** 记录面板宽度（视口溢出保护计算用）。 */
const DONE_PANEL_W = 600
/** 运行中任务面板宽度。 */
const RUN_PANEL_W = 320

/** 悬停滑出面板的公共骨架：底色/描边/投影走 --dpl-panel-*（随主题），
 *  `up` = 向上翻转（胶囊被拖到视口下半时，面板改从上方滑出，否则会掉出
 *  屏幕底部且无法滚动到）。滑入方向随之取反，动画方向与位置一致。 */
const floatPanelStyle = (
  open: boolean,
  shiftX: number,
  up: boolean,
  width: number,
  maxHeight: string,
  gap: number,
  padding: number,
): CSSProperties => ({
  position: 'absolute',
  ...(up ? { bottom: '100%' } : { top: '100%' }),
  left: shiftX,
  width: `min(${width}px, calc(100vw - 24px))`,
  maxHeight,
  overflowY: 'auto',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap,
  padding,
  borderRadius: 12,
  border: '1px solid var(--dpl-panel-border)',
  background: 'var(--dpl-panel-bg)',
  color: 'var(--dpl-fg)',
  boxShadow: 'var(--dpl-panel-shadow)',
  opacity: open ? 1 : 0,
  transform: `translateY(${open ? 0 : (up ? 8 : -8)}px)`,
  visibility: open ? 'visible' : 'hidden',
  pointerEvents: open ? 'auto' : 'none',
  // 收起时 visibility 延迟到过渡结束再隐藏，滑出动画才完整可见。
  transition: open
    ? 'opacity .18s ease, transform .18s ease, visibility 0s'
    : 'opacity .18s ease, transform .18s ease, visibility 0s linear .18s',
})

/** 记录面板：悬停主体时滑出（宽卡列表）。 */
const panelStyle = (open: boolean, shiftX: number, up: boolean): CSSProperties =>
  floatPanelStyle(open, shiftX, up, DONE_PANEL_W, 'min(66vh, 600px)', 8, 12)

/** 运行中任务面板：悬停左块时滑出的窄列表。 */
const runPanelStyle = (open: boolean, shiftX: number, up: boolean): CSSProperties =>
  floatPanelStyle(open, shiftX, up, RUN_PANEL_W, 'min(60vh, 480px)', 4, 10)

/** 胶囊左侧「运行中」区块：黄点 + 数量，悬停滑出任务列表。 */
const runningBlockStyle = (hasRunning: boolean): CSSProperties => ({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(6px * var(--dps))',
  padding: '0 calc(10px * var(--dps)) 0 calc(14px * var(--dps))',
  border: 'none',
  background: 'transparent',
  color: hasRunning ? 'var(--dpl-fg)' : 'var(--dpl-fg-weak)',
  font: 'inherit',
  fontWeight: hasRunning ? 500 : 400,
  cursor: 'pointer',
})

/** 运行中黄点：缩放跟随 --dps（原先写死 8px，胶囊放大到 160% 时点显得干瘪）。 */
const runDotStyle: CSSProperties = {
  flex: 'none',
  width: 'calc(8px * var(--dps))',
  height: 'calc(8px * var(--dps))',
  borderRadius: '50%',
  background: 'var(--dpl-warn)',
  boxShadow: '0 0 6px color-mix(in srgb, var(--dpl-warn) 55%, transparent)',
}

/** 面板内列表项的黄点：面板不参与胶囊缩放，固定 8px。 */
const panelDotStyle: CSSProperties = {
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--dpl-warn)',
}

const runRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 8px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--dpl-fg)',
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'left',
  cursor: 'pointer',
}

const runRowTitleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 运行中任务的实时执行时长（等宽数字避免跳动）。 */
const runRowTimeStyle: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  color: 'var(--dpl-fg-weak)',
  fontVariantNumeric: 'tabular-nums',
}

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '2px 2px 6px',
  borderBottom: '1px solid var(--dpl-panel-border)',
}

const headTitleStyle: CSSProperties = {
  flex: 'none',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--dpl-fg)',
}

const headMetaStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'right',
  fontSize: 11,
  color: 'var(--dpl-fg-weak)',
}

const cardStyle: CSSProperties = {
  border: 'none',
  borderRadius: 12,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  cursor: 'pointer',
  background: 'transparent',
}

const cardHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
}

const unreadDotStyle: CSSProperties = {
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--dpl-accent)',
}

const sessionTitleStyle: CSSProperties = {
  flex: 'none',
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--dpl-fg)',
}

const metaStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: 'right',
  fontSize: 11,
  color: 'var(--dpl-fg-weak)',
  whiteSpace: 'nowrap',
}

const closeStyle: CSSProperties = {
  flex: 'none',
  width: 20,
  height: 20,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--dpl-fg-weak)',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
}

const answerStyle: CSSProperties = {
  margin: 0,
  maxHeight: 240,
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 12,
  lineHeight: '19px',
  color: 'var(--dpl-fg-dim)',
  borderTop: '1px dashed var(--dpl-panel-border)',
  paddingTop: 6,
  // 字体族显式跟随容器：<pre> 默认 monospace，会无视胶囊字体设置。
  fontFamily: 'inherit',
}

const errorTagStyle: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  color: 'var(--dpl-warn)',
}

const emptyStyle: CSSProperties = {
  padding: '18px 8px',
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--dpl-fg-weak)',
}

// ---- 基础设置行（与 General 区条目一致的 Setting-Cell 布局）----

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const rowTextStyle: CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48,
}
const rowTitleStyle: CSSProperties = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const rowDescStyle: CSSProperties = { fontSize: 12, fontWeight: 400, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }

function switchStyle(on: boolean): CSSProperties {
  return {
    position: 'relative', flex: 'none', width: 40, height: 22, padding: 0,
    border: 'none', borderRadius: 11, cursor: 'pointer',
    // 开启态用品牌蓝（不能用反色的 brand-primary）；关闭态描边底 + 灰钮。
    background: on ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-bg-module-platform)',
    transition: 'background .15s',
  }
}
function knobStyle(on: boolean): CSSProperties {
  return {
    position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18,
    borderRadius: '50%', background: on ? '#ffffff' : 'var(--dsw-alias-label-tertiary)',
    transition: 'left .15s, background .15s',
  }
}

/** 基础设置行：对话完成胶囊显隐开关。 */
function DonePillRow(): JSX.Element {
  const [on, setOn] = useState(enabledStore.get())
  useEffect(() => enabledStore.subscribe(setOn), [])

  function toggle(): void {
    enabledStore.set(!enabledStore.get())
  }

  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>对话完成胶囊</div>
        <div style={rowDescStyle}>顶部悬浮胶囊：对话完成提醒、快速跳转与文件入口；关闭后完全隐藏</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="对话完成胶囊"
        onClick={toggle}
        style={switchStyle(on)}
      >
        <span style={knobStyle(on)} />
      </button>
    </div>
  )
}

const timeInputStyle: CSSProperties = {
  flex: 'none',
  width: 96,
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  lineHeight: '22px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
}

const timeDashStyle: CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
}

/** 提醒设置行通用骨架：开关 + 可编辑时间段。 */
function ReminderRow(props: {
  titleText: string
  descText: string
  store: ReminderStore
}): JSX.Element {
  const { titleText, descText, store } = props
  const [config, setConfig] = useState<ReminderConfig>(() => store.get())
  useEffect(() => store.subscribe(setConfig), [])

  function update(patch: Partial<ReminderConfig>): void {
    store.set({ ...store.get(), ...patch })
  }

  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>{titleText}</div>
        <div style={rowDescStyle}>{descText}</div>
      </div>
      <input
        type="time"
        value={config.start}
        disabled={!config.enabled}
        aria-label={`${titleText}开始时间`}
        onChange={(event) => { if (event.target.value !== '') update({ start: event.target.value }) }}
        style={{ ...timeInputStyle, opacity: config.enabled ? 1 : 0.45 }}
      />
      <span style={timeDashStyle}>—</span>
      <input
        type="time"
        value={config.end}
        disabled={!config.enabled}
        aria-label={`${titleText}结束时间`}
        onChange={(event) => { if (event.target.value !== '') update({ end: event.target.value }) }}
        style={{ ...timeInputStyle, opacity: config.enabled ? 1 : 0.45 }}
      />
      <button
        type="button"
        role="switch"
        aria-checked={config.enabled}
        aria-label={titleText}
        onClick={() => { update({ enabled: !config.enabled }) }}
        style={{ ...switchStyle(config.enabled), marginLeft: 8 }}
      >
        <span style={knobStyle(config.enabled)} />
      </button>
    </div>
  )
}

const selectInputStyle: CSSProperties = {
  flex: 'none',
  width: 132,
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  appearance: 'none',
  cursor: 'pointer',
}

const sizeSliderStyle: CSSProperties = {
  flex: 'none',
  width: 160,
  accentColor: 'var(--dsw-alias-state-business-primary)',
  cursor: 'pointer',
}

const sliderValueStyle: CSSProperties = {
  flex: 'none',
  width: 44,
  textAlign: 'right',
  fontSize: 13,
  color: 'var(--dsw-alias-label-secondary)',
  fontVariantNumeric: 'tabular-nums',
}

/** 基础设置行：胶囊大小（字体等比跟随）。 */
function PillScaleRow(): JSX.Element {
  const [config, setConfig] = useState<AppearanceConfig>(() => appearanceStore.get())
  useEffect(() => appearanceStore.subscribe(setConfig), [])
  const percent = Math.round(config.scale * 100)
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>胶囊大小</div>
        <div style={rowDescStyle}>整体缩放胶囊，字体与图标等比跟随（80% – 160%）</div>
      </div>
      <input
        type="range"
        min={80}
        max={160}
        step={5}
        value={percent}
        aria-label="胶囊大小"
        onChange={(event) => { appearanceStore.set({ ...appearanceStore.get(), scale: Number(event.target.value) / 100 }) }}
        style={sizeSliderStyle}
      />
      <span style={sliderValueStyle}>{`${percent}%`}</span>
    </div>
  )
}

/** 基础设置行：胶囊字体风格。 */
function PillFontRow(): JSX.Element {
  const [config, setConfig] = useState<AppearanceConfig>(() => appearanceStore.get())
  useEffect(() => appearanceStore.subscribe(setConfig), [])
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>胶囊字体</div>
        <div style={rowDescStyle}>胶囊与面板文字的字体风格</div>
      </div>
      <select
        value={config.font}
        aria-label="胶囊字体"
        onChange={(event) => { appearanceStore.set({ ...appearanceStore.get(), font: event.target.value }) }}
        style={selectInputStyle}
      >
        {FONT_OPTIONS.map(option => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

// ---- 组件 ----

interface DragState {
  px: number
  py: number
  ox: number
  oy: number
  moved: boolean
  /** 按下时所在的功能区（data-dp-zone），决定「点击」落到哪个动作。 */
  zone: string
}

/** 顶部悬浮「对话完成」胶囊：点击进会话、悬停滑出记录、可拖拽、常驻显示。 */
export function DonePill(props: DonePillProps): JSX.Element | null {
  // 按需加载：不订阅 DSH 会话全量 store（state.byId）。任何会话状态变化
  // （如点击会话切换）都会让全量订阅组件重渲染并 Object.values 遍历全部
  // 会话——running/完成数据改由 host 的 /api/webui-done-pill 增量推送驱动。
  const [entries, setEntries] = useState<DoneEntry[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds())
  const [hovered, setHovered] = useState(false)
  const [hoveredRunning, setHoveredRunning] = useState(false)
  const [fileHovered, setFileHovered] = useState(false)
  const [enabled, setEnabled] = useState(enabledStore.get())
  // 注意：initializer 里不能引用下方才声明的 anchorRef（TDZ），直接读存储。
  const [pos, setPos] = useState<PillPos | null>(() => {
    const anchor = loadAnchor()
    // 挂载前无法测实际宽度，用估算宽度 160 定位；挂载后宽度同步 effect 会按中心重放一次。
    // 高度按已持久化的缩放系数推算（不是写死 30），首帧垂直位置就落在正确处。
    return anchor === null ? null : anchorToPos(anchor, 160, pillHeight(appearanceStore.get().scale))
  })
  const [dragging, setDragging] = useState(false)
  // 正在执行回合的信息（host 下发）：sessionId → { since, question }，
  // question = 当前正在执行的那条用户消息，供任务列表展示。
  const [runInfo, setRunInfo] = useState<Record<string, { since: number; question: string; title: string }>>({})
  // 实时时钟：任务面板展开时每秒走字。
  const [nowTick, setNowTick] = useState(() => Date.now())
  // 健康提醒时钟：每 30 秒刷新当前分钟，判断是否落在提醒时段内。
  const [reminderTick, setReminderTick] = useState(0)
  const [restConfig, setRestConfig] = useState<ReminderConfig>(() => restStore.get())
  const [lateConfig, setLateConfig] = useState<ReminderConfig>(() => lateStore.get())
  // 外观：缩放系数 + 字体风格。
  const [appearance, setAppearance] = useState<AppearanceConfig>(() => appearanceStore.get())
  const scale = appearance.scale
  // 缩放系数镜像：拖拽/锚点等稳定回调里要读最新值（进依赖数组会让回调重建，
  // 拖拽中重建会丢 pointer capture）。
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  // 平时轮播：随机开心话术 / AI 名词的下标。
  const [funIdx, setFunIdx] = useState(() => Math.floor(Math.random() * FUN_LINES.length))
  // 胶囊宽度受控值（跟随内容自然宽度平滑过渡）。
  const [shellWidth, setShellWidth] = useState<number | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const shellWidthRef = useRef<number | null>(null)
  // 主文案之外的固有宽度（内边距 + 图标 + 分隔线 + 文件按钮 + 提醒徽章 +
  // 运行中计数块）。文案的 maxWidth 由「外壳上限 − 这个值」算出，才能在
  // 任何组合下都以省略号收尾（写死一个常数在带徽章时会算多，文字仍被硬切）。
  const [decoWidth, setDecoWidth] = useState(80)
  const labelRef = useRef<HTMLSpanElement | null>(null)
  // 增量水位仅存内存：首次 tick 用 0 全量拉（恢复最近记录），之后增量。
  const sinceRef = useRef(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  // 「正在执行」面板的左缘锚点：运行中区块相对胶囊左缘的偏移（每渲染实测）。
  const [runBlockLeft, setRunBlockLeft] = useState(0)
  const runBlockRef = useRef<HTMLButtonElement | null>(null)
  // 视口高度（resize 时更新）：决定悬停面板朝下还是朝上滑出。
  // 兜底 900：窗口最小化/离屏时 innerHeight 可能是 0，按 0 判会把面板永久
  // 翻到上方（实测在离屏实例里就是这样）。
  const [viewportH, setViewportH] = useState(() => window.innerHeight || 900)

  // 设置开关：关闭即整体隐藏。
  useEffect(() => enabledStore.subscribe(setEnabled), [])
  useEffect(() => restStore.subscribe(setRestConfig), [])
  useEffect(() => lateStore.subscribe(setLateConfig), [])
  useEffect(() => appearanceStore.subscribe(setAppearance), [])
  // 样式表兜底注入（幂等）：正常路径在 applyDonePill 注册时就注入好了——
  // 必须早于首次渲染，否则外壳先以「无样式」算一遍布局，样式到位时
  // background-color/box-shadow 会走一次过渡淡入（实测在某些环境里首帧
  // 停在透明态上，看着就是「胶囊不见了」）。
  useLayoutEffect(() => { ensurePillKeyframes() }, [])
  useEffect(() => {
    setReminderTick(t => t + 1)
    const timer = window.setInterval(() => { setReminderTick(t => t + 1) }, 30000)
    return () => { window.clearInterval(timer) }
  }, [])

  // 健康提醒激活判断（reminderTick 每 30 秒变化触发重算）。
  const nowMinutes = (() => {
    const d = new Date()
    void reminderTick
    return d.getHours() * 60 + d.getMinutes()
  })()
  const lateActive = lateConfig.enabled && inTimeRange(nowMinutes, lateConfig)
  const restActive = !lateActive && restConfig.enabled && inTimeRange(nowMinutes, restConfig)

  // 自动居中模式（从未手动拖拽过）：胶囊宽度随文字变化（任务完成时变长），
  // 固定 left 会偏离居中——每次渲染后按目标宽重算水平居中（见 syncPosition），
  // 并保持整数像素（translateX(-50%) 的半像素会让文字发糊）。
  // 一旦用户拖拽（onPointerUp moved），autoCenterRef 置 false，锁定锚点位置。
  const anchorRef = useRef<PillAnchor | null>(loadAnchor())
  const autoCenterRef = useRef(anchorRef.current === null)

  /**
   * 位置同步（两种模式共用一个入口）：
   *  - 自动居中模式（从未拖拽过）：按当前目标宽水平居中；
   *  - 锁定模式：按持久化的**中心锚点**比率还原位置。
   * 两者都按受控**目标宽**（宽度过渡的终点）计算，而不是实测宽——实测值在
   * 过渡期间是中间值，算出的坐标永远追着动画尾巴；用目标宽则 left 过渡与
   * width 过渡同时抵达终点，合成「两侧对称伸缩」。
   * 相等性检查：位置没变就返回原 state（React bail out），不会死循环。
   *
   * 每次渲染后由下方宽度测量的 layout effect 调用。原实现把居中逻辑挂在
   * ResizeObserver 上，而 RO 的回调派发依赖帧生命周期——离屏/最小化窗口里
   * 帧被冻结时回调不来，胶囊变宽后就一直偏在旧位置（实测偏移半个 Δw）。
   */
  const syncPosition = useCallback((): void => {
    const w = effectiveShellWidth(shellWidthRef.current, shellRef.current)
    if (w <= 0) return
    const h = pillHeight(scaleRef.current)
    if (autoCenterRef.current) {
      const x = Math.max(8, Math.round((window.innerWidth - w) / 2))
      setPos(prev => {
        const next = { x, y: prev?.y ?? defaultShellTop() }
        return prev !== null && prev.x === next.x && prev.y === next.y ? prev : next
      })
      return
    }
    const anchor = anchorRef.current
    if (anchor === null) return
    const next = anchorToPos(anchor, w, h)
    setPos(prev => (prev !== null && prev.x === next.x && prev.y === next.y ? prev : next))
  }, [])
  useEffect(() => {
    const onResize = (): void => {
      if (window.innerHeight > 0) setViewportH(window.innerHeight)
      syncPosition()
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [syncPosition])

  // 合并新条目：按 id 去重、降序、截断上限。
  const mergeEntries = useCallback((incoming: DoneEntry[]): void => {
    if (incoming.length === 0) return
    setEntries(prev => {
      const seen = new Set(prev.map(item => item.id))
      const merged = [...prev]
      for (const item of incoming) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        merged.push(item)
      }
      merged.sort((a, b) => b.seq - a.seq)
      return merged.length > MAX_ENTRIES ? merged.slice(0, MAX_ENTRIES) : merged
    })
  }, [])

  // 轮询 host：增量拉取完成记录；页面隐藏时跳过，回前台立即补一轮。
  useEffect(() => {
    let stopped = false
    const tick = (): void => {
      if (document.hidden) return
      fetch(`/api/webui-done-pill?since=${sinceRef.current}`, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) throw new Error(`http ${res.status}`)
          return res.json() as Promise<{ ok: boolean; version: number; items: DoneEntry[]; running?: Array<{ sessionId: string; since: number; question?: string; title?: string }> }>
        })
        .then((data) => {
          if (stopped || data?.ok !== true || !Array.isArray(data.items)) return
          sinceRef.current = Math.max(sinceRef.current, typeof data.version === 'number' ? data.version : 0)
          mergeEntries(data.items.filter(item => item !== null && typeof item === 'object' && typeof item.id === 'string'))
          if (Array.isArray(data.running)) {
            const next: Record<string, { since: number; question: string; title: string }> = {}
            for (const entry of data.running) {
              if (entry !== null && typeof entry === 'object'
                && typeof entry.sessionId === 'string' && typeof entry.since === 'number') {
                next[entry.sessionId] = {
                  since: entry.since,
                  question: typeof entry.question === 'string' ? entry.question : '',
                  title: typeof entry.title === 'string' ? entry.title : '',
                }
              }
            }
            setRunInfo(next)
          }
        })
        .catch(() => { /* 服务暂不可达时静默，下轮重试 */ })
    }
    tick()
    const timer = window.setInterval(tick, POLL_MS)
    const onVisibility = (): void => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mergeEntries])

  const unreadCount = useMemo(() => entries.filter(item => !readIds.has(item.id)).length, [entries, readIds])
  const latest = entries[0]

  // 轮播（无未读时）：每 FUN_INTERVAL_MS 随机换一条开心话术 / AI 名词。
  // 提醒态**不再暂停**轮播：提醒已独立成左侧徽章、不占主文案，旧实现却仍
  // 按「提醒激活」停掉定时器——设了长时段提醒（如 22:00-07:00）时主文案
  // 整夜冻在同一条上。
  const funIdle = unreadCount === 0
  useEffect(() => {
    if (!funIdle) return
    const timer = window.setInterval(() => {
      setFunIdx(prev => {
        let next = Math.floor(Math.random() * FUN_LINES.length)
        if (next === prev) next = (next + 1) % FUN_LINES.length
        return next
      })
    }, FUN_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [funIdle])

  // 正在执行中的任务：直接取 host 增量推送的 running 列表（turn/start 入表、
  // turn/end 出表，已排除 subagent），按开始时间降序。不再订阅全量会话
  // store（byId）——那会在任何会话状态变化（如点击会话）时触发本组件
  // 重渲染 + Object.values 全量遍历。
  const runningSessions = useMemo(() => (
    Object.entries(runInfo)
      .map(([sessionId, info]) => ({ id: sessionId, displayTitle: info.title, since: info.since }))
      .sort((a, b) => b.since - a.since)
  ), [runInfo])
  // 镜像：点击回调（稳定引用）里要读最新运行列表，不进依赖数组。
  const runningSessionsRef = useRef(runningSessions)
  runningSessionsRef.current = runningSessions

  const markAllRead = useCallback((): void => {
    setReadIds(prev => {
      const next = new Set(prev)
      for (const item of entries) next.add(item.id)
      saveReadIds(next)
      return next.size === prev.size ? prev : next
    })
  }, [entries])

  // 已读时机 = 面板**关闭**时（看过即已读）。旧实现在 hovered 变 true 的同一
  // 帧就 markAllRead，未读圆点在面板出现的瞬间全部消失，等于看不出哪几条是新的。
  const wasHoveredRef = useRef(false)
  useEffect(() => {
    if (hovered) { wasHoveredRef.current = true; return }
    if (wasHoveredRef.current) {
      wasHoveredRef.current = false
      markAllRead()
    }
  }, [hovered, markAllRead])

  // 实时时钟：运行中任务面板展开时每秒刷新，时长走字。
  useEffect(() => {
    if (!hoveredRunning || runningSessions.length === 0) return
    setNowTick(Date.now())
    const timer = window.setInterval(() => { setNowTick(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [hoveredRunning, runningSessions.length])

  const dismiss = useCallback((id: string): void => {
    setEntries(prev => prev.filter(item => item.id !== id))
    setReadIds(prev => {
      const next = new Set(prev)
      next.add(id)
      saveReadIds(next)
      return next
    })
  }, [])

  const openSession = useCallback((sessionId: string, markReadId?: string): void => {
    try { sessionsRuntime?.open(sessionId as SessionId) } catch { /* 会话可能已不在列表 */ }
    if (markReadId !== undefined) {
      setReadIds(prev => {
        if (prev.has(markReadId)) return prev
        const next = new Set(prev)
        next.add(markReadId)
        saveReadIds(next)
        return next
      })
    }
    setHovered(false)
  }, [])

  // ---- 拖拽（pointer 事件；4px 阈值区分点击与拖动）----

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const el = wrapRef.current
    if (el === null) return
    // 起点必须取**外壳**矩形：wrap 有上下各 8px 内衬（面板缝隙热区），
    // 用 wrap 的 rect.top 会比 pos.y 小 8px，一按下就整体跳一截。
    const rect = (shellRef.current ?? el).getBoundingClientRect()
    const zone = event.target instanceof Element
      ? (event.target.closest('[data-dp-zone]')?.getAttribute('data-dp-zone') ?? '')
      : ''
    dragRef.current = { px: event.clientX, py: event.clientY, ox: rect.left, oy: rect.top, moved: false, zone }
    try { el.setPointerCapture(event.pointerId) } catch { /* 合成事件等场景无有效 pointerId，忽略 */ }
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = event.clientX - drag.px
    const dy = event.clientY - drag.py
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    if (!drag.moved) {
      drag.moved = true
      setDragging(true)
      setHovered(false)
      setHoveredRunning(false)
    }
    // 钳制按胶囊**实际尺寸**：宽胶囊（数百 px）以前能被拖到只剩左端露在屏内。
    const w = effectiveShellWidth(shellWidthRef.current, shellRef.current)
    setPos(clampPos(drag.ox + dx, drag.oy + dy, w, pillHeight(scaleRef.current)))
  }, [])

  /** 指针取消（系统手势打断、设备失联等）：必须清干净拖拽态，
   *  否则 dragRef 常驻非空，之后 hover 被 `dragRef.current === null` 判死，
   *  面板再也展不开（旧实现无此分支，实测能把胶囊「冻」住）。 */
  const onPointerCancel = useCallback((): void => {
    dragRef.current = null
    setDragging(false)
  }, [])

  const onPointerUp = useCallback((): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag === null) return
    if (drag.moved) {
      // 用户手动拖拽：退出自动居中，按**胶囊中心点**的视口比率持久化锚点
      // （窗口缩放、内容伸缩时以中心为基准向两侧对称变化）。
      autoCenterRef.current = false
      setDragging(false)
      setPos(current => {
        if (current !== null) {
          const el = shellRef.current
          const w = el !== null ? el.getBoundingClientRect().width : 160
          const h = pillHeight(scaleRef.current)
          const anchor: PillAnchor = {
            xc: clamp01((current.x + w / 2) / Math.max(1, window.innerWidth)),
            yc: clamp01((current.y + h / 2) / Math.max(1, window.innerHeight)),
          }
          anchorRef.current = anchor
          saveAnchor(anchor)
        }
        return current
      })
      return
    }
    // 未超过阈值 = 点击。按下时所在区域决定动作：
    //  - 'run'（运行中计数块）：进入正在执行的那个会话（多个时进最新开始的）；
    //    旧实现无论点哪里都跳「最新完成的会话」——点运行中计数会跳到一个
    //    毫不相关的已完成会话，属于明显的误跳。
    //  - 其他（主体/提醒徽章）：进入最新完成的会话。
    if (drag.zone === 'run') {
      const first = runningSessionsRef.current[0]
      if (first !== undefined) openSession(first.id)
      return
    }
    if (latest !== undefined) openSession(latest.sessionId, unreadCount > 0 ? latest.id : undefined)
  }, [latest, openSession, unreadCount])

  const latestTitle = latest !== undefined ? latest.title : ''

  // 胶囊主文本：显示刚完成的那条对话消息（而非会话标题/AI 回复）；
  // 无消息时回退标题。
  const latestLabel = latest !== undefined
    ? (latest.question !== '' ? latest.question : latestTitle)
    : ''

  // 健康提醒文案：凌晨提示优先于休息时段；时段内作为徽章常驻最左侧。
  const nowDate = new Date()
  let reminderLabel: string | null = null
  let reminderIcon: ReminderIconKind = 'moon'
  if (lateActive) {
    reminderIcon = 'moon'
    const hour = nowDate.getHours()
    // 「凌晨 N 点」只在真的凌晨（0-4 点）才说得通。该提醒的时段可自定义，
    // 旧文案对任何时刻都硬说「凌晨」——设成 18:00-23:00 会得到「凌晨 18 点了」。
    reminderLabel = hour <= 4
      ? `凌晨 ${hour} 点了 · 注意休息`
      : `${hour >= 22 ? '夜深了' : `已 ${hour} 点`} · 注意休息`
  } else if (restActive) {
    reminderIcon = 'coffee'
    reminderLabel = `休息时间（${restConfig.start}-${restConfig.end}）· 该休息一下了`
  }

  // 平时（无提醒）：随机轮播开心话术 / AI 名词小知识。
  const funLine = FUN_LINES[funIdx % FUN_LINES.length] ?? FUN_LINES[0]

  // 优先级：未读通知 > 平时轮播（开心话术 / AI 名词小知识）。
  // 已读（悬停面板即全部已读）后不再停留「最近完成时间」，直接回到知识轮播。
  // 健康提醒不挤占主文案——作为独立黄色徽章常驻最左侧，与通知共存。
  const pillLabel = unreadCount > 0 && latest !== undefined
    ? `${unreadCount} 个对话完成 · ${truncate(latestLabel, 56)}`
    : funLine.text

  // 面板定位（整数像素）+ 视口边界保护：面板左/右缘都不超出视口，
  // 胶囊贴边时自动向内收。
  const clampPanelLeft = (panelW: number, left: number): number => {
    if (pos === null) return left
    const minLeft = Math.round(8 - pos.x)
    const maxLeft = Math.max(minLeft, Math.round(window.innerWidth - 12 - pos.x - panelW))
    return Math.min(Math.max(left, minLeft), maxLeft)
  }
  // 记录面板：与胶囊**中心对齐**。
  const doneShift = clampPanelLeft(DONE_PANEL_W, Math.round(((shellWidth ?? 0) - DONE_PANEL_W) / 2))
  // 「正在执行」面板：不居中展开，左缘与「运行中」区块左缘对齐。
  const runShift = clampPanelLeft(RUN_PANEL_W, runBlockLeft)
  // 面板朝向：胶囊落在视口下半时改为向**上**滑出。原实现恒向下，胶囊拖到
  // 底部后面板整段落在视口外，既看不见也滚不到（列表还挺长）。
  const panelUp = pos !== null && pos.y + pillHeight(scale) > viewportH * 0.55

  // 主文案：完整展示，不再截断（知识/话术全文）；超出由外壳 maxWidth + 省略号兜底。
  const displayText = pillLabel

  // 宽度平滑跟随：每次渲染后对**子块宽度求和**（子块均不收缩，求和不受
  // shell 自身受控宽度污染，扩/缩双向都准确），交给 CSS transition 过渡。
  useLayoutEffect(() => {
    const el = shellRef.current
    if (el === null) return
    let total = 0
    for (const child of el.children) total += child.getBoundingClientRect().width
    total += 2 // 左右 border 各 1px（受控 width 需包含边框占位）
    if (total > 0 && Math.round(total) !== shellWidthRef.current) {
      shellWidthRef.current = Math.round(total)
      setShellWidth(Math.round(total))
    }
    // 装饰宽 = 子块总宽 − 主文案实际宽度。文案被 maxWidth 截断时用
    // scrollWidth（自然宽）会算大，这里取渲染宽即可：装饰部分的宽度与
    // 文案是否截断无关，差值恒等于装饰宽。
    const labelEl = labelRef.current
    if (labelEl !== null) {
      const deco = Math.round(total - labelEl.getBoundingClientRect().width)
      if (deco > 0 && Math.abs(deco - decoWidth) >= 1) setDecoWidth(deco)
    }
    // 「正在执行」面板锚点：运行中区块的 offsetLeft（相对 wrap 的 padding box，
    // 即面板 absolute left 所需值）。胶囊宽度动画/内容变化后每渲染实测跟随；
    // 值不变时返回原 state，React bail out，不会死循环。
    const runEl = runBlockRef.current
    if (runEl !== null) {
      const runLeft = runEl.offsetLeft
      setRunBlockLeft(prev => (Math.abs(runLeft - prev) >= 1 ? runLeft : prev))
    }
    // 宽度变化后重放位置（居中模式重新居中 / 锁定模式按中心锚点对称伸缩）。
    // 拖拽进行中绝不重放——否则位置同步会和拖拽对抗，把胶囊拽回去。
    if (dragRef.current !== null) return
    syncPosition()
  })

  if (!enabled) return null

  // 整行淡入：key = displayText，文本变化时 React 重建文本节点重放动画。

  return createPortal(
    <div
      ref={wrapRef}
      className="dsh-done-pill"
      style={wrapStyle(dragging, pos, appearance.scale, fontStackOf(appearance.font))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onMouseEnter={() => { if (dragRef.current === null) setHovered(true) }}
      onMouseLeave={() => { setHovered(false); setHoveredRunning(false); setFileHovered(false) }}
    >
      <div
        ref={shellRef}
        className="dsh-done-pill-shell"
        data-unread={unreadCount > 0 ? '1' : '0'}
        data-dragging={dragging ? '1' : '0'}
        style={pillShellStyle(shellWidth)}
      >
        {/* 健康提醒徽章：设定时段内常驻显示（黄色），与完成通知共存不挤占 */}
        {reminderLabel !== null && (
          <>
            <span style={reminderBadgeStyle} title={reminderLabel} data-dp-zone="badge">
              <LineIcon kind={reminderIcon} size={Math.max(10, Math.round(13 * appearance.scale))} />
              <span>{reminderLabel}</span>
            </span>
            <span style={pillDividerStyle} aria-hidden />
          </>
        )}
        {/* 左块：正在执行中的任务数量（仅在有任务运行时显示），悬停滑出任务列表 */}
        {runningSessions.length > 0 && (
          <>
            <button
              ref={runBlockRef}
              type="button"
              data-dp-zone="run"
              style={{ ...runningBlockStyle(true), ...shellChildStyle, cursor: 'inherit' }}
              aria-label={`正在执行中的任务 ${runningSessions.length} 个；悬停或聚焦查看列表`}
              title="正在执行中的任务"
              onMouseEnter={() => { setHoveredRunning(true); setHovered(false) }}
              onFocus={() => { setHoveredRunning(true); setHovered(false) }}
              onBlur={() => { setHoveredRunning(false) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                const first = runningSessions[0]
                if (first !== undefined) openSession(first.id)
              }}
            >
              <span style={runDotStyle} aria-hidden />
              <span>{runningSessions.length}</span>
            </button>
            <span style={pillDividerStyle} aria-hidden />
          </>
        )}
        {/* 主体：点击 = 直接进入最新完成的会话；按住拖动 = 移动胶囊 */}
        <button
          type="button"
          data-dp-zone="main"
          onKeyDown={(event) => {
            // 键盘可达：点击语义原先只由 wrap 的 pointerup 合成，Enter/Space
            // 落在 button 上不会触发任何动作（拖拽手柄吞掉了默认点击流）。
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            if (latest !== undefined) openSession(latest.sessionId, unreadCount > 0 ? latest.id : undefined)
          }}
          onFocus={() => { setHovered(true); setHoveredRunning(false) }}
          onBlur={() => { setHovered(false) }}
          style={{ ...pillMainStyle, ...shellChildStyle, cursor: 'inherit' }}
          aria-label={latest !== undefined
            ? `打开会话「${latestTitle}」（${unreadCount} 条对话完成未读）；拖动可移动位置`
            : reminderLabel !== null
              ? `${reminderLabel}；拖动可移动位置`
              : '对话完成胶囊（暂无记录）；拖动可移动位置'}
          onMouseEnter={() => { setHovered(true); setHoveredRunning(false) }}
        >
          {unreadCount > 0 && latest !== undefined ? (
            <span style={checkIconStyle(unreadCount)} aria-hidden>✓</span>
          ) : (
            // 图标跟随**当前主文案**：提醒态的月亮/咖啡图标已在左侧徽章上展示，
            // 主文案此时是知识轮播，再放一个月亮会出现「月亮 + Encoder 名词解释」
            // 这种图文不符的组合（旧实现的判断依据是提醒是否激活）。
            <span style={reminderIconStyle} aria-hidden>
              <LineIcon kind={funLine.icon} size={Math.max(10, Math.round(13 * appearance.scale))} />
            </span>
          )}
          <span
            ref={labelRef}
            key={displayText}
            style={{
              // maxWidth 让超长文案以省略号收尾：外壳只有 overflow:hidden 时
              // 文字是被**硬切**的（末字截一半，没有「…」）。装饰宽实测得来，
              // 带提醒徽章/运行中计数时也算得准。
              maxWidth: `calc(min(${SHELL_MAX_W}px, 100vw - 48px) - ${decoWidth}px)`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity: 0,
              animation: `dpLineIn ${MORPH_DUR} ease forwards`,
            }}
          >
            {displayText}
          </span>
        </button>
        {/* 分隔线 + 文件按钮：点击打开文件浏览器抽屉 */}
        <span style={pillDividerStyle} aria-hidden />
        <button
          type="button"
          style={fileButtonStyle(fileHovered)}
          aria-label="文件浏览器"
          title="文件浏览器"
          onPointerDown={(event) => { event.stopPropagation() }}
          onMouseEnter={() => { setFileHovered(true); setHovered(false); setHoveredRunning(false) }}
          onMouseLeave={() => { setFileHovered(false) }}
          onClick={toggleFileExplorer}
        >
          <IconFolderOpenOutline16 size={14} />
        </button>
      </div>
      {/* 运行中任务面板：悬停左块时从下方滑出 */}
      {/* 面板整体吞掉 pointerdown：不然从面板空白处按下会拖动胶囊（面板随即
          因 setHovered(false) 消失，观感像「点一下面板就跑了」）。 */}
      <div
        style={runPanelStyle(hoveredRunning, runShift, panelUp)}
        role="dialog"
        aria-label="正在执行中的任务"
        aria-hidden={!hoveredRunning}
        onPointerDown={(event) => { event.stopPropagation() }}
      >
        <div style={headStyle}>
          <span style={headTitleStyle}>正在执行中</span>
          <span style={headMetaStyle}>{`${runningSessions.length} 个任务 · 点击进入会话`}</span>
        </div>
        {runningSessions.map((session) => {
          const info = runInfo[session.id]
          // 主文本 = 当前正在执行的那条用户消息；无消息时回退会话标题。
          const label = info !== undefined && info.question !== '' ? info.question : session.displayTitle
          return (
            <button
              key={session.id}
              type="button"
              className="dsh-done-pill-row"
              style={runRowStyle}
              title={info !== undefined && info.question !== ''
                ? `「${session.displayTitle}」正在执行：${info.question}`
                : `点击打开会话：${session.displayTitle}`}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={() => { openSession(session.id) }}
            >
              <span style={panelDotStyle} aria-hidden />
              <span style={runRowTitleStyle}>{label}</span>
              {info !== undefined && (
                <span style={runRowTimeStyle}>{formatElapsed(nowTick - info.since)}</span>
              )}
            </button>
          )
        })}
        {runningSessions.length === 0 && (
          <div style={emptyStyle}>没有正在运行的任务</div>
        )}
      </div>
      {/* 记录面板：悬停主体时从下方滑出 */}
      <div
        style={panelStyle(hovered, doneShift, panelUp)}
        role="dialog"
        aria-label="对话完成记录"
        aria-hidden={!hovered}
        onPointerDown={(event) => { event.stopPropagation() }}
      >
        <div style={headStyle}>
          <span style={headTitleStyle}>对话完成记录</span>
          <span style={headMetaStyle}>{`${entries.length} 条 · 点击卡片进入会话`}</span>
        </div>
        {entries.map((item) => {
          const title = item.title
          const unread = !readIds.has(item.id)
          // 主文本 = 完成的那条对话消息；无消息时回退会话标题。
          const headLabel = item.question !== '' ? item.question : item.title
          return (
            <div
              key={item.id}
              className="dsh-done-pill-row"
              style={cardStyle}
              role="button"
              tabIndex={0}
              title={`「${title}」${item.question !== '' ? `问：${item.question}` : ''} — 点击打开会话`}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={() => { openSession(item.sessionId, item.id) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openSession(item.sessionId, item.id)
                }
              }}
            >
              <div style={cardHeadStyle}>
                {unread && <span style={unreadDotStyle} aria-hidden />}
                <span style={sessionTitleStyle}>{headLabel}</span>
                {item.reasonKind === 'error' && <span style={errorTagStyle}>出错结束</span>}
                <span style={metaStyle}>
                  {`回合 ${item.turn >= 0 ? item.turn + 1 : '?'} · ${formatTime(item.endedAt)}`}
                </span>
                <button
                  type="button"
                  className="dsh-done-pill-close"
                  style={closeStyle}
                  aria-label="移除这条记录（不跳转会话）"
                  onPointerDown={(event) => { event.stopPropagation() }}
                  onClick={(event) => { event.stopPropagation(); dismiss(item.id) }}
                >
                  ✕
                </button>
              </div>
              {item.answer !== '' && <pre style={answerStyle}>{item.answer}</pre>}
            </div>
          )
        })}
        {entries.length === 0 && <div style={emptyStyle}>暂无记录 — 任一会话的对话完成后会出现在这里</div>}
      </div>
    </div>,
    document.body,
  )
}

/** 注册 shell.overlay 顶部胶囊 + 基础设置显隐开关行。 */
export function applyDonePill(ctx: ClientContext): void {
  // 样式先行：早于组件首次渲染注入，避免「无样式首帧 + 颜色过渡」。
  ensurePillKeyframes()
  try { sessionsRuntime = (ctx as any).get('sessions') } catch { sessionsRuntime = undefined }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'done-pill',
    order: 90,
  }, DonePill))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill',
      order: 31,
      label: '对话完成胶囊',
    }, DonePillRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill-rest',
      order: 32,
      label: '休息时间提醒',
    }, () => (
      <ReminderRow
        titleText="休息时间提醒"
        descText="设定时间段内胶囊持续提示休息；结束时间早于开始时间表示跨午夜"
        store={restStore}
      />
    )))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill-late',
      order: 33,
      label: '凌晨注意休息',
    }, () => (
      <ReminderRow
        titleText="凌晨注意休息"
        descText="凌晨时段内胶囊持续提示注意休息（默认 00:00-07:00）"
        store={lateStore}
      />
    )))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill-scale',
      order: 34,
      label: '胶囊大小',
    }, PillScaleRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'done-pill-font',
      order: 35,
      label: '胶囊字体',
    }, PillFontRow))
}
