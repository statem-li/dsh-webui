/**
 * webui — 内置示例计划包（播种用）。
 *
 * 与 PlanWeave 上游 examples/basic-plan-package 同构的六任务图（并行分支 +
 * 依赖汇合 + 一个必选评审门），prompt 为精简中文。用于「一键播种示例」：
 * 新项目零门槛看到 claim→执行→评审→反馈的完整闭环与任务图分层布局。
 */

/** 单个虚拟文件的文本内容。 */
export interface SeedFile {
  path: string
  content: string
}

/** 示例包 manifest（plan-package/v1）。 */
export const EXAMPLE_MANIFEST: Record<string, unknown> = {
  version: 'plan-package/v1',
  project: {
    title: 'PlanWeave 示例计划',
    description: '六任务示例：并行分支、依赖汇合与一个评审门。',
  },
  execution: {
    parallel: { enabled: true, maxConcurrent: 2 },
  },
  review: {
    maxFeedbackCycles: 1,
    completionPolicy: 'strict',
  },
  executors: {},
  nodes: [
    {
      id: 'T-001', type: 'task', title: '撰写项目启动报告',
      prompt: 'nodes/T-001/prompt.md',
      acceptance: ['报告说明目标、范围与里程碑。'],
      blocks: [
        {
          id: 'B-001', type: 'implementation', title: '起草启动报告',
          prompt: 'nodes/T-001/blocks/B-001.prompt.md',
          depends_on: [],
        },
        {
          id: 'R-001', type: 'review', title: '评审启动报告',
          prompt: 'nodes/T-001/blocks/R-001.prompt.md',
          depends_on: ['B-001'],
          review: { required: true, maxFeedbackCycles: 1, hook: null },
        },
      ],
    },
    {
      id: 'T-002', type: 'task', title: '梳理用户旅程',
      prompt: 'nodes/T-002/prompt.md',
      acceptance: ['主要步骤与预期结果清晰。'],
      blocks: [{
        id: 'B-002', type: 'implementation', title: '草拟用户旅程',
        prompt: 'nodes/T-002/blocks/B-002.prompt.md',
        depends_on: [],
      }],
    },
    {
      id: 'T-003', type: 'task', title: '定义视觉方向',
      prompt: 'nodes/T-003/prompt.md',
      acceptance: ['包含色彩、字体与布局指引。'],
      blocks: [{
        id: 'B-003', type: 'implementation', title: '编写视觉方向说明',
        prompt: 'nodes/T-003/blocks/B-003.prompt.md',
        depends_on: [],
      }],
    },
    {
      id: 'T-004', type: 'task', title: '组装原型方案',
      prompt: 'nodes/T-004/prompt.md',
      acceptance: ['原型结合旅程与视觉方向。'],
      blocks: [{
        id: 'B-004', type: 'implementation', title: '整合原型计划',
        prompt: 'nodes/T-004/blocks/B-004.prompt.md',
        depends_on: [],
      }],
    },
    {
      id: 'T-005', type: 'task', title: '可用性检查',
      prompt: 'nodes/T-005/prompt.md',
      acceptance: ['指出优点与具体改进项。'],
      blocks: [{
        id: 'B-005', type: 'implementation', title: '评估原型可用性',
        prompt: 'nodes/T-005/blocks/B-005.prompt.md',
        depends_on: [],
      }],
    },
    {
      id: 'T-006', type: 'task', title: '准备演示总结',
      prompt: 'nodes/T-006/prompt.md',
      acceptance: ['总结成果与下一步。'],
      blocks: [{
        id: 'B-006', type: 'implementation', title: '撰写演示总结',
        prompt: 'nodes/T-006/blocks/B-006.prompt.md',
        depends_on: [],
      }],
    },
  ],
  edges: [
    { from: 'T-002', to: 'T-001', type: 'depends_on' },
    { from: 'T-003', to: 'T-001', type: 'depends_on' },
    { from: 'T-004', to: 'T-002', type: 'depends_on' },
    { from: 'T-004', to: 'T-003', type: 'depends_on' },
    { from: 'T-005', to: 'T-004', type: 'depends_on' },
    { from: 'T-006', to: 'T-004', type: 'depends_on' },
  ],
}

/** manifest 引用的全部 prompt markdown（相对 packageDir）。 */
export const EXAMPLE_PROMPT_FILES: SeedFile[] = [
  { path: 'nodes/T-001/prompt.md', content: '# T-001：撰写项目启动报告\n\n写一份简短的项目启动报告。\n' },
  { path: 'nodes/T-001/blocks/B-001.prompt.md', content: '# B-001：起草启动报告\n\n起草启动报告：目标、范围、三个里程碑。输出实现报告说明你写了什么。\n' },
  { path: 'nodes/T-001/blocks/R-001.prompt.md', content: '# R-001：评审启动报告\n\n对照验收标准评审启动报告：是否说清目标、范围与里程碑。输出 passed 或 needs_changes 及理由。\n' },
  { path: 'nodes/T-002/prompt.md', content: '# T-002：梳理用户旅程\n\n梳理产品的核心用户旅程。\n' },
  { path: 'nodes/T-002/blocks/B-002.prompt.md', content: '# B-002：草拟用户旅程\n\n列出主要步骤与每步的预期结果。\n' },
  { path: 'nodes/T-003/prompt.md', content: '# T-003：定义视觉方向\n\n给出视觉方向说明。\n' },
  { path: 'nodes/T-003/blocks/B-003.prompt.md', content: '# B-003：编写视觉方向说明\n\n给出色彩倾向、字体气质与布局原则各一条。\n' },
  { path: 'nodes/T-004/prompt.md', content: '# T-004：组装原型方案\n\n把用户旅程与视觉方向整合成原型方案。\n' },
  { path: 'nodes/T-004/blocks/B-004.prompt.md', content: '# B-004：整合原型计划\n\n按旅程步骤组织页面结构，并标注视觉要点。\n' },
  { path: 'nodes/T-005/prompt.md', content: '# T-005：可用性检查\n\n检查原型方案的可用性。\n' },
  { path: 'nodes/T-005/blocks/B-005.prompt.md', content: '# B-005：评估原型可用性\n\n指出两个优点与两个具体的可用性改进建议。\n' },
  { path: 'nodes/T-006/prompt.md', content: '# T-006：准备演示总结\n\n准备一页演示总结。\n' },
  { path: 'nodes/T-006/blocks/B-006.prompt.md', content: '# B-006：撰写演示总结\n\n一段话总结成果，一句话给出下一步。\n' },
]
