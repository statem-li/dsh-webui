# 「小凉多智能体团队」编排插件设计文档（dsh-webui · team 模块）

> 状态：设计稿（v0.1）｜目标：把「小凉的多智能体团队·现行编制」做成 DSH 插件——
> **可视化 + 角色可编排 + 角色模型可编排 + 协作接力运行器**。
> 本文档只定义设计，不涉及实现；实现按 §10 分阶段推进。

---

## 1. 背景与语义还原

参考图（1250×1252 px）：中心**主脑 hanako**（协调中枢，总管·通才·兜底），外围 10 个专职角色，
每个角色绑定一个模型；三类协作编组 + 两套协作约定：

| 编组 | 角色（id / 名称 / 定位） | 模型（图上标注） |
|---|---|---|
| 信息与判断 `judge` | `cha` 察·深度调研多源取证 | v4-flash |
|  | `bo` 驳·质量把关挑漏洞 | gpt-5.6-terra |
|  | `ce` 策·创意发散收敛方案 | v4-flash |
| 落地执行 `act` | `jiang` 匠·技术落地能跑起来 | gpt-5.6-sol |
|  | `zao` 造·游戏原型可玩版本 | v4-pro |
|  | `bi` 笔·写作交付公文成稿 | v4-pro |
|  | `jian` 简·云文档资料管家 | v4-flash |
| 守护支持 `guard` | `liangsu` 凉溯·倾听陪伴情绪支持 | v4-flash |
|  | `mentor` 导师·论文评审答辩把关 | v4-flash |
|  | `yuan` 垣·运维巡检系统守护 | gpt-5.6-terra |
| 中枢 `core` | `hanako` 主脑·协调中枢总管通才兜底 | （调度方） |

**协作接力（链，串行）**：
- `verify` 察 → 驳 → 主脑整合交付
- `ship` 策 → 匠 → 造 →（游戏原型）
- `ops` 垣（诊断）→ 匠（修复）→ 垣（回归验收）

**按需直连（旁路，非链）**：
- 笔 ↔ 简 ↔ 凉溯（互为直连）
- 导师 → 主脑（评审结论经主脑整合后交付）

---

## 2. 设计原则

1. **一切都是数据，且可编排**：角色、角色模型、链条、直连全部结构化存储，用户可在 UI 增删改；
   首次安装由插件**播种**上图默认编制，之后完全自由。
2. **角色与模型解耦但默认绑定**：角色定义只引用「模型绑定」对象；绑定可被单次运行覆盖
   （运行时编排），覆盖优先级：**本次运行 > 角色默认 > 全局默认**。
3. **两种执行通道，按上下文自动选择**：
   - `llm` 直跑：`ctx.llm.stream({provider, model, ...})`，可精确指定模型；**无工具**（纯文本推理）。
   - `subagent` 派发：`ctx.subagents.start({parent, prompt, label, signal})`，**完整 agent 能力**
     （读工作区、改文件、跑校验、调用工具）；模型继承父会话。
   - 通道由 `executor` 字段 + 触发上下文共同决定（见 §4.3）：面板 HTTP 触发只能 `llm`；
     对话内 `team_run` 工具触发可用 `subagent`。
4. **接力串行，汇聚可选**：链是有序线性步骤，上一步输出注入下一步输入；尾步可选「主脑整合」
   汇聚全部步骤产出。v1 不做并行 fan-out DAG。
5. **只通过插件扩展 DSH**：不改 DSH 源码；host/API 模式复用 `planweave` 模块已验证的
   settings 命名空间 + loopback HTTP + 模型工具三件套范式。

---

## 3. 数据模型

### 3.1 角色 `Role`

```ts
interface Role {
  id: string                    // 'cha' | 'bo' | ... 全局唯一，只增不改
  name: string                  // '察'
  en: string                    // 'cha'（图上英文名）
  tagline: string               // '深度调研·多源取证'
  group: 'core' | 'judge' | 'act' | 'guard'
  prompt: string                // 角色系统提示词（自行创建/编辑）
  model: ModelBinding           // 默认模型绑定（可编排：运行时覆盖）
  executor: 'auto' | 'llm' | 'subagent'   // 通道偏好，默认 'auto'
  label?: string                // 图上模型短名（如 'v4-flash'），缺省用 model 的显示名
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
  id: string                    // 'verify' | 'ship' | 'ops'
  name: string                  // '察→驳→主脑整合'
  steps: ChainStep[]
  finalSynthesize: boolean      // 尾步追加主脑整合（默认 true）
}

type ChainStep =
  | { kind: 'role'; roleId: string; taskNote?: string }   // 该步任务模板（可留空=继承 run.task）
  | { kind: 'synthesize'; roleId?: string }               // 明确的主脑整合步（默认 core/hanako）
```

