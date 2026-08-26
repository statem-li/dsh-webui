# 团队 Agent 编排插件设计文档（dsh-webui · team 模块）

> 状态：设计稿（v0.5）｜目标：在 DSH 里做**多团队 / 多角色 agent 编排器**——
> **多团队可视化 + 角色可编排 + 团队级与角色级模型可设置 + 协作接力运行器 + 对话框一键团队模式
> + 对话流实时执行 HUD + 可拖拽/可关联的编制画布 + 一句话生成团队 + 每角色装配插件工具与技能包**。
> 本文档只定义设计，不涉及实现；实现按 §10 分阶段推进。
>
> **v0.5 变更**（每角色能力装配）：
> 1. 角色新增 `capabilities`：工具装配（继承/白名单/黑名单）+ 技能装配（继承/只用所选/不用技能）
>    + 技能包多选（选中即展开包内技能）。
> 2. 新增 `GET /api/webui-team/capabilities`：暴露当前进程注册的全部工具、技能注册表与技能包账本，
>    供角色编辑面渲染可装配清单。
> 3. 生效路径按通道分流：`subagent` 通道走 DSH 原生 `subagents.start({ toolFilter })` **真实限制**
>    工具（从子 agent 提示词消失且拒绝执行）；`llm` 直跑通道无工具，工具装配仅作声明、技能则
>    **把正文内联进 system**（按预算截断）——llm 通道唯一能"装配"技能的方式。
>
> **v0.4 变更**（面板体验重做）：
> 1. 面板从「侧栏右侧小浮卡」改为**右侧全高抽屉**（宽度 min(1180px, 92vw)，占满右边可视区）；
>    编制页改为**左画布 + 右检视栏**双列（抽屉窄于 860px 时自动退化为上下单列）。
> 2. 编制图升级为**可交互画布**：节点可拖拽排布（位置持久化到 `role.pos`，归一化 0..1）、
>    拖节点右下角连接柄**建立关联**、点连线可改单/双向或删除、「自动重排」清空手工位置。
> 3. 新增**一句话生成团队**：`POST /teams {action:'generate'}` + `team_create` 工具，
>    模型只产结构（角色/提示词/分组/链/关联），不产模型绑定（§12）。
>
> **v0.3 变更**：新增 §6.6 对话流「团队执行详情」悬浮 HUD——运行中在对话流上方浮出
> 团队/链名、总耗时与预估、TODO 进度条，以及**每角色一张运行卡**（状态/模型来源/单步计时/
> 流式摘要/产物），支持折叠、取消运行、多团队并发分段。
>
> **v0.2 变更**：
> 1. 引入 **Team（团队）** 一层实体：可建多个团队（新建/复制/删除/切换），每个团队各自持有
>    **团队默认模型**、角色集、链条与直连；角色模型默认「继承团队」，可单独覆盖（§3.0/§3.1/§3.7）。
> 2. 新增**对话框团队开关**：会话输入区一键开启「团队模式」，本会话任务交由所选团队编排执行
>    （零 DSH 源码改动，走动态系统提示词 + `team_run` 工具，§6.5）。
> 3. 模型解析优先级四级：**本次运行 > 角色覆盖 > 团队默认 > 全局默认**。

---

## 1. 背景与语义还原

参考图（1250×1252 px）：中心**主脑 星见**（协调中枢，总管兜底），外围 5 个专职角色；
三组编组（core / act / guard）+ 两套协作约定：

| 编组 | 角色（id / 名称 / 定位） |
|---|---|
| 中枢 `core` | `brain` 星见·协调中枢总管兜底 |
| 落地执行 `act` | `architect` 观月·拆解需求定架构选型 |
|  | `strategist` 凛音·评审方案识别风险 |
|  | `coder` 琉夏·依规编码稳定产出 |
|  | `tester` 星乃·编写测试验证闭环 |
| 守护支持 `guard` | `reviewer` 神代·审查代码质量守门 |

**协作接力（链，串行）**：
- `full-delivery` 架构师 → 程序员 → 审查员 → 主脑整合交付
- `fast-iteration` 程序员 → 测试员 → 主脑整合交付

**按需直连（旁路，非链，全双向）**：
- 架构师 ↔ 策略师（方案互审）
- 程序员 ↔ 审查员（审查返修）
- 程序员 ↔ 测试员（缺陷修复）

---

## 2. 设计原则

1. **一切都是数据，且可编排**：团队、角色、模型绑定、链条、直连全部结构化存储，用户可在 UI 增删改；
   首次安装由插件**播种**一个默认团队（§8 编制），之后完全自由（可新建/复制/删除团队）。
2. **模型分层可设置**：每个**团队**有团队默认模型；每个**角色**默认继承团队模型，也可单独覆盖；
   单次运行还能临时覆盖。解析优先级：**本次运行 > 角色覆盖 > 团队默认 > 全局默认**（§3.7）。
3. **两种执行通道，按上下文自动选择**：
   - `llm` 直跑：`ctx.llm.stream({provider, model, ...})`，可精确指定模型；**无工具**（纯文本推理）。
   - `subagent` 派发：`ctx.subagents.start({parent, prompt, label, signal})`，**完整 agent 能力**
     （读工作区、改文件、跑校验、调用工具）；模型继承父会话。
   - 通道由 `executor` 字段 + 触发上下文共同决定（见 §4.3）：面板 HTTP 触发只能 `llm`；
     对话内 `team_run` 工具触发可用 `subagent`。
4. **波次接力，同波并行，汇聚可选**：链展开成**波次**序列 —— 同一波次的角色**并发执行**
   （受 `maxParallel` 限制，默认 2），波次之间严格串行（后一波看得到前面全部波次的产出）；
   尾步可选「主脑整合」汇聚全部步骤产出。并行有三个来源：链步骤上的 `parallel: true`、
   `team_run` 的 `plan` 波次数组、`autoPlan` 让主脑自主编排（§4.5）。
5. **只通过插件扩展 DSH**：不改 DSH 源码；host/API 模式复用 `planweave` 模块已验证的
   settings 命名空间 + loopback HTTP + 模型工具三件套范式。

