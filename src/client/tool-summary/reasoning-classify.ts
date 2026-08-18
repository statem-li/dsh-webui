/**
 * Heuristic reasoning classifier: bucket a reasoning block into a coarse
 * action category so the activity modal can present thinking in labelled
 * groups instead of one undifferentiated wall of text.
 *
 * Scoring: every category accumulates the number of matching keyword hits
 * across the text; the highest-scoring category wins. A long reasoning block
 * usually contains several action words, so this surface the DOMINANT action
 * rather than whatever keyword happens to appear first.
 */

export interface ReasoningCategory {
  readonly label: string
  readonly icon: string
}

const CATEGORIES: ReadonlyArray<{ label: string; icon: string; patterns: RegExp[] }> = [
  {
    label: '实施编写',
    icon: '✏️',
    patterns: [
      /修改/, /写入/, /实现/, /编辑/, /创建/, /新增/, /构建/, /重写/, /重构/, /覆盖/,
      /调用(一?下)?工具|调用generate_image|调用\d+次/, /写(代码|文件|脚本|函数|组件|插件|一个|好|完|下)/,
      /建(文件|目录|项目|一个)/, /加入|添加/, /定义|声明/, /删除|清理/, /生成结果|产出/,
    ],
  },
  {
    label: '原因排查',
    icon: '🔎',
    patterns: [
      /为什么/, /原因/, /这是因为/, /根本原因/, /导致/, /引发/, /起因/, /溯源/,
      /排查/, /诊断/, /定位问题/, /根因/, /为何/, /怎么会/, /哪里出(错|问题|问)/,
      /问题出在/, /报错|错误|异常/, /失败(了|原因)?/, /原因(是|在|何)/,
      /(找|查)(出|到|一下|一?个)?(原因|问题|根|源头)/, /解释一下/,
    ],
  },
  {
    label: '验证确认',
    icon: '✅',
    patterns: [
      /验证/, /确认(了|下)?/, /测试/, /试验/, /成功后|成功了/, /完美/, /生效/, /没问题/, /通过/,
      /结果[:：]|输出[:：]/, /运行结果/, /实测/, /工作正常/, /验证通过/,
    ],
  },
  {
    label: '规划方案',
    icon: '📋',
    patterns: [
      /计划/, /方案/, /步骤/, /打算/, /思路/, /策略/, /规划/, /设计/, /着手/, /大致/,
      /拆分|分步/, /准备(先|要)?/, /接下来/, /先(写|建|看|试|做|处理)/, /应该(用|先|直接)/,
    ],
  },
  {
    label: '决策权衡',
    icon: '🤔',
    patterns: [
      /选择/, /决定/, /权衡/, /考虑/, /或者/, /对比/, /倾向于/, /取舍/, /到底|究竟/, /两个(方案|选择)/,
    ],
  },
  {
    label: '总结汇报',
    icon: '📝',
    patterns: [
      /总结/, /汇报/, /结论/, /提交/, /推送/, /上传/, /发布/, /收尾/, /搞定/,
      /完成(了|时)?|全部(完成|搞定)/, /完成情况/, /回顾/,
    ],
  },
  {
    label: '探索分析',
    icon: '🔍',
    patterns: [
      /搜索/, /查找/, /看看/, /找找/, /检查/, /查看/, /寻找/, /定位/, /遍历/,
      /目录|结构/, /可能(在|是)?/, /在哪里/, /位置/, /配置|环境/, /是否|有无/,
      /没(有|看到|找到)/, /(更|更)广/, /排除/, /了解|认识/, /读(一下|取|文件|内容)/,
    ],
  },
]

const FALLBACK: ReasoningCategory = { label: '其他', icon: '💬' }

/** Classify one reasoning block by keyword-hit score (dominant action wins). */
export function classifyReasoning(text: string): ReasoningCategory {
  let best = FALLBACK
  let bestScore = 0
  for (const category of CATEGORIES) {
    let score = 0
    for (const pattern of category.patterns) {
      // Re-apply with a fresh global regex to count every occurrence.
      const global = new RegExp(pattern.source, 'g')
      const matches = text.match(global)
      if (matches !== null) score += matches.length
    }
    if (score > bestScore) {
      best = { label: category.label, icon: category.icon }
      bestScore = score
    }
  }
  return best
}

/** Group reasoning items by category, preserving first-appearance order. */
export function groupReasoning<T extends { text: string }>(
  items: readonly T[],
): ReadonlyArray<{ category: ReasoningCategory; items: T[] }> {
  const order: ReasoningCategory[] = []
  const map = new Map<string, T[]>()
  for (const item of items) {
    const category = classifyReasoning(item.text)
    let list = map.get(category.label)
    if (list === undefined) {
      list = []
      map.set(category.label, list)
      order.push(category)
    }
    list.push(item)
  }
  return order.map(category => ({ category, items: map.get(category.label) ?? [] }))
}