**接力语义**：第 i 步输入 = `角色 prompt + 任务描述 + 上游输出（按上下文窗口裁剪）+ taskNote`。
上下文窗口默认：最近 1 步全量 + 更早步骤摘要（可全局配置）。

### 3.4 直连 `DirectLink`（按需直连，纯语义 + 展示）

```ts
interface DirectLink {
  from: string                  // roleId
  to: string
  label?: string
  kind: 'bidirectional' | 'directed'   // 笔↔简 用 bidirectional；导师→主脑 用 directed
}
```

### 3.5 全局默认 `globals`

```ts
interface TeamGlobals {
  defaultModel: ModelBinding        // 运行级未指定时的兜底
  timeoutSec: number                // 每步超时，默认 300
  maxRetries: number                // 每步失败重试，默认 1
  upstreamWindow: string            // 'last'（最近一步全量）| 'all-summary'
  maxConcurrentRuns: number         // 默认 1
  outputChunkChars: number          // 步骤输出注入上限，默认 8000 字符
  stopOnError: boolean              // 步骤失败是否终止整链（默认 true）
}
```

### 3.6 运行 `Run` / `RunStep`（运行时快照）

```ts
interface Run {
  id: string                    // 'R-<ts>-<rand>'
  chainId: string
  task: string                  // 用户本次任务描述
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  modelOverrides?: Record<string, ModelBinding>   // 单次运行的模型编排
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
  startedAt?: string
  finishedAt?: string
  error?: string
  tokens?: { input: number; output: number }
}
```

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
  prompt 固定「你是主脑 hanako，协调中枢：整合各角色产出，形成最终交付物……」，模型取
  `core` 角色绑定或 globals.defaultModel。
- 产物：`final-deliverable.md`，即对用户可见的交付物。

### 4.5 并发

- 不同 Run 之间由 `maxConcurrentRuns` 限制并发（默认 1，排队 queued）；Run 内步骤严格串行。
- 触发来源：面板 HTTP 启动 / `team_run` 工具启动，共用同一运行队列与存储。

---

## 5. host 半身设计（`src/team/`）

### 5.1 文件划分

```
src/team/
├── types.ts        — 全部数据结构（§3）
├── roster.ts       — roster/globals 读写 + 默认编制播种 + 模型绑定校验
├── engine.ts       — 运行队列 + 状态机 + 步骤执行（llm / subagent 两通道）
├── prompts.ts      — 角色 prompt 装配 + 主脑整合 prompt + 上游上下文裁剪
├── host.ts         — HTTP API 路由（loopback）+ 设置分区 + 模块开关接入
└── tools.ts        — DSH 模型工具 team_run / team_status
```

### 5.2 HTTP API（loopback-only，同 planweave 范式）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/webui-team/roster` | 全量编制（roles/chains/directLinks） |
| POST | `/api/webui-team/roster` | 保存编制（UI 编辑提交） |
| GET/POST | `/api/webui-team/globals` | 全局默认读写 |
| GET | `/api/webui-team/providers` | 模型枚举（provider 分组下拉数据） |
| POST | `/api/webui-team/runs` | 启动链 `{chainId, task, modelOverrides?}` → `{runId, snapshot}` |
| GET | `/api/webui-team/runs` | 进行中/近期运行列表 |
| GET | `/api/webui-team/runs/:id` | 运行快照（UI 轮询，含 steps 状态 + 截断输出） |
| GET | `/api/webui-team/runs/:id/steps/:i/output` | 单步完整输出（防快照过大） |
| POST | `/api/webui-team/runs/:id/cancel` | 取消 |
| GET | `/api/webui-team/history?limit=` | 历史运行清单 |

安全：`loopbackAllowed` 校验 + 产物路径 containment（runs 目录内），同 planweave 既有写法。

### 5.3 DSH 模型工具

| 工具 | 用途 |
|---|---|
| `team_run { chainId?, task, modelOverrides?, roles? }` | 对话内触发链；自带 agent 上下文 → 角色可走 subagent 通道（有工具）。也支持不选链直接点兵（`roles` 指定任意角色序列 + 主脑整合）。 |
| `team_status { runId? }` | 查看运行/最近一次运行状态。 |