---

## 3. 数据模型

### 3.0 团队 `Team`（新增，v0.2 核心）

```ts
interface Team {
  id: string                    // 't-<slug>'，全局唯一，只增不改
  name: string                  // '软件工程全流程团队' / '写作小队'
  description?: string
  /** 团队默认模型：本团队所有角色的默认模型（角色可覆盖）。 */
  model: ModelBinding
  /** 团队成员角色（角色对象内联在团队里，团队间互不影响）。 */
  roles: Role[]
  chains: Chain[]
  directLinks: DirectLink[]
  /** 团队级执行偏好（缺省继承 globals）。 */
  overrides?: Partial<TeamGlobals>
  createdAt: string
  updatedAt: string
}
```

- **为什么把角色内联在团队里**：不同团队可以有同名/同职能但提示词与模型完全不同的角色，
  内联避免跨团队耦合与「改一处炸全局」；复制团队 = 深拷贝 roles/chains。
- 存储：`~/.dsh/team/teams/<teamId>.json` 一团队一文件（§7）。
- UI：面板顶部**团队切换器**（下拉 + 新建 + 复制 + 删除），下方为该团队的编制视图。

### 3.1 角色 `Role`

```ts
interface Role {
  id: string                    // 'brain' | 'architect' | ... 团队内唯一
  name: string                  // '星见'
  en: string                    // 'brain'（图上英文名）
  tagline: string               // '协调中枢·总管兜底'
  group: 'core' | 'judge' | 'act' | 'guard'
  prompt: string                // 角色系统提示词（自行创建/编辑）
  /** 模型：null/缺省 = 继承所属团队的 team.model；对象 = 本角色覆盖。 */
  model: ModelBinding | null
  executor: 'auto' | 'llm' | 'subagent'   // 通道偏好，默认 'auto'
  label?: string                // 模型短名（如 'v4-flash'），缺省用解析后模型的显示名
  tags?: string[]
}
```

### 3.2 模型绑定 `ModelBinding`（模型亦为编排对象）

```ts
interface ModelBinding {
  provider: string              // settings llm-pi-ai providers 的 key
  model: string                 // 该 provider 下 model id
  reasoningEfforts?: 'low' | 'medium' | 'high' | ...
  maxTokens?: number            // 本角色单步输出预算
}
```

- 模型目录来源：DSH `llm-pi-ai` 命名空间（与 `webui_sync_reasoning` / `planweave /providers`
  同一数据源），UI 用下拉枚举（provider 分组 → model）。
- `reasoningEfforts` 透传；缺失时可用既有 `webui_sync_reasoning` 供应商模板补全。

### 3.3 链条 `Chain`（协作接力）

```ts
interface Chain {
  id: string                    // 'full-delivery' | 'fast-iteration'
  name: string                  // '架构师→程序员→审查员→主脑整合'
  steps: ChainStep[]
  finalSynthesize: boolean      // 尾步追加主脑整合（默认 true）
}

type ChainStep =
  | { kind: 'role'; roleId: string; taskNote?: string }   // 该步任务模板（可留空=继承 run.task）
  | { kind: 'synthesize'; roleId?: string }               // 明确的主脑整合步（默认 core/brain）
```

**接力语义**：第 i 步输入 = `角色 prompt + 任务描述 + 上游输出（按上下文窗口裁剪）+ taskNote`。
上下文窗口默认：最近 1 步全量 + 更早步骤摘要（可全局配置）。

### 3.4 直连 `DirectLink`（按需直连，纯语义 + 展示）

```ts
interface DirectLink {
  from: string                  // roleId
  to: string
  label?: string
  kind: 'bidirectional' | 'directed'   // 架构师↔策略师 用 bidirectional；单向结论类可用 directed
}
```

### 3.5 全局默认 `globals`

```ts
interface TeamGlobals {
  defaultModel: ModelBinding        // 团队未设模型时的最终兜底
  activeTeamId: string              // 面板与对话框开关当前选中的团队
  timeoutSec: number                // 每步超时，默认 300
  maxRetries: number                // 每步失败重试，默认 1
  upstreamWindow: string            // 'last'（最近一步全量）| 'all-summary'
  maxConcurrentRuns: number         // 默认 1
  outputChunkChars: number          // 步骤输出注入上限，默认 8000 字符
  stopOnError: boolean              // 步骤失败是否终止整链（默认 true）
}
```

团队可用 `Team.overrides` 覆盖除 `defaultModel`/`activeTeamId` 外的任意项（团队级执行偏好）。

### 3.6 运行 `Run` / `RunStep`（运行时快照）

```ts
interface Run {
  id: string                    // 'R-<ts>-<rand>'
  teamId: string                // 所属团队（v0.2）
  chainId: string | null        // null = 临时点兵（roles 序列）
  task: string                  // 用户本次任务描述
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  modelOverrides?: Record<string, ModelBinding>   // roleId → 单次运行的模型编排
  /** 触发来源：面板 / 对话框团队开关 / team_run 工具。 */
  origin: 'panel' | 'chat-toggle' | 'tool'
  sessionId?: string            // chat-toggle / tool 触发时的会话 id
  startedAt: string
  finishedAt?: string
  steps: RunStep[]
  error?: string
}

interface RunStep {
  index: number
  roleId: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  inputSnapshot: string         // 截断后的输入（分页取全文见 API）
  output: string                // 截断后摘要
  modelUsed: ModelBinding
  /** 模型来自哪一层（UI 上标注「继承团队」/「角色覆盖」/「本次覆盖」）。 */
  modelSource: 'run' | 'role' | 'team' | 'global'
  startedAt?: string
  finishedAt?: string
  error?: string
  tokens?: { input: number; output: number }
}
```

### 3.7 模型解析（四级优先级，v0.2）

