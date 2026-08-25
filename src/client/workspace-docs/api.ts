/**
 * 工作区文档卡片 —— 数据访问薄封装。
 * 全部复用文件浏览器的既有路由与取数函数（/api/file-explorer），
 * 本模块零新增 host 端点：探测走 GET /list，创建走 PUT /write。
 */
import { listDirectory, writeFile, type DirEntry } from '../file-explorer/api.ts'

/** 关心的工作区根文档（小写比较基准，按此顺序展示）。 */
export const WORKSPACE_DOC_TARGETS = ['agents.md', 'claude.md'] as const

/** 一个已存在的工作区文档。 */
export interface WorkspaceDocHit {
  /** 磁盘上的真实文件名（保留原大小写，预览标题用它）。 */
  name: string
  /** 绝对路径（预览 / 写入用）。 */
  path: string
  /** 字节数（列表接口顺带返回）。 */
  size?: number
}

/** 目录拼接：容忍结尾分隔符；统一正斜杠（Windows 的 fs 解析同样接受）。 */
export function joinWorkspacePath(dir: string, name: string): string {
  return /[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}/${name}`
}

/**
 * 探测工作区根下的 AGENTS.md 与 CLAUDE.md（大小写不敏感——同时兼容
 * agent.md / claude.md 等小写变体），按固定顺序返回实际存在的文件。
 */
export async function probeWorkspaceDocs(cwd: string): Promise<WorkspaceDocHit[]> {
  const entries: DirEntry[] = await listDirectory(cwd)
  const hits: WorkspaceDocHit[] = []
  for (const target of WORKSPACE_DOC_TARGETS) {
    const hit = entries.find(entry => entry.type === 'file' && entry.name.toLowerCase() === target)
    if (hit !== undefined) {
      hits.push({ name: hit.name, path: joinWorkspacePath(cwd, hit.name), size: hit.size })
    }
  }
  return hits
}

/** AGENTS.md 一键创建时写入的初始骨架（创建后预览卡内可直接编辑）。 */
export const AGENT_MD_TEMPLATE = `# AGENTS.md

> 工作区级 AI Agent 指令：Agent 在本工作区内工作前会阅读本文件。

## 项目概述

-

## 常用命令

- 构建：
- 测试：

## 协作规范

-
`

/** 在工作区根创建 AGENTS.md（写入骨架；调用方仅在两文件都不存在时暴露入口）。 */
export function createAgentMd(cwd: string): Promise<{ version: string; operation: string }> {
  return writeFile(joinWorkspacePath(cwd, 'AGENTS.md'), AGENT_MD_TEMPLATE)
}