工具描述里写清使用场景：需要多角色协作、接力式的任务交给它，并提示输出产物落盘位置。

### 5.4 设置分区

- settings 命名空间 `team`：`defaultProvider` / `defaultModel` / `timeoutSec` 等 globals 的
  settings.yaml 影射（同 planweave 惯例）；roster 大对象走文件。

---

## 6. UI 设计（`src/client/team/`）

### 6.1 入口

主界面左侧导航「新会话」下方菜单项「**团队**」（同自动化面板入口）：点开从菜单右侧滑出
TAB 式面板卡片（窄屏回退底部 sheet）。

### 6.2 面板结构

```
┌─ 团队面板 ─────────────────────────────────────────────┐
│ 工具条：[编制视图 | 运行 | 历史]（模式切换）+ 全局设置   │
│                                                        │
│ 编制视图：径向图（SVG）                                 │
│   中心深蓝圆「主脑 hanako·协调中枢·总管·通才·兜底」      │
│   环形分布 10 角色卡（分组色：judge 青绿 / act 砖红 /    │
│   guard 蓝灰；模型胶囊短名）                            │
│   协作接力链：链选中时高亮箭头路径（察→驳→整合…）       │
│   按需直连：点划线（笔↔简↔凉溯、导师→主脑）             │
│   hover 角色 → 摘要浮层；点击 → 编辑弹窗                │
│                                                        │
│ 运行模式：链下拉 + 任务输入 + [启动]                    │
│   左侧链步骤时间线（状态灯：待办/运行呼吸/成功/失败/跳过）│
│   图上角色随步骤点亮，当前步呼吸动画                     │
│   每步输出抽屉（markdown 渲染）+「打开产物文件」         │
│                                                        │
│ 历史：运行清单（链名/任务/状态/耗时）+ 详情 + 产物入口   │
└────────────────────────────────────────────────────────┘
```

### 6.3 编辑能力（角色/模型可编排的 UI 载体）

- **角色卡编辑弹窗**：名称/en/定位语/分组单选/模型下拉（provider 分组 → model，含 label 短名
  可手填）/executor 单选（auto/llm/subagent）/prompt 多行编辑（CodeMirror）。
- **链编辑**：步骤列表（增/删/拖拽排序）、每步 taskNote 模板、finalSynthesize 开关、
  synthesize 步位置与 roleId。
- **模型覆盖**：运行面板「本次运行模型」——按角色逐项覆盖（默认「用角色绑定」），即单次
  运行的模型编排。
- **播种与重置**：「恢复默认编制」一键覆盖回图上默认（需二次确认，破坏性操作）。

### 6.4 视觉与主题

- 径向图与源图同构（SVG 手绘布局，非第三方图表库，避免新依赖）。
- 分组色与状态色随 `webui-appearance` 玻璃主题适配；浮层面板遵循 dsh-ui-style 铁律
  （backdrop-filter 只加浮层本体、布局列容器不加 filter/transform）。

---

## 7. 持久化

```
~/.dsh/team/
├── roster.json        # { version: 1, roles, chains, directLinks }
└── runs/
    └── R-<ts>-<rand>/
        ├── run.json           # Run 快照（每步完成后原子更新）
        ├── final-deliverable.md   # 主脑整合产物（若有）
        └── steps/
            ├── 00-cha.md
            ├── 01-bo.md
            └── ...
```

- `roster.json` 独立文件（用户可直接编辑、可纳入 git）；globals 走 settings 命名空间 `team`。
- 运行目录只增不回滚；「删除历史」清目录（UI 提供）。

---

## 8. 出厂默认编制（播种数据，从图提取）

### 8.1 角色表

| id | name | en | tagline | group | 模型绑定（图上标注→待映射真 id） | executor |
|---|---|---|---|---|---|---|
| hanako | 主脑 | hanako | 协调中枢·总管·通才·兜底 | core | globals.defaultModel | llm |
| cha | 察 | cha | 深度调研·多源取证 | judge | v4-flash | auto |
| bo | 驳 | bo | 质量把关·挑漏洞 | judge | gpt-5.6-terra | auto |
| ce | 策 | ce | 创意发散·收敛方案 | judge | v4-flash | auto |
| jiang | 匠 | jiang | 技术落地·能跑起来 | act | gpt-5.6-sol | auto |
| zao | 造 | zao | 游戏原型·可玩版本 | act | v4-pro | auto |
| bi | 笔 | bi | 写作交付·公文成稿 | act | v4-pro | auto |
| jian | 简 | jian | 云文档·资料管家 | act | v4-flash | auto |
| liangsu | 凉溯 | liangsu | 倾听陪伴·情绪支持 | guard | v4-flash | auto |
| mentor | 导师 | mentor | 论文评审·答辩把关 | guard | v4-flash | auto |
| yuan | 垣 | yuan | 运维巡检·系统守护 | guard | gpt-5.6-terra | auto |