```ts
function resolveModel(run, team, role): { binding: ModelBinding; source: ModelSource } {
  const byRun = run.modelOverrides?.[role.id]
  if (byRun) return { binding: byRun, source: 'run' }        // 1. 本次运行覆盖
  if (role.model) return { binding: role.model, source: 'role' }  // 2. 角色覆盖
  if (team.model) return { binding: team.model, source: 'team' }  // 3. 团队默认
  return { binding: globals.defaultModel, source: 'global' }      // 4. 全局兜底
}
```

- 解析在**每步开始时**做一次并写入 `RunStep.modelUsed/modelSource`——运行中改团队模型不影响
  已在跑的步骤，语义确定。
- 校验：解析结果的 `provider/model` 必须存在于 providers 枚举，否则该步 error 并给出可操作提示
  （「团队默认模型 x/y 不在已配置供应商中，请到团队设置里重选」）。
- **subagent 通道的模型无法精确指定**（继承父会话）：此时 `modelUsed` 记为解析值但附
  `warning: 'subagent 通道模型继承父会话'`，UI 用灰色斜体标注，避免误以为生效。

---

## 4. 执行引擎设计

### 4.1 状态机（单 Run）

```
queued → running ─(全部步骤 done)→ done
                ─(某步 error 且 stopOnError)→ error
                ─(被取消)→ cancelled（当前步 abort，后续 pending → skipped）
```

### 4.2 步骤执行

```
for step of chain.steps (+ 可选 synthesize 尾步):
  prompt = 装配(角色 prompt, run.task, taskNote, 上游输出)
  通道 = 选通道(step.role, run 触发上下文)
  结果 = 通道执行(prompt, modelUsed, signal, timeout)
  写步骤产物 step-<idx>-<roleId>.md → 更新 run.json → 推送状态
```

- **超时/重试**：每步 AbortController + `timeoutSec`；失败按 `maxRetries` 重试，仍失败 → 按
  `stopOnError` 决定终止或继续（继续时该步标 error、后续照常，run 结束 status='done(degraded)' 记入 error 列表）。
- **输出保护**：步骤输出全量落盘，注入上游时按 `outputChunkChars` 截断。
- **取消**：run 级 AbortController，贯穿所有步骤；取消时当前步骤立即 abort。

### 4.3 通道选择

```ts
function 选通道(role, 触发上下文):
  pref = role.executor                    // 'auto' | 'llm' | 'subagent'
  hasAgentCtx = 触发上下文.exec?.agent !== undefined  // 仅 DSH 工具触发时有
  if pref === 'llm'                  → 'llm'
  if pref === 'subagent' && hasAgentCtx → 'subagent'
  if pref === 'subagent'            → 'llm'（降级，run 记录 warning：该角色无工具）
  if pref === 'auto'  && hasAgentCtx → 'subagent'
  else                               → 'llm'
```

- `llm`：`llm.stream({ provider, model, messages, system, maxTokens, signal, reasoningEfforts })`
  （复用 automation-host 的流式解析范式：text-delta 累积，finish reason 校验）。
- `subagent`：`subagents.start(provider, { parent: exec.agent, prompt, label, signal })`，
  `stopReason ∈ {completed, max-tokens}` 视为完成，文本提取自 output text blocks（复用
  `planweave/executor.ts` 的 `runSubagentText` 范式）。

### 4.4 主脑整合（synthesize）

- 默认尾步：输入 = 全部步骤输出（按 `outputChunkChars` 预算聚合，超限取每步摘要），
  prompt 固定「你是主脑 星见，协调中枢：整合各角色产出，形成最终交付物……」，模型按 §3.7
  解析（`core` 角色覆盖 → 团队默认 → 全局默认）。
- 产物：`final-deliverable.md`，即对用户可见的交付物。

### 4.5 并发与并行（波次模型）

**Run 之间**：`maxConcurrentRuns` 限制同时进行的运行数（默认 1，其余 queued 排队）。

**Run 之内**：步骤按**波次**（wave）推进 —— 同一波次并发执行，波次之间串行。
`RunStep.wave` 记录每步归属的波次（旧快照无此字段时按 `index` 兜底 = 全串行），
`Run.waveCount` 记录波次总数（小于 `steps.length` 即存在并行）。

三种并行来源（优先级从高到低）：

| 来源 | 入口 | 语义 |
|---|---|---|
| `autoPlan: true` | `team_run` 参数 / 面板「主脑自主派发」 | 运行开始时先用主脑角色的模型问一次计划（`PLAN_SYSTEM`，只要一段 JSON），拿到 `{note, waves}` 后据此填充步骤；解析失败或全部角色非法则退回「全体非主脑角色串行 + 整合」，并把 `note` 写入 `Run.planNote` |
| `plan: [["architect","strategist"],["coder"]]` | `team_run` 参数 / `POST /runs` | 调用方显式编排：一个数组元素 = 一个波次 |
| `parallel: true` | `Chain.steps[i]` | 该步与**上一步同波次**；首步的 `parallel` 无意义（自成一波） |

约束与降级：

- 单波角色数超过 `maxParallel`（默认 2，范围 1–5）时**自动溢出**到下一个波次 —— 从源头限制
  同时在飞的请求数，配合 `provider-throttle` 避免 429。`maxParallel: 1` 等价于回到全串行。
- `synthesize` 步永远独占最后一个波次（它必须看得到全部上游产出）。
- **上游可见性**：一个步骤的上游上下文只包含**更早波次**的产出。同波伙伴与它同时开跑，
  产出尚不存在（也不该引用别人半截的流式快照），因此提示词里显式告知「谁在与你同时干活」，
  要求各自只做本职、需要同伴结论的部分写成「待汇合确认」交给后续波次/整合处理。
- 通道不受并行影响：每个步骤按自己的 `executor` 独立选 `llm` / `subagent`，
  一个波次里可以混合两种通道。
- 失败语义不变：波次内任一步 error 且 `stopOnError` 为真时，本波跑完即停止后续波次
  （同波其它步骤不会被中途掐断，避免半截产物）。

**快照写入并发安全**：`patchStep` 是同步的读—改—写 `run.json`（`readRun`/`saveRun` 都是同步
fs 调用，写盘为 tmp+rename 原子替换）。Node 单线程下这段读改写不会被其它 JS 打断，所以同波
多个步骤交替写快照时各自只改自己那一项，不会互相覆盖。

