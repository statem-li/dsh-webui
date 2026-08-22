/**
 * webui — PlanWeave 技能接入（host 半身）。
 *
 * 把随包分发的 7 个 PlanWeave 技能（assets/planweave-skills/<name>/SKILL.md，
 * 来自上游 GaosCode/PlanWeave 的 skills/ 目录）安装到 DSH 的技能目录。
 *
 * 目标目录与 skill-toggles.ts 同款解析——managed root：
 *   ${DSH_AGENTS_HOME:-~/.agents}/skills/<name>/SKILL.md
 * 技能标识 = 目录名（skill-toggles 的 locateSkillDir 即按目录名定位），
 * 因此目录名保持上游原名（plan-maker 等，专有性强、冲突概率低），正文里的
 * 「Use skill: plan-runner」等相互引用保持有效。
 *
 * 安装幂等：目标存在且内容相同 → skipped(same)；存在且不同且未 force →
 * skipped(differs)；否则整文件写入。接线：host.ts 的 applyPlanweaveHost 里
 * 调用 applyPlanweaveSkills(ctx) 一行即可。
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 包内技能资源目录：host 产物位于 <包根>/lib/*.js，资源在 <包根>/assets。 */
function bundledSkillsRoot(): string {
  return fileURLToPath(new URL('../assets/planweave-skills', import.meta.url))
}

/** DSH 技能 managed root（与 skill-toggles.ts 的 managedRoot 同款解析）。 */
function managedSkillsRoot(): string {
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  return join(agentsHome, 'skills')
}

interface InstallOutcome {
  name: string
  status: 'installed' | 'same' | 'differs' | 'failed'
  detail?: string
}

/** 列出目录下的直接子目录名；目录不存在/不可读返回空数组。 */
async function subDirsOf(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}

/** 安装全部随包技能，返回逐技能结果。 */
async function installAll(force: boolean): Promise<{ outcomes: InstallOutcome[]; targetRoot: string }> {
  const sourceRoot = bundledSkillsRoot()
  const targetRoot = managedSkillsRoot()
  const names = await subDirsOf(sourceRoot)
  if (names.length === 0) {
    throw new Error(`包内未找到技能资源：${sourceRoot}`)
  }
  const outcomes: InstallOutcome[] = []
  for (const name of names) {
    try {
      const sourceFile = join(sourceRoot, name, 'SKILL.md')
      const content = await readFile(sourceFile, 'utf8')
      const targetDir = join(targetRoot, name)
      const targetFile = join(targetDir, 'SKILL.md')
      let existing: string | null = null
      try {
        existing = await readFile(targetFile, 'utf8')
      } catch {
        existing = null
      }
      if (existing !== null && existing === content) {
        outcomes.push({ name, status: 'same' })
        continue
      }
      if (existing !== null && !force) {
        outcomes.push({ name, status: 'differs', detail: '目标已存在且内容不同；传 force:true 覆盖' })
        continue
      }
      await mkdir(targetDir, { recursive: true })
      await writeFile(targetFile, content, 'utf8')
      outcomes.push({ name, status: 'installed' })
    } catch (error) {
      outcomes.push({ name, status: 'failed', detail: error instanceof Error ? error.message : String(error) })
    }
  }
  return { outcomes, targetRoot }
}

/** 把安装结果渲染成人类可读清单。 */
function renderOutcomes(outcomes: InstallOutcome[], targetRoot: string, force: boolean): string {
  const lines: string[] = [`PlanWeave 技能安装（目标：${targetRoot}${force ? '，force 覆盖' : ''}）：`]
  for (const o of outcomes) {
    if (o.status === 'installed') lines.push(`  ✔ ${o.name}：已安装`)
    else if (o.status === 'same') lines.push(`  ● ${o.name}：已是最新，跳过`)
    else if (o.status === 'differs') lines.push(`  ○ ${o.name}：${o.detail ?? '内容不同'}`)
    else lines.push(`  ✖ ${o.name}：失败${o.detail !== undefined ? ` — ${o.detail}` : ''}`)
  }
  const installed = outcomes.filter(o => o.status === 'installed').length
  lines.push(`共 ${String(outcomes.length)} 个技能：${String(installed)} 安装、${String(outcomes.filter(o => o.status === 'same').length)} 已最新、${String(outcomes.filter(o => o.status === 'differs').length)} 需确认、${String(outcomes.filter(o => o.status === 'failed').length)} 失败。`)
  lines.push('装好后即可按技能指令使用：plan-maker（从模糊目标生成计划）、plan-coordinator（编排执行）、plan-runner / plan-reviewer / plan-recovery（实现/评审/恢复）、plan-importer（从文档导入）、plan-auditor（审查计划质量）。')
  return lines.join('\n')
}

/**
 * 注册 planweave_install_skills 工具。由 applyPlanweaveHost 调用；
 * ctx.effect 生命周期由调用方统一包裹（本函数只做注册、返回 disposer）。
 */
export function registerPlanweaveSkillsTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'planweave_install_skills',
    description: '把 PlanWeave 的 7 个 agent 技能安装到 DSH 技能目录（~/.agents/skills）：plan-maker（从模糊目标生成计划包）、plan-importer（从 PRD/文档导入）、plan-auditor（审查计划质量）、plan-coordinator（编排执行循环）、plan-runner（执行实现块）、plan-reviewer（执行评审门）、plan-recovery（诊断恢复）。装好后重启会话即可按技能指令协作。',
    parameters: {
      force: { type: 'boolean', description: '目标同名技能已存在且内容不同时是否覆盖（默认 false 跳过并提示）。' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const force = args.force === true
      const { outcomes, targetRoot } = await installAll(force)
      return renderOutcomes(outcomes, targetRoot, force)
    },
    presentCall: () => ({ card: 'generic' as const, kind: 'other' as const, title: '安装 PlanWeave 技能', rawInput: null }),
  }))
}