> 播种时「模型绑定」默认指向全局默认模型 + label 保留图上短名；用户按自己 settings 里的
> 实际 provider/model 改一次即可（UI 下拉）。

### 8.2 链条

- `verify` 察→驳→主脑整合：`[{role:cha},{role:bo},{synthesize}]`（finalSynthesize=true）
- `ship` 策→匠→造→主脑整合：`[{role:ce},{role:jiang},{role:zao},{synthesize}]`
- `ops` 垣→匠→垣→主脑整合：`[{role:yuan},{role:jiang},{role:yuan},{synthesize}]`
  （垣诊断 → 匠修复 → 垣回归验收，同角色两次为不同步骤，产物分文件）

### 8.3 直连

- `{from:bi, to:jian, kind:'bidirectional'}`
- `{from:jian, to:liangsu, kind:'bidirectional'}`（笔↔简↔凉溯 三角中的两对；简↔笔 已含）
- `{from:mentor, to:hanako, kind:'directed'}`（评审结论经主脑整合交付）

---

## 9. 风险与权衡

| 风险 | 权衡/对策 |
|---|---|
| 面板触发的角色无工具（llm 直跑） | 明示降级 + warning；落地/运维类任务建议走对话内 `team_run`（subagent 有全套工具）；察等调研角色可在 prompt 里提示用户先在会话内准备好材料。 |
| 串行链耗时/token 成本 | 每步 maxTokens 预算 + 输出截断 + 超时；链长默认 ≤5 步；历史可见增量。 |
| 图上短名 ≠ settings 真 id | 播种用 label 保留短名、绑定指向默认模型；首次配置用 UI 下拉对一次。 |
| 多 run 并发触发 provider 限流 | `maxConcurrentRuns` 默认 1，超出排队。 |
| subagent 通道模型继承父会话 | 角色「精确模型」仅 llm 直跑路径保证；文档与 UI 标注该差异（executor 单选就有明确语义）。 |
| run 对象在进程重启后丢失 | run.json 落盘 + 启动时扫描 runs/ 恢复「未完结」为 interrupted（可续跑为 P3 增强）。 |

---

## 10. 分阶段计划（每阶段可交付可验收）

**P1 — 编制可视化与编辑（不做运行）**
- roster 数据模型 + 默认编制播种 + providers 枚举 API
- 面板骨架 + 径向图（角色/分组/直连渲染，与图同构）
- 角色编辑弹窗 + 链编辑 + globals 设置
- 验收：打开面板可见完整默认编制；编辑任一角色模型/prompt 并保存，刷新后生效。

**P2 — 运行引擎（llm 直跑通道）**
- runs API（启动/快照/取消/历史）+ 运行队列 + 状态机
- 步骤执行（llm 直跑、超时/重试/截断/落盘）+ 主脑整合步
- 运行模式 UI：链选择/任务输入/状态灯/输出抽屉/历史
- 验收：面板一键跑通默认三条链，图上角色依次点亮，产物落盘可打开。

**P3 — 高级编排**
- `team_run` / `team_status` 工具 + subagent 通道（对话内触发）
- 单次运行模型覆盖（modelOverrides）+ 任意点兵（非链执行）
- done(degraded) 继续策略 + 失败续跑 + 多 run 并发队列
- 验收：对话里 `team_run` 触发「察→驳→整合」，驳角色作为 subagent 有工具能力；运行中可在面板取消。

---

## 11. 与既有模块的关系

- **不冲突**：`planweave`（计划任务图）管「长期项目实施」，team 管「一次任务的多角色接力」；
  两者可组合（team 的产物作为 planweave 的块输入），v1 不做互操作。
- **复用**：providers 枚举、loopback 校验、llm 流式解析、subagent start 均复刻/复用
  planweave 与 automation 的既有范式；模型枚举与 `webui_sync_reasoning` 同一数据源。
- **模块开关**：新增 `team` key 进 `webui-modules`，默认启用（README 模块表补一行）。