触发来源：面板 HTTP 启动 / `team_run` 工具启动，共用同一运行队列与存储。

---

## 5. host 半身设计（`src/team/`）

### 5.1 文件划分

```
src/team/
├── types.ts        — 全部数据结构（§3）
├── store.ts        — teams/ 多团队读写（一团队一文件）+ 默认团队播种 + 原子写
├── roster.ts       — 单团队编制校验 + 模型解析（§3.7）+ providers 枚举投影
├── engine.ts       — 运行队列 + 状态机 + 步骤执行（llm / subagent 两通道）+ 增量快照写入
├── prompts.ts      — 角色 prompt 装配 + 主脑整合 prompt + 上游上下文裁剪
├── chat-mode.ts    — 对话框团队开关：会话级开关存储 + 动态 systemPrompt 注入（§6.5）
├── host.ts         — HTTP API 路由（loopback）+ 设置分区 + 模块开关接入
└── tools.ts        — DSH 模型工具 team_run / team_status / team_list
```

client 半身：

```
src/client/team/
├── index.ts        — 模块装配（面板入口 + 对话框开关 + HUD）
├── api.ts          — /api/webui-team/* fetch 封装
├── types.ts        — 与 host 共享的视图类型
├── styles.ts       — 注入样式（前缀 team-，对齐 dsh-ui-style 控件规格）
├── Panel.tsx       — 团队面板（切换器 / 编制图 / 运行 / 历史）
├── RadialGraph.tsx — SVG 径向编制图
├── RoleEditor.tsx  — 角色编辑弹窗（含模型下拉「继承团队默认」）
├── ChatToggle.tsx  — 对话框团队开关（input.right, order 4）
├── RunHud.tsx      — 对话流悬浮执行 HUD（§6.6）
└── RoleRunCard.tsx — HUD 内单角色运行卡
```

### 5.2 HTTP API（loopback-only，同 planweave 范式）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/webui-team/teams` | 团队清单（id/name/model/角色数/链数） |
| POST | `/api/webui-team/teams` | `{action: create\|duplicate\|remove\|rename, ...}` |
| GET | `/api/webui-team/teams/:id` | 单团队全量编制（roles/chains/directLinks/model） |
| POST | `/api/webui-team/teams/:id` | 保存该团队编制（UI 编辑提交，含团队默认模型） |
| GET/POST | `/api/webui-team/globals` | 全局默认读写（含 activeTeamId） |
| GET | `/api/webui-team/providers` | 模型枚举（provider 分组下拉数据） |
| GET/POST | `/api/webui-team/chat-mode` | 对话框团队开关：`{sessionId}` → `{enabled, teamId, chainId}`；POST 写入 |
| POST | `/api/webui-team/runs` | 启动 `{teamId, chainId?, roles?, task, modelOverrides?}` → `{runId, snapshot}` |
| GET | `/api/webui-team/runs` | 进行中/近期运行列表（可按 teamId 过滤） |
| GET | `/api/webui-team/runs/active?sessionId=` | 本会话活跃 Run 快照数组（对话流 HUD 轮询，§6.6） |
| GET | `/api/webui-team/runs/:id` | 运行快照（UI 轮询，含 steps 状态 + 截断输出 + modelSource） |
| GET | `/api/webui-team/runs/:id/steps/:i/output` | 单步完整输出（防快照过大） |
| POST | `/api/webui-team/runs/:id/cancel` | 取消 |
| GET | `/api/webui-team/history?teamId=&limit=` | 历史运行清单 |

安全：`loopbackAllowed` 校验 + 产物路径 containment（runs 目录内），同 planweave 既有写法。

### 5.3 DSH 模型工具

| 工具 | 用途 |
|---|---|
| `team_run { teamId?, chainId?, task, roles?, modelOverrides? }` | 对话内触发链；`teamId` 缺省用 `globals.activeTeamId`（或本会话开关选定的团队）。自带 agent 上下文 → 角色可走 subagent 通道（有工具）。也支持不选链直接点兵（`roles` 指定任意角色序列 + 主脑整合）。 |
| `team_status { runId? }` | 查看运行/最近一次运行状态（含每步模型与来源层）。 |
| `team_list {}` | 列出可用团队与其角色/链（供模型在开启团队模式时自选合适团队与链）。 |

工具描述里写清使用场景：需要多角色协作、接力式的任务交给它，并提示输出产物落盘位置。

### 5.4 设置分区

- settings 命名空间 `webui-team`：globals 的 settings.yaml 影射（`defaultProvider`/`defaultModel`/
  `activeTeamId`/`timeoutSec` 等，同 planweave 惯例）；团队编制大对象走文件（§7）。
- 模块开关：新增 `team` key 进 `webui-modules`（默认启用），host 关闭时不注册路由/工具/提示词，
  client 关闭时不挂面板入口与对话框开关。


---

## 6. UI 设计（`src/client/team/`）

### 6.1 入口

主界面左侧导航「新会话」下方菜单项「**团队**」（同自动化面板入口）：点开从菜单右侧滑出
TAB 式面板卡片（窄屏回退底部 sheet）。

### 6.2 面板结构

```
┌─ 团队面板 ─────────────────────────────────────────────┐
│ 团队切换器：[软件工程全流程团队 ▾] [+ 新建] [⧉ 复制] [🗑 删除]   │
│ 团队默认模型：[provider / model ▾]  ← 团队级模型设置     │
│ 工具条：[编制 | 运行 | 历史]（模式切换）+ ⚙ 全局设置     │
│                                                        │
│ 编制视图：径向图（SVG）                                 │
│   中心深蓝圆「主脑 星见·协调中枢·总管兜底」              │
│   环形分布角色卡（分组色：core 深蓝 / act 砖红 /          │
│   guard 蓝灰；模型胶囊短名，继承团队时显示为浅色「团队」）│
│   协作接力链：链选中时高亮箭头路径（观月→琉夏→神代→整合…）│
│   按需直连：点划线（架构师↔策略师、程序员↔审查员、        │
│   程序员↔测试员）                                        │
│   hover 角色 → 摘要浮层；点击 → 编辑弹窗                │
│                                                        │
│ 运行模式：链下拉 + 任务输入 + [启动]                    │
│   「本次运行模型」折叠区：逐角色覆盖（默认=角色/团队）   │
│   左侧链步骤时间线（状态灯：待办/运行呼吸/成功/失败/跳过）│
│   图上角色随步骤点亮，当前步呼吸动画                     │
│   每步输出抽屉（markdown 渲染）+ 模型来源标注 +「产物」  │
│                                                        │
│ 历史：运行清单（团队/链名/任务/状态/耗时）+ 详情 + 产物  │
└────────────────────────────────────────────────────────┘
```

### 6.3 编辑能力（团队/角色/模型可编排的 UI 载体）

- **团队管理**：切换器内新建（空团队或从默认编制播种）/复制当前团队/重命名/删除（二次确认）。
- **团队默认模型**：面板头部一个下拉（provider 分组 → model），改完立即保存；所有「继承团队」
  的角色胶囊同步刷新显示。
- **角色卡编辑弹窗**：名称/en/定位语/分组单选/**模型**（下拉首项固定为「继承团队默认（xxx）」，
  其后是 provider 分组模型；选中具体模型即写入 `role.model` 覆盖）/label 短名可手填/
  executor 单选（auto/llm/subagent）/prompt 多行编辑。
- **链编辑**：步骤列表（增/删/拖拽排序）、每步 taskNote 模板、finalSynthesize 开关、
  synthesize 步位置与 roleId。
- **模型覆盖（单次运行）**：运行面板「本次运行模型」——按角色逐项覆盖（默认「用角色/团队设置」）。
- **播种与重置**：「恢复默认编制」一键把当前团队覆盖回出厂编制（破坏性，二次确认）。

### 6.4 视觉与主题

- 径向图与源图同构（SVG 手绘布局，非第三方图表库，避免新依赖）。
- 分组色与状态色随 `webui-appearance` 玻璃主题适配；浮层面板遵循 dsh-ui-style 铁律
  （backdrop-filter 只加浮层本体、布局列容器不加 filter/transform）。
- 控件规格对齐官方 ModelsSection：输入框/下拉 32px 高、8px 圆角，开启态用
  `--dsw-alias-state-business-primary`（不用 brand-primary，反色坑）。

### 6.5 对话框团队开关（v0.2 新增）

**位置**：会话输入区 `conversation.input.right` 槽位，注册 order 4（位于「提示词优化」order 5、
供应商标签 order 10 左侧）——与 `prompt-optimize` 完全相同的挂载范式，零 DSH 源码改动。

**交互**：

```
[👥 团队 ▾]   ← 关闭态：灰色图标；开启态：business-primary 高亮 + 团队名胶囊
   点击 → 悬浮小卡（图标上方，popover）：
     ┌──────────────────────────────┐
     │ ● 团队模式          [开关]   │
     │ 团队   [软件工程全流程团队 ▾]        │
     │ 链条   [自动选择 ▾]          │  ← 自动 = 由主脑判断走哪条链/临时点兵
     │ 模型   团队默认：未设置      │  ← 只读回显，改动跳团队面板
     │ ────────────────────────     │
     │ ⓘ 开启后本会话的任务将由该    │
     │   团队接力执行，产物落盘。    │
     │ [打开团队面板]               │
     └──────────────────────────────┘
```

**状态存储**：会话级（`sessionId` → `{enabled, teamId, chainId}`），localStorage 立即生效
+ `POST /api/webui-team/chat-mode` 持久化到 host（跨刷新/跨端一致，同 `browser-speed` 范式）。

**生效机制（关键，避免改 DSH 源码）**：

1. host 侧 `chat-mode.ts` 注册 `ctx.systemPrompt.section({ name: 'team-mode', text: () => ... })`：
   当前会话开关为 ON 时注入一段指令 —— 说明「本会话已开启团队模式，团队 X 可用角色/链如下，
   处理需要多角色协作的任务时调用 `team_run` 工具，简单问答仍直接回答」；OFF 时返回空串（零 token）。
2. 模型据此在需要时调用 `team_run`；工具触发天然带 agent 上下文 → 角色可走 **subagent 通道**
   （有完整工具能力），比面板触发的 llm 直跑更强。
3. 运行过程复用同一引擎与存储：会话里能看到工具卡进度，面板「运行」视图同步显示状态灯。

**为什么不是「开关一开就自动接管每条消息」**：DSH 的消息发送链路属内核，硬接管需要改源码
（违反项目约束）。用「提示词 + 工具」让模型自主判断，既零侵入，又保留简单问答不被绕远路的能力。
若用户希望强制每轮都走团队，卡片里提供「强制模式」勾选：注入更强措辞（「本会话所有任务
一律先调用 team_run」），仍是提示词层面。

### 6.6 对话流「团队执行详情」悬浮 HUD（v0.3 新增）

**触发**：本会话存在 `status ∈ {queued, running}` 的 Run（无论由对话框开关、`team_run` 工具还是
面板启动，只要 `run.sessionId` 命中当前会话），对话流上方浮出运行 HUD；运行结束后停留
15s 显示汇总，再自动收起为一枚可点开的小胶囊（点开=回看本次运行详情）。

**挂载**：`conversation.composer.dock` 上方的独立浮层（fixed，贴对话区顶部居中，宽度跟随
对话列宽），portal 到 body，z-index 低于设置弹窗（≤ 900），避开 dsh-ui-style 铁律里
「布局列容器不加 filter/transform」的陷阱——HUD 自身是浮层本体，可加 backdrop-filter。

**HUD 结构**（折叠态一行、展开态角色卡网格）：

```
┌─ 折叠态（默认，高 40px）────────────────────────────────────┐
│ 👥 软件工程全流程团队 · full-delivery 链   ●●○○  2/4 步   ⏱ 01:23   [展开▾] │
└──────────────────────────────────────────────────────────────┘

┌─ 展开态 ─────────────────────────────────────────────────────┐
│ 👥 软件工程全流程团队 · 观月→琉夏→神代→整合      ⏱ 01:23 / 预估 03:00     │
│ 任务：核实 xxx 并给出可交付结论            [取消运行] [收起▴] │
│ ── TODO 进度条 ─────────────────────────────────────────     │
│ ▓▓▓▓▓▓▓▓░░░░░░░░  2/4 完成 · 1 进行中 · 1 待办                │
│                                                              │
│ ┌── 角色卡网格（每角色一卡，按步骤顺序）───────────────────┐ │
│ │ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────┐ │ │
│ │ │✅ 观月      │ │🔄 琉夏      │ │⏳ 神代      │ │        │ │ │
│ │ │拆解需求     │ │依规编码     │ │审查代码     │ │        │ │ │
│ │ │继承团队     │ │继承团队     │ │继承团队     │ │        │ │ │
│ │ │⏱ 00:38 完成 │ │⏱ 00:45 进行 │ │—            │ │        │ │ │
│ │ │▸ 输出摘要…  │ │▸ 实时增量…  │ │             │ │        │ │ │
│ │ └────────────┘ └────────────┘ └────────────┘ └────────┘ │ │
│ └──────────────────────────────────────────────────────────┘ │
│ 产物：steps/00-architect.md · steps/01-coder.md   [打开产物目录]       │
└──────────────────────────────────────────────────────────────┘
```

**角色卡（RoleRunCard）字段**：

| 区域 | 内容 |
|---|---|
| 头 | 状态图标（⏳待办 / 🔄运行中呼吸动画 / ✅成功 / ❌失败 / ⏭跳过）+ 角色名 + en |
| 副标题 | 角色 tagline |
| 模型行 | 实际使用模型短名 + 来源徽标（`本次`/`角色`/`团队`/`全局`）；subagent 通道加灰色斜体「继承会话」 |
| 计时 | 本步耗时（运行中实时走秒，完成后固定值） |
| 摘要 | 输出前 N 字；运行中显示流式增量尾部；点击展开抽屉看全文（复用面板输出抽屉） |
| 失败态 | 错误信息 + 重试次数（`1/1 重试后仍失败`） |

**TODO 进度语义**：`总步数 = chain.steps.length + (finalSynthesize ? 1 : 0)`；
`完成 = status==='done'`、`进行中 = 'running'`、`待办 = 'pending'`、`异常 = 'error'|'skipped'`。
进度条按「完成/总数」填充，异常步用红色段标出，不占完成量。

**计时**：HUD 显示 `now - run.startedAt`（本地 1s tick）；每步显示
`finishedAt ?? now - startedAt`。预估耗时 = 同团队同链最近 3 次成功运行的平均总耗时
（不足 3 次不显示预估）。

**数据来源**：`GET /api/webui-team/runs/active?sessionId=` 返回本会话活跃 Run 快照
（含每步状态/模型/摘要/时间）；运行中 1s 轮询、空闲 5s 轮询，运行结束后停止。
流式增量摘要由 engine 每 ~500ms 把当前步的累积输出写进 run.json 的 `steps[i].output`（截断），
HUD 直接读快照即可，不额外开 SSE（与 automation/planweave 的轮询范式一致）。

**多团队并发**：同会话同时有多个 Run 时（`maxConcurrentRuns>1`），HUD 折叠态显示
`N 个团队运行中`，展开后按 Run 分段（每段一个团队标题 + 该团队的角色卡网格）。

**交互**：
- 折叠/展开状态持久化到 localStorage（`dsh-webui.team.hud.expanded`）。
- 「取消运行」→ `POST /runs/:id/cancel`，当前步 abort，后续步标 skipped。
- 角色卡点击 → 输出抽屉（markdown 渲染，同面板）；「打开产物目录」→ 复用文件浏览器弹窗。
- 运行结束：成功 → 绿色边框 + 汇总一行「4/4 完成 · 02:41 · 产物 5 个文件」；失败 → 红色边框
  + 首个失败步定位按钮。


---

## 7. 持久化

```
~/.dsh/team/
├── globals.json            # TeamGlobals（含 activeTeamId；也影射进 settings.yaml）
├── teams/
│   ├── t-mt8v11xo.json    # 一团队一文件：{version,id,name,model,roles,chains,directLinks}
│   └── t-writing.json
├── chat-mode.json          # sessionId → {enabled, teamId, chainId, force}
└── runs/
    └── R-<ts>-<rand>/
        ├── run.json           # Run 快照（每步完成后原子更新）
        ├── final-deliverable.md   # 主脑整合产物（若有）
        └── steps/
            ├── 00-architect.md
            ├── 01-coder.md
            ├── 02-reviewer.md
            └── ...
```

- 团队文件独立（用户可直接编辑、可纳入 git、可导入导出分享团队编制）。
- 写入用「临时文件 + rename」原子替换，避免半写坏文件。
- 运行目录只增不回滚；「删除历史」清目录（UI 提供）。
- `chat-mode.json` 按会话保留最近 N=200 条，超出按最后使用时间淘汰。


---

## 8. 出厂默认团队（播种数据，从图提取）

首次启用时播种一个团队 `t-mt8v11xo`「软件工程全流程团队」，`team.model` = `{provider:'', model:''}`
（出厂让用户在面板设一次团队默认模型），角色 `model` 一律为 `null`（继承团队）。用户改一次
团队默认模型即全体生效；需要差异化时再逐个角色覆盖。

### 8.1 角色表

| id | name | en | tagline | group | model | executor |
|---|---|---|---|---|---|---|
| brain | 星见 | brain | 协调中枢·总管兜底 | core | null（继承团队） | auto |
| architect | 观月 | architect | 拆解需求·定架构选型 | act | null | auto |
| strategist | 凛音 | strategist | 评审方案·识别风险 | act | null | auto |
| coder | 琉夏 | coder | 依规编码·稳定产出 | act | null | auto |
| tester | 星乃 | tester | 编写测试·验证闭环 | act | null | auto |
| reviewer | 神代 | reviewer | 审查代码·质量守门 | guard | null | auto |


### 8.2 链条

- `full-delivery` 架构师→程序员→审查员→主脑整合：`[{role:architect},{role:coder},{role:reviewer},{synthesize}]`（finalSynthesize=true）
- `fast-iteration` 程序员→测试员→主脑整合：`[{role:coder},{role:tester},{synthesize}]`

### 8.3 直连

- `{from:architect, to:strategist, kind:'bidirectional', label:'方案互审'}`
- `{from:coder, to:reviewer, kind:'bidirectional', label:'审查返修'}`
- `{from:coder, to:tester, kind:'bidirectional', label:'缺陷修复'}`

---

## 9. 风险与权衡

| 风险 | 权衡/对策 |
|---|---|
| 面板触发的角色无工具（llm 直跑） | 明示降级 + warning；落地/运维类任务建议走对话框团队开关或 `team_run`（subagent 有全套工具）。 |
| 串行链耗时/token 成本 | 每步 maxTokens 预算 + 输出截断 + 超时；链长默认 ≤5 步；历史可见增量。 |
| 图上短名 ≠ settings 真 id | 播种时角色模型一律「继承团队」，只需设一次团队默认模型即可跑通。 |
| 多 run 并发触发 provider 限流 | `maxConcurrentRuns` 默认 1，超出排队。 |
| subagent 通道模型继承父会话，团队/角色模型设置不生效 | executor 单选给出明确语义；UI 在角色卡与运行步骤上标注「subagent 通道模型继承会话」；需要精确模型的角色设 `executor:'llm'`。 |
| 对话框开关靠提示词生效，模型可能不调用 `team_run` | 卡片提供「强制模式」加强措辞；工具描述写清触发条件；面板运行入口始终作为确定性兜底。 |
| 团队数量膨胀、编制文件手改坏 | 一团队一文件 + 原子写 + 读取时 schema 校验，坏文件降级为「只读 + 报错提示」，不阻塞其他团队。 |
| run 对象在进程重启后丢失 | run.json 落盘 + 启动时扫描 runs/ 恢复「未完结」为 interrupted（可续跑为 P3 增强）。 |

---

## 10. 分阶段计划（每阶段可交付可验收）

**P1 — 多团队编制可视化与编辑（不做运行）**
- 团队数据模型 + 一团队一文件存储 + 默认团队播种 + providers 枚举 API
- 面板骨架 + 团队切换器 + **团队默认模型下拉** + 径向图（角色/分组/直连渲染）
- 角色编辑弹窗（模型下拉含「继承团队默认」首项）+ 链编辑 + globals 设置
- 验收：可新建/复制/删除团队；改团队默认模型后所有「继承」角色胶囊同步；改任一角色
  模型/prompt 保存后刷新仍在。

**P2 — 运行引擎（llm 直跑通道）**
- runs API（启动/快照/取消/历史）+ 运行队列 + 状态机 + 四级模型解析落 `modelSource`
- 步骤执行（llm 直跑、超时/重试/截断/落盘）+ 主脑整合步
- 运行模式 UI：链选择/任务输入/本次运行模型覆盖/状态灯/输出抽屉/历史
- 验收：面板一键跑通默认三条链，图上角色依次点亮，产物落盘可打开，每步显示实际模型与来源层。

**P3 — 对话框团队开关 + subagent 通道**
- `team_run` / `team_status` / `team_list` 工具 + subagent 通道
- 对话框团队开关（输入区 order 4 图标 + 悬浮卡 + 会话级持久化 + 动态 systemPrompt 注入 + 强制模式）
- 任意点兵（非链执行）+ done(degraded) 继续策略 + 失败续跑 + 多 run 并发队列
- 验收：在对话里打开团队开关选定团队，发一个需要调研+评审的任务，模型自动调用 `team_run`，
  驳角色作为 subagent 具备工具能力；面板运行视图同步显示进度且可取消。

**P4 — 对话流执行 HUD**
- `/runs/active?sessionId=` 接口 + engine 增量快照写入（每 ~500ms 落当前步流式摘要）
- `RunHud` 折叠/展开、总耗时与预估、TODO 进度条、取消运行、结束汇总与自动收起
- `RoleRunCard`：状态灯呼吸动画、模型来源徽标、单步计时、流式摘要、输出抽屉、产物入口
- 多团队并发分段渲染
- 验收：对话里触发团队运行，HUD 自动浮出并逐步点亮角色卡，进度与计时实时走动；
  取消后当前步立即中止、后续标跳过；结束 15s 后收起为胶囊，点开可回看。


---

**P5 — 面板体验重做（v0.4）**
- 右侧全高抽屉（min(1180px, 92vw)）替代小浮卡；编制页左画布 + 右检视栏双列，
  窄于 860px 退化为上下单列（ResizeObserver 观察抽屉宽度）
- 可交互画布：节点拖拽（位置写入 `role.pos`，松手提交一次）、连接柄建关联、
  连线点选改单/双向或删除、自动重排
- 一句话生成团队：生成弹窗（需求输入 + 示例 chips + 生成用模型 + 进度）
  + `POST /teams {action:'generate'}` + `team_create` 工具
- 验收：抽屉占满右侧且随窗口自适应；拖动节点后刷新位置保持；拖连接柄能建立关联并可删除；
  「一句话生成」能产出一支可直接跑的新团队（角色带完整提示词、链可用）。

---

## 11. 编制画布交互契约（v0.4）

| 交互 | 触发 | 行为 | 持久化 |
|---|---|---|---|
| 拖拽排布 | 在节点上按住左键拖动 | 只改本地 state 的一个坐标；不请求网络、不重算布局 | 松手时一次性 POST 整团队（写全部节点的 `role.pos`，固化当前布局） |
| 打开角色编辑 | 单击节点（未发生拖动位移） | 选中该角色 + 右侧检视栏展开对应卡片并滚动到位 | — |
| 建立关联 | 按住节点右下角连接柄拖到另一节点松手 | 新增 `directLinks` 一条（默认双向）；同一对角色已存在则提示不重复添加 | 立即保存 |
| 选中关联 | 单击连线（12px 透明命中区） | 高亮连线 + 浮出操作条（改向 / 删除）；Delete 键同样可删 | — |
| 改单双向 | 操作条「改为单向/双向」或双击连线 | 切换 `kind` | 立即保存 |
| 自动重排 | 画布工具条「自动重排」 | 清空全部 `role.pos`，回到分组环形自动布局 | 立即保存 |
| 高亮链条 | 画布工具条链下拉 | 该链接力路径以品牌蓝箭头高亮 | 不持久化（视图态） |

**位置语义**：`role.pos` 是**归一化坐标**（0..1，相对画布宽高），因此抽屉宽高变化、
窗口缩放、双列/单列切换时布局等比例保持，不会跑到可视区外。越界值在归一化阶段丢弃并回退
自动布局；精度收敛到 4 位小数，避免拖拽把长浮点写满团队文件。

**性能约束**（遵守项目红线：影响性能的需求不做）：拖拽期间只更新一个 `transform`
与一处 state，不触发布局重算、不发网络请求；无 rAF 常驻循环，全事件驱动；
只在松手时提交一次保存。

---

## 12. 一句话生成团队（v0.4）

**入口**：面板头部「✨ 一句话生成」按钮 → 弹窗（需求输入框 + 示例 chips + 生成用模型下拉
+ 生成进度与耗时）；对话内可直接调 `team_create` 工具。

**接口**：`POST /api/webui-team/teams { action: 'generate', brief, provider?, model?, teamModel? }`
→ `{ team, teams, activeTeamId }`。生成用模型优先级：显式指定 > `globals.defaultModel` >
agent 当前默认模型；都缺时报可操作错误。

**生成契约**（`src/team/generate.ts`）：
- 系统提示词要求模型输出**严格 JSON**：`{name, description, roles[], chains[], directLinks[]}`；
  角色需含 `id/name/en/tagline/group/prompt`，`prompt` ≥150 字且包含身份、职责清单、协作纪律、输出要求。
- **模型只产结构，不产模型绑定**：所有角色 `model` 一律写 `null`（继承团队默认）。
  这是刻意的设计——让模型编 provider/model 必然编出不存在的组合，反而要用户回头逐个改。
- 稳健解析：容忍 markdown 围栏与前后缀噪声；解析失败 / 模型报错 / 超时（180s）一律抛可读错误，
  **不写半成品团队**。
- 清洗与兜底：角色 id 净化为 `[a-z0-9_-]{1,20}` 并去重（上限 12 个）；缺 `core` 主脑时自动补一个
  带完整提示词的主脑；链引用不存在角色的步骤丢弃；一条链都没有时用非 core 角色顺序拼一条主链
  （保证开箱可跑）；关联的自环与悬空引用丢弃。

**生成后提示**：若团队默认模型仍为空，UI 与工具返回都会提醒「去面板顶部选一次团队默认模型」，
因为全体角色都继承它。

---

## 12.5 每角色能力装配（v0.5）

**数据模型**：`Role.capabilities?: RoleCapabilities`

```ts
interface RoleCapabilities {
  toolMode: 'inherit' | 'allow' | 'deny'   // 工具：继承 / 白名单 / 黑名单
  tools: string[]                            // 工具名（inherit 时忽略）
  skillMode: 'inherit' | 'allow' | 'none'   // 技能：不限制 / 只用所选 / 不用技能
  skills: string[]                           // 技能名（allow 时生效）
  skillBundles: string[]                     // 技能包 id（展开为包内技能并合并）
}
```

- **默认 = 完全继承**：`capabilities` 缺省或等于默认值时**不写进团队文件**（保持编制文件干净）。
- 白名单/黑名单但名单为空 → 无意义 → 归一化阶段回退 `inherit`（避免"白名单空 = 屏蔽全部"的坑）。
- 名单去重、去空白、限量（工具/技能 64、技能包 32）。

**能力目录**：`GET /api/webui-team/capabilities` → `{ tools, skills, bundles }`
- `tools` 来自 `ctx.tools.schemas()`（当前进程注册的全部工具，含各插件贡献的）。
- `skills` 来自 `ctx.skills.list()`（DSH 技能注册表，含 `modelInvocable` 禁用标注）。
- `bundles` 来自 `${DSH_AGENTS_HOME}/skills/.bundles.json`（与 skill-toggles / 技能管理面板同一份账本）。

**生效路径（按执行通道分流，见 engine.ts）**：

| 通道 | 工具 | 技能 |
|---|---|---|
| `subagent` | `subagents.start({ toolFilter: {allow|deny} })` **真实限制**——被限制的工具从子 agent 提示词消失且拒绝执行；provider 不支持 `toolFilter` 能力时降级重试一次（不限制） | 白名单写进 system 提示词，子 agent 自行用 `skill` 工具加载完整说明 |
| `llm` 直跑 | 本无工具：装配只写进 system 作能力声明（明示"需要哪些操作，由主脑/下游执行"） | **把技能正文内联进 system**（总预算 12k 字符、单技能 6k、超出截断）——llm 通道唯一能"装配"技能的方式 |

**记录与提示**：每步 `RunStep.capabilities` 记录实际生效的装配（模式 + 名单 + 缺失项 + 通道说明）；
装配清单里当前环境找不到的名字记入 `missingTools`/`missingSkills` 并在运行卡 warning 里提示，**不阻断执行**。

---

## 13. 与既有模块的关系

- **不冲突**：`planweave`（计划任务图）管「长期项目实施」，team 管「一次任务的多角色接力」；
  两者可组合（team 的产物作为 planweave 的块输入），v1 不做互操作。
- **复用**：providers 枚举、loopback 校验、llm 流式解析、subagent start 均复刻/复用
  planweave 与 automation 的既有范式；模型枚举与 `webui_sync_reasoning` 同一数据源。
- **模块开关**：新增 `team` key 进 `webui-modules`，默认启用（README 模块表补一行）。
