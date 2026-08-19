/**
 * SkillsPanel — 技能管理面板（自旧 client.js 的 dsh-skill-manager 区域原样提取）。
 *
 * UI 与逻辑保持与旧 bundle 完全一致：技能列表、bundle 管理（新建/重命名/删除/归入）、
 * zip/文件夹上传安装、删除技能、文件查看器。数据全部走 /api/skill-manager/*。
 * 旧代码的 React.createElement 树在此转写为 JSX，样式沿用旧 .skm-* 类名与 token。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconChevronDownOutline14, IconEditOutline16, IconFolderOpenOutline16,
  IconPlusOutline16, IconRefreshOutline14, IconTrashOutline16, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { modalAnimClass } from '../../modal-animation'

/** ---------------------------------------------------------------- 数据模型 */

interface SkillInfo {
  name: string
  description?: string
  files?: string[]
  fileCount?: number
  compatibility?: string
}

interface BundleInfo {
  id: string
  name: string
  skillCount: number
  skills: SkillInfo[]
}

interface SkillSnapshot {
  bundles: BundleInfo[]
  loose: SkillInfo[]
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: SkillSnapshot }

/** ---------------------------------------------------------------- 文案与参数 */

const SKILL_ZH: Record<string, string> = {
  entry: '技能', panelTitle: '技能管理', close: '关闭', loading: '正在读取技能…',
  error: '暂时无法读取技能。', retry: '重试',
  uploadHint: '拖入技能文件夹安装，或点击选择', uploadMeta: '{n} 个文件 · {folder}',
  fileCount: '{n} 文件', expandSkillFiles: '展开技能文件', previewLoading: '正在加载内容…', viewSkillFiles: '查看技能文件', viewerNav: '技能文件', assignToBundle: '归入 Bundle', assignTitle: '将「{name}」归入', assignEmpty: '还没有技能包,先点「新建 Bundle」创建一个。', deleteSkillBtn: '删除技能',
  installName: '技能名称', installNamePlaceholder: '例如 my-skill', installDescription: '描述（可选）',
  installNameFromArchive: '技能名取自压缩包内的 SKILL.md',
  installNameInvalid: '技能名只能包含小写字母、数字和连字符（a-z 0-9 -）',
  installBundle: '归入 Bundle', installLoose: '不归组（散装）', installConfirm: '安装', installCancel: '取消',
  bundlesTitle: '技能包', bundlesEmpty: '还没有技能包，点「新建 Bundle」创建一个。',
  bundleNoSkills: '还没有技能，可上传或从散装技能中归入。',
  newBundle: '新建 Bundle', newBundlePlaceholder: 'Bundle 名称', create: '创建', cancel: '取消',
  renameBundlePlaceholder: '新的 Bundle 名称', rename: '重命名', delete: '删除',
  skillsCount: '{n} 个技能', removeSkill: '移出',
  looseTitle: '散装技能', looseEmpty: '没有散装 Skill',
  deleteBundleConfirm: '删除 Bundle「{name}」？其中的技能将变为散装。',
  deleteSkillConfirm: '删除技能「{name}」？此操作会删除它的文件。',
}

function skillT(key: string, params?: Record<string, string | number>): string {
  let text = SKILL_ZH[key] ?? key
  if (params) {
    for (const k of Object.keys(params)) text = text.split(`{${k}}`).join(String(params[k]))
  }
  return text
}

/** ---------------------------------------------------------------- API */

const SKILL_API_BASE = '/api/skill-manager'

async function skillRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(SKILL_API_BASE + path, options)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'request failed (' + String(response.status) + ')')
  return body
}

type InstallInput =
  | { archive: string; description: string; bundleId?: string }
  | { skillName: string; description: string; bundleId?: string; files: Array<{ path: string; data: string }> }

const skillApi = {
  list: (): Promise<SkillSnapshot> => skillRequest<SkillSnapshot>('/list', { headers: { accept: 'application/json' } }),
  createBundle: (name: string): Promise<Record<string, never>> =>
    skillRequest('/bundles', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ name }) }),
  renameBundle: (bundleId: string, name: string): Promise<Record<string, never>> =>
    skillRequest(`/bundles/${encodeURIComponent(bundleId)}`, { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ name }) }),
  deleteBundle: (bundleId: string): Promise<Record<string, never>> =>
    skillRequest(`/bundles/${encodeURIComponent(bundleId)}`, { method: 'DELETE', headers: { accept: 'application/json' } }),
  setBundleSkills: (bundleId: string, skillNames: string[]): Promise<Record<string, never>> =>
    skillRequest(`/bundles/${encodeURIComponent(bundleId)}/skills`, { method: 'PUT', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ skillNames }) }),
  deleteSkill: (name: string): Promise<Record<string, never>> =>
    skillRequest(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { accept: 'application/json' } }),
  installSkill: (input: InstallInput): Promise<Record<string, never>> =>
    skillRequest('/skills', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(input) }),
}

/** ---------------------------------------------------------------- 样式 */

const css = {
  entry: 'skm-entry',
  label: 'skm-label',
  modal: 'skm-modal',
  modalBody: 'skm-modal-body',
  panel: 'skm-panel',
  topRow: 'skm-top-row',
  newBundleButton: 'skm-new-bundle',
  upload: 'skm-upload',
  uploadActive: 'skm-upload-active',
  hiddenInput: 'skm-hidden-input',
  installForm: 'skm-install-form',
  installRow: 'skm-install-row',
  inlineForm: 'skm-inline-form',
  inlineInput: 'skm-inline-input',
  bundleSelect: 'skm-bundle-select',
  installMeta: 'skm-install-meta',
  installActions: 'skm-install-actions',
  sectionTitle: 'skm-section-title',
  status: 'skm-status',
  failure: 'skm-failure',
  error: 'skm-error',
  bundleList: 'skm-bundle-list',
  bundle: 'skm-bundle',
  bundleRow: 'skm-bundle-row',
  bundleName: 'skm-bundle-name',
  bundleCount: 'skm-bundle-count',
  chevron: 'skm-chevron',
  bundleActions: 'skm-bundle-actions',
  iconAction: 'skm-icon-action',
  skillList: 'skm-skill-list',
  skillItem: 'skm-skill-item',
  skillRow: 'skm-skill-row',
  skillLabel: 'skm-skill-label',
  skillName: 'skm-skill-name',
  skillDescription: 'skm-skill-desc',
  skillExpand: 'skm-skill-expand',
  skillCount: 'skm-skill-count',
  skillCompat: 'skm-skill-compat',
  skillFiles: 'skm-skill-files',
  skillFile: 'skm-skill-file',
  skillPreview: 'skm-skill-preview',
  viewerModal: 'skm-viewer-modal',
  viewerBody: 'skm-viewer-body',
  viewerLayout: 'skm-viewer-layout',
  viewerNav: 'skm-viewer-nav',
  viewerNavItem: 'skm-viewer-nav-item',
  viewerNavDir: 'skm-viewer-nav-dir',
  viewerContent: 'skm-viewer-content',
  looseEmpty: 'skm-loose-empty',
  visuallyHidden: 'skm-visually-hidden',
}

const STYLE_ID = 'dsh-skill-manager-styles'
const SHEET = `
.skm-entry{flex:1 1 50%;min-width:0;display:inline-flex;align-items:center;gap:8px;height:32px;box-sizing:border-box;border:none;border-radius:10px;padding:0 8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,#eee);font-family:inherit;font-size:14px;line-height:20px;overflow:hidden}
.skm-entry:hover{background:transparent}
.skm-entry[aria-expanded='true']{background:transparent;color:var(--dsw-alias-label-primary,#eee)}
.skm-entry:focus,.skm-entry:focus-visible{outline:none;border:none}
.skm-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skm-modal{width:min(520px,calc(100vw - 48px))}
.skm-modal-body{overflow:hidden;display:flex;flex-direction:column}
.skm-panel{display:flex;flex-direction:column;gap:8px;max-height:min(640px,calc(100vh - 220px));overflow-y:auto;padding:2px 2px 6px;box-sizing:border-box}
.skm-top-row{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px}
.skm-new-bundle{flex:none;display:inline-flex;align-items:center;gap:4px;appearance:none;border:none;border-radius:12px;padding:4px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#999);background:transparent;cursor:pointer}
.skm-new-bundle:hover,.skm-new-bundle[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.skm-upload{flex:none;display:flex;align-items:center;justify-content:center;gap:8px;min-height:56px;padding:10px 12px;box-sizing:border-box;border:1px dashed var(--dsw-alias-border-l3,#444);border-radius:12px;color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:18px;text-align:center;cursor:pointer;user-select:none}
.skm-upload:hover{border-color:var(--dsw-alias-state-business-primary,#4a9eff);color:var(--dsw-alias-label-secondary,#bbb)}
.skm-upload-active{border-color:var(--dsw-alias-state-business-primary,#4a9eff);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-hidden-input{display:none}
.skm-install-form{flex:none;display:flex;flex-direction:column;gap:8px;padding:10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.skm-install-row{display:flex;flex-direction:column;gap:6px}
.skm-inline-form{flex:none;display:flex;align-items:center;gap:6px}
.skm-inline-input{flex:1;min-width:0;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;padding:0 10px;font-size:13px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-base,#0e1116)}
.skm-inline-input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.skm-bundle-select{display:flex;align-items:center}
.skm-bundle-select select{flex:1;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;padding:0 8px;font-size:13px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-base,#0e1116)}
.skm-install-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.skm-install-actions{display:flex;align-items:center;gap:6px}
.skm-section-title{margin:6px 2px 0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}
.skm-status{margin:2px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888)}
.skm-failure{display:flex;align-items:center;gap:8px}
.skm-failure p{margin:2px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#e0434b)}
.skm-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e0434b)}
.skm-bundle-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.skm-bundle{display:flex;flex-wrap:wrap;align-items:center;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.skm-bundle-row{flex:1;min-width:0;display:inline-flex;align-items:center;gap:8px;appearance:none;border:none;background:transparent;padding:8px 10px;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-primary,#eee)}
.skm-bundle-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-bundle-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.skm-bundle-count{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.skm-chevron{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary,#888);transition:transform 120ms}
.skm-bundle[data-open='true'] .skm-chevron{transform:rotate(180deg)}
.skm-bundle-actions{margin-left:auto;display:flex;align-items:center;gap:2px;padding-right:6px}
.skm-icon-action{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:50%;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888)}
.skm-icon-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.skm-skill-list{list-style:none;margin:0;padding:2px 6px 6px;width:100%;display:flex;flex-direction:column;gap:2px}
.skm-skill-item{display:flex;flex-direction:column;gap:2px;padding:2px 0;border-radius:8px}
.skm-skill-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-skill-row{display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:8px}
.skm-skill-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-skill-label{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.skm-skill-name{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skm-skill-desc{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skm-skill-expand{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:6px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#888);transition:transform 120ms}
.skm-skill-expand:hover{color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-skill-expand[data-open='true']{transform:rotate(180deg)}
.skm-skill-count{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border-radius:8px;padding:0 6px;white-space:nowrap}
.skm-skill-compat{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
.skm-skill-files{list-style:none;margin:0 0 2px 10px;padding:2px 0 2px 10px;border-left:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));display:flex;flex-direction:column;gap:0}
.skm-skill-file{display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);font-family:ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skm-skill-file:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-skill-file[data-main='true']{color:var(--dsw-alias-label-primary,#eee);font-weight:500}
.skm-skill-dir{color:var(--dsw-alias-label-tertiary,#888)}
.skm-skill-preview{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;background:var(--dsw-alias-bg-base,#0e1116);padding:8px 12px;margin:0 0 2px 10px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-primary,#eee);overflow:auto;max-height:280px;box-sizing:border-box}
.skm-skill-preview h3,.skm-skill-preview h4,.skm-skill-preview h5{margin:10px 0 4px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}
.skm-skill-preview p{margin:4px 0}
.skm-skill-preview pre{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border-radius:8px;padding:8px 10px;overflow:auto;font-family:ui-monospace,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#bbb);margin:6px 0}
.skm-skill-preview code{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border-radius:4px;padding:0 4px;font-family:ui-monospace,monospace;font-size:11px}
.skm-skill-preview a{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.skm-skill-preview ul{margin:4px 0;padding-left:18px}
.skm-skill-preview li{margin:2px 0}
.skm-viewer-modal{width:min(960px,calc(100vw - 48px))}
.skm-viewer-body{overflow:hidden;display:flex;flex-direction:column;height:min(640px,calc(100vh - 120px));--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.skm-viewer-body > div:nth-of-type(2){flex:1;min-height:0;display:flex;flex-direction:column;margin-top:8px;padding:0 16px 16px}
.skm-viewer-layout{flex:1;min-height:0;display:flex;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;overflow:hidden}
.skm-viewer-nav{flex:none;width:200px;border-right:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));overflow-y:auto;padding:6px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.skm-viewer-nav-item{display:flex;align-items:center;gap:6px;padding:3px 8px;border-radius:6px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#bbb);font-family:ui-monospace,monospace;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skm-viewer-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-viewer-nav-item[data-active='true']{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.skm-viewer-nav-dir{cursor:default;color:var(--dsw-alias-label-tertiary,#888)}
.skm-viewer-content{flex:1;min-width:0;overflow:auto;padding:14px 18px;box-sizing:border-box;font-size:13px;line-height:22px;color:var(--dsw-alias-label-primary,#eee)}
.skm-viewer-content h1,.skm-viewer-content h2,.skm-viewer-content h3,.skm-viewer-content h4{margin:12px 0 6px;line-height:26px;color:var(--dsw-alias-label-primary,#eee)}
.skm-viewer-content h1{font-size:20px}
.skm-viewer-content h2{font-size:17px}
.skm-viewer-content h3{font-size:15px}
.skm-viewer-content h4{font-size:14px}
.skm-viewer-content p{margin:6px 0}
.skm-viewer-content pre{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border-radius:8px;padding:10px 12px;overflow:auto;font-family:ui-monospace,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb)}
.skm-viewer-content code{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border-radius:4px;padding:0 4px;font-family:ui-monospace,monospace;font-size:12px}
.skm-viewer-content a{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.skm-viewer-content ul,.skm-viewer-content ol{margin:6px 0;padding-left:22px}
.skm-viewer-content li{margin:3px 0}
.skm-viewer-content blockquote{margin:8px 0;padding:2px 12px;border-left:3px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));color:var(--dsw-alias-label-secondary,#bbb)}
.skm-viewer-content hr{border:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));margin:10px 0}
.skm-loose-empty{margin:2px;padding:4px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.skm-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** ---------------------------------------------------------------- 文件收集 */

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

interface CollectedFile { path: string; file: File }

async function collectEntry(entry: FileSystemEntry, prefix: string, out: CollectedFile[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file = await readEntryFile(fileEntry)
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    out.push({ path, file })
    return
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    const all: FileSystemEntry[] = []
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject)
      })
      if (batch.length === 0) break
      all.push(...batch)
    }
    const nextPrefix = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    for (const child of all) await collectEntry(child, nextPrefix, out)
  }
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 32768
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
    }
    return btoa(binary)
  })
}

/** ---------------------------------------------------------------- markdown 预览 */

// 技能内容预览：极简 markdown 渲染（frontmatter 隐藏，标题/列表/代码块/粗体/行内代码/链接）。
function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

function renderSkillMarkdown(text: string): string {
  const body = String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = body.split('\n')
  let html = ''
  let inCode = false
  let codeBuf: string[] = []
  let inList = false
  let inQuote = false
  const closeList = (): void => {
    if (inList) { html += '</ul>'; inList = false }
  }
  const closeQuote = (): void => {
    if (inQuote) { html += '</blockquote>'; inQuote = false }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (inCode) {
        html += '<pre>' + escapeHtml(codeBuf.join('\n')) + '</pre>'
        codeBuf = []
        inCode = false
      } else {
        closeList(); closeQuote()
        inCode = true
      }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    if (trimmed === '---' || trimmed === '***') {
      closeList(); closeQuote()
      html += '<hr>'
      continue
    }
    if (trimmed.startsWith('>')) {
      if (!inQuote) { closeList(); html += '<blockquote>'; inQuote = true }
      html += '<p>' + inlineMd(trimmed.replace(/^>\s?/, '')) + '</p>'
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      closeList(); closeQuote()
      const level = Math.min(heading[1].length + 2, 5)
      html += `<h${String(level)}>` + inlineMd(heading[2]) + `</h${String(level)}>`
      continue
    }
    const item = /^[-*]\s+(.*)$/.exec(trimmed)
    if (item !== null) {
      if (!inList) { closeQuote(); html += '<ul>'; inList = true }
      html += '<li>' + inlineMd(item[1]) + '</li>'
      continue
    }
    closeList(); closeQuote()
    if (trimmed === '') { html += '<p></p>'; continue }
    html += '<p>' + inlineMd(trimmed) + '</p>'
  }
  closeList(); closeQuote()
  if (inCode) html += '<pre>' + escapeHtml(codeBuf.join('\n')) + '</pre>'
  return html
}

/** ---------------------------------------------------------------- 技能行 */

interface ViewRow { kind: 'dir' | 'file'; path: string; depth: number; main: boolean }

function skillFileRows(files: string[]): ViewRow[] {
  const rows: ViewRow[] = []
  const seenDirs = new Set<string>()
  for (const path of files) {
    const parts = path.split('/')
    let dirPath = ''
    for (let i = 0; i < parts.length - 1; i += 1) {
      dirPath = dirPath === '' ? parts[i] : dirPath + '/' + parts[i]
      if (!seenDirs.has(dirPath)) {
        seenDirs.add(dirPath)
        rows.push({ kind: 'dir', path: dirPath + '/', depth: i, main: false })
      }
    }
    rows.push({ kind: 'file', path, depth: parts.length - 1, main: path === 'SKILL.md' })
  }
  return rows
}

/** 技能行：查看按钮 + 名称/描述 + 文件数 + compatibility + （可选）移除/归入按钮；点击查看按钮打开文件查看器。 */
function SkillRowItem({ skill, bundleId, onView, onAssign, onRemove, onDelete }: {
  skill: SkillInfo
  bundleId: string | null
  onView: (skill: SkillInfo) => void
  onAssign?: (skill: SkillInfo) => void
  onRemove?: (skill: SkillInfo) => void
  onDelete?: (skill: SkillInfo) => void
}): JSX.Element {
  const files = Array.isArray(skill.files) ? skill.files : []
  const description = skill.description ?? ''
  const head: ReactNode[] = []
  if (files.length > 0) {
    head.push(
      <button key="view" type="button" className={css.skillExpand}
        aria-label={skillT('viewSkillFiles')} aria-expanded={false} onClick={() => { onView(skill) }}>
        <IconFolderOpenOutline16 size={14} aria-hidden="true" />
      </button>,
    )
  }
  head.push(
    <span key="label" className={css.skillLabel} title={description}>
      <span className={css.skillName}>{skill.name}</span>
      {description !== '' && <span className={css.skillDescription}>{description}</span>}
    </span>,
  )
  if (typeof skill.fileCount === 'number') {
    head.push(<span key="count" className={css.skillCount}>{skillT('fileCount', { n: skill.fileCount })}</span>)
  }
  if ((skill.compatibility ?? '') !== '') {
    head.push(<span key="compat" className={css.skillCompat} title={skill.compatibility}>{skill.compatibility}</span>)
  }
  if (bundleId !== null) {
    head.push(
      <Tooltip key="remove" label={skillT('removeSkill')} side="bottom" delayMs={500}>
        <button type="button" className={css.iconAction} aria-label={skillT('removeSkill')} onClick={() => { onRemove?.(skill) }}>
          <IconTrashOutline16 size={14} />
        </button>
      </Tooltip>,
    )
  } else {
    head.push(
      <Tooltip key="assign" label={skillT('assignToBundle')} side="bottom" delayMs={500}>
        <button type="button" className={css.iconAction} aria-label={skillT('assignToBundle')} onClick={() => { onAssign?.(skill) }}>
          <IconPlusOutline16 size={14} />
        </button>
      </Tooltip>,
    )
  }
  head.push(
    <Tooltip key="delete" label={skillT('deleteSkillBtn')} side="bottom" delayMs={500}>
      <button type="button" className={css.iconAction} aria-label={skillT('deleteSkillBtn')} onClick={() => { onDelete?.(skill) }}>
        <IconTrashOutline16 size={14} />
      </button>
    </Tooltip>,
  )
  return (
    <li className={css.skillItem}>
      <div className={css.skillRow}>{head}</div>
    </li>
  )
}

/** ---------------------------------------------------------------- 面板 */

type ConfirmState = { kind: 'bundle'; bundle: BundleInfo } | { kind: 'skill'; name: string }
type InstallState =
  | { archive: true; name: string; data: string; folderName: string }
  | { archive?: false; files: CollectedFile[]; folderName: string }
type ViewerState = { skill: SkillInfo; file: string; loading: boolean; error?: string; content?: string }

const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export function SkillsPanel({ onClose, closing = false }: { onClose: () => void; closing?: boolean }): JSX.Element {
  ensureStyles()
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [assignTarget, setAssignTarget] = useState<SkillInfo | null>(null)
  const [newBundleOpen, setNewBundleOpen] = useState(false)
  const [newBundleName, setNewBundleName] = useState('')
  const [creatingBundle, setCreatingBundle] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ bundleId: string; name: string } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [install, setInstall] = useState<InstallState | null>(null)
  const [installName, setInstallName] = useState('')
  const [installDescription, setInstallDescription] = useState('')
  const [installBundleId, setInstallBundleId] = useState<string | undefined>(undefined)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = (): void => setReload((value) => value + 1)
  const t = skillT

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void skillApi.list().then(
      (snapshot) => {
        if (current) setState({ status: 'ready', snapshot })
      },
      () => {
        if (current) setState({ status: 'error' })
      },
    )
    return () => { current = false }
    // reload 拆分为变化键；open 恒 true（本组件在打开时才渲染）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  const toggleExpanded = (bundleId: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(bundleId)) next.delete(bundleId)
      else next.add(bundleId)
      return next
    })
  }

  const loadViewerContent = async (skillName: string, filePath: string): Promise<void> => {
    try {
      const res = await fetch(`/api/skill-manager/skills/${encodeURIComponent(skillName)}/files/${encodeURIComponent(filePath)}`)
      const body = await res.json() as { error?: unknown; content?: unknown }
      if (body.error !== undefined) throw new Error(String(body.error))
      setViewer((v) => v === null ? v : { ...v, loading: false, content: (body.content ?? '') as string })
    } catch (error) {
      setViewer((v) => v === null ? v : { ...v, loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const openViewer = (skill: SkillInfo): void => {
    setViewer({ skill, file: 'SKILL.md', loading: true })
    void loadViewerContent(skill.name, 'SKILL.md')
  }

  const selectViewerFile = (filePath: string): void => {
    if (viewer === null) return
    setViewer({ ...viewer, file: filePath, loading: true, error: undefined })
    void loadViewerContent(viewer.skill.name, filePath)
  }

  const doAssign = async (skill: SkillInfo, bundleId: string): Promise<void> => {
    try {
      if (state.status !== 'ready') return
      const bundle = state.snapshot.bundles.find((candidate) => candidate.id === bundleId)
      if (bundle === undefined) throw new Error('bundle not found')
      await skillApi.setBundleSkills(bundleId, [...bundle.skills.map((s) => s.name), skill.name])
      setAssignTarget(null)
      refresh()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    }
  }

  const acceptFiles = (files: File[] | null): void => {
    if (files === null || files.length === 0) return
    const collected: CollectedFile[] = []
    for (const file of files) {
      const relative = file.webkitRelativePath
      if (relative === '') continue
      const parts = relative.split('/')
      if (parts.length < 2) continue
      collected.push({ path: parts.slice(1).join('/'), file })
    }
    if (collected.length === 0) return
    const zipCandidate = collected.length === 1 && collected[0].path.toLowerCase().endsWith('.zip') ? collected[0] : undefined
    if (zipCandidate !== undefined) {
      const reader = new FileReader()
      reader.onload = () => {
        const data = String(reader.result ?? '').split(',')[1] ?? ''
        setInstall({ archive: true, name: zipCandidate.path, data, folderName: zipCandidate.path })
        setInstallError(null)
      }
      reader.readAsDataURL(zipCandidate.file)
      return
    }
    const rootName = collected[0]?.path.split('/')[0] ?? ''
    setInstallName(rootName)
    setInstallError(null)
    setInstall({ files: collected, folderName: rootName })
  }

  const onDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDropActive(false)
    const collected: CollectedFile[] = []
    const items = event.dataTransfer.items
    if (items === undefined) return
    const pending: Array<Promise<void>> = []
    for (const item of Array.from(items)) {
      const entry = item.webkitGetAsEntry?.()
      if (entry !== undefined && entry !== null) pending.push(collectEntry(entry, '', collected))
    }
    await Promise.all(pending)
    if (collected.length === 0) return
    const zipCandidate = collected.length === 1 && collected[0].path.toLowerCase().endsWith('.zip') ? collected[0] : undefined
    if (zipCandidate !== undefined) {
      setInstall({ archive: true, name: zipCandidate.path, data: await fileToBase64(zipCandidate.file), folderName: zipCandidate.path })
      setInstallError(null)
      return
    }
    const rootName = collected[0]?.path.split('/')[0] ?? ''
    setInstallName(rootName)
    setInstallError(null)
    setInstall({ files: collected, folderName: rootName })
  }

  const confirmInstall = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (install === null || installing) return
    if (install.archive !== true && installName.trim() === '') return
    setInstalling(true)
    setInstallError(null)
    try {
      if (install.archive === true) {
        await skillApi.installSkill({
          archive: install.data,
          description: installDescription.trim(),
          ...installBundleId === undefined ? {} : { bundleId: installBundleId },
        })
      } else {
        const files = await Promise.all(install.files.map(async ({ path, file }) => ({
          path,
          data: await fileToBase64(file),
        })))
        await skillApi.installSkill({
          skillName: installName.trim(),
          description: installDescription.trim(),
          ...installBundleId === undefined ? {} : { bundleId: installBundleId },
          files,
        })
      }
      setInstall(null)
      setInstallName('')
      setInstallDescription('')
      setInstallBundleId(undefined)
      refresh()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setInstalling(false)
    }
  }

  const submitNewBundle = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (creatingBundle || newBundleName.trim() === '') return
    setCreatingBundle(true)
    try {
      await skillApi.createBundle(newBundleName.trim())
      setNewBundleName('')
      setNewBundleOpen(false)
      refresh()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreatingBundle(false)
    }
  }

  const submitRename = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (renaming || renameTarget === null || renameTarget.name.trim() === '') return
    setRenaming(true)
    try {
      await skillApi.renameBundle(renameTarget.bundleId, renameTarget.name.trim())
      setRenameTarget(null)
      refresh()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setRenaming(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (confirm === null || confirming) return
    setConfirming(true)
    try {
      if (confirm.kind === 'bundle') await skillApi.deleteBundle(confirm.bundle.id)
      else await skillApi.deleteSkill(confirm.name)
      setConfirm(null)
      refresh()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setConfirming(false)
    }
  }

  const removeFromBundle = async (bundleId: string, name: string): Promise<void> => {
    try {
      if (state.status !== 'ready') return
      const bundle = state.snapshot.bundles.find((candidate) => candidate.id === bundleId)
      if (bundle === undefined) return
      await skillApi.setBundleSkills(bundleId, bundle.skills.map((skill) => skill.name).filter((skillName) => skillName !== name))
      refresh()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    }
  }

  const bundles = state.status === 'ready' ? state.snapshot.bundles : []
  const loose = state.status === 'ready' ? state.snapshot.loose : []
  const trimmedName = installName.trim()
  const nameInvalid = trimmedName !== '' && !SKILL_NAME_PATTERN.test(trimmedName)

  const confirmTitle = confirm === null
    ? t('deleteSkillConfirm', { name: '' })
    : confirm.kind === 'bundle'
      ? t('deleteBundleConfirm', { name: confirm.bundle.name })
      : t('deleteSkillConfirm', { name: confirm.name })

  return (
    <Modal
      open
      onClose={() => {
        if (installing || confirming) return
        onClose()
      }}
      closeLabel={t('close')}
      title={t('panelTitle')}
      className={`${css.modal} ${modalAnimClass(closing)}`}
      contentClassName={css.modalBody}
    >
      <div className={css.panel} aria-busy={state.status === 'loading'}>
        <div className={css.topRow}>
          <Tooltip label={t('newBundle')} side="bottom" delayMs={500}>
            <button type="button" className={css.newBundleButton} aria-label={t('newBundle')} aria-expanded={newBundleOpen}
              onClick={() => { setNewBundleOpen((value) => !value) }}>
              <IconPlusOutline16 size={14} />
              {t('newBundle')}
            </button>
          </Tooltip>
        </div>

        {newBundleOpen && (
          <form className={css.inlineForm} onSubmit={(event) => { void submitNewBundle(event) }}>
            <input className={css.inlineInput} value={newBundleName} placeholder={t('newBundlePlaceholder')}
              aria-label={t('newBundlePlaceholder')} autoFocus disabled={creatingBundle}
              onChange={(event) => { setNewBundleName(event.currentTarget.value) }} />
            <Button variant="primary" type="submit" disabled={creatingBundle || newBundleName.trim() === ''}>{t('create')}</Button>
            <Button variant="outline" type="button" disabled={creatingBundle} onClick={() => { setNewBundleOpen(false) }}>{t('cancel')}</Button>
          </form>
        )}

        <div
          className={`${css.upload} ${dropActive ? css.uploadActive : ''}`}
          onClick={() => { fileInput.current?.click() }}
          onDragOver={(event) => { event.preventDefault(); setDropActive(true) }}
          onDragLeave={() => { setDropActive(false) }}
          onDrop={(event) => { void onDrop(event) }}
          role="button"
          tabIndex={0}
          aria-label={t('uploadHint')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              fileInput.current?.click()
            }
          }}
        >
          <IconFolderOpenOutline16 size={16} aria-hidden="true" />
          <span>{t('uploadHint')}</span>
          <input
            ref={fileInput}
            type="file"
            className={css.hiddenInput}
            multiple
            {...{ webkitdirectory: '' }}
            onChange={(event) => {
              acceptFiles(event.currentTarget.files === null ? null : Array.from(event.currentTarget.files))
            }}
          />
        </div>

        {install !== null && (
          <form className={css.installForm} onSubmit={(event) => { void confirmInstall(event) }}>
            <div className={css.installRow}>
              <input className={css.inlineInput} value={installName}
                placeholder={install.archive === true ? t('installNameFromArchive') : t('installNamePlaceholder')}
                aria-label={t('installName')}
                disabled={installing || install.archive === true}
                onChange={(event) => { setInstallName(event.currentTarget.value) }} />
              <input className={css.inlineInput} value={installDescription} placeholder={t('installDescription')}
                aria-label={t('installDescription')} disabled={installing}
                onChange={(event) => { setInstallDescription(event.currentTarget.value) }} />
              <label className={css.bundleSelect}>
                <span className={css.visuallyHidden}>{t('installBundle')}</span>
                <select value={installBundleId ?? ''} disabled={installing}
                  onChange={(event) => { setInstallBundleId(event.currentTarget.value === '' ? undefined : event.currentTarget.value) }}>
                  <option value="">{t('installLoose')}</option>
                  {bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}
                </select>
              </label>
              <span className={css.installMeta}>
                {install.archive === true
                  ? t('uploadMeta', { n: 1, folder: install.folderName })
                  : t('uploadMeta', { n: install.files.length, folder: install.folderName })}
              </span>
            </div>
            {install.archive !== true && nameInvalid && <p className={css.error} role="alert">{t('installNameInvalid')}</p>}
            <div className={css.installActions}>
              <Button variant="primary" type="submit" disabled={installing || (install.archive !== true && (trimmedName === '' || nameInvalid))}>{t('installConfirm')}</Button>
              <Button variant="outline" type="button" disabled={installing} onClick={() => { setInstall(null) }}>{t('installCancel')}</Button>
            </div>
            {installError !== null && <p className={css.error} role="alert">{installError}</p>}
          </form>
        )}

        {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
        {state.status === 'error' ? (
          <div className={css.failure}>
            <p role="alert">{t('error')}</p>
            <Button variant="outline" onClick={refresh}><IconRefreshOutline14 /> {t('retry')}</Button>
          </div>
        ) : null}

        {state.status === 'ready' && (
          <>
            <h3 className={css.sectionTitle}>{t('bundlesTitle')}</h3>
            {bundles.length === 0 ? (
              <p className={css.status}>{t('bundlesEmpty')}</p>
            ) : (
              <ul className={css.bundleList}>
                {bundles.map((bundle) => {
                  const open2 = expanded.has(bundle.id)
                  const renamingThis = renameTarget?.bundleId === bundle.id
                  return (
                    <li key={bundle.id} className={css.bundle} data-open={open2 ? 'true' : undefined}>
                      {renamingThis ? (
                        <form className={css.inlineForm} onSubmit={(event) => { void submitRename(event) }}>
                          <input className={css.inlineInput} value={renameTarget.name} placeholder={t('renameBundlePlaceholder')}
                            aria-label={t('renameBundlePlaceholder')} autoFocus disabled={renaming}
                            onChange={(event) => {
                              setRenameTarget((current) => current === null ? current : { ...current, name: event.currentTarget.value })
                            }} />
                          <Button variant="primary" type="submit" disabled={renaming || renameTarget.name.trim() === ''}>{t('rename')}</Button>
                          <Button variant="outline" type="button" disabled={renaming} onClick={() => { setRenameTarget(null) }}>{t('cancel')}</Button>
                        </form>
                      ) : (
                        <>
                          <button type="button" className={css.bundleRow} aria-expanded={open2} onClick={() => { toggleExpanded(bundle.id) }}>
                            <span className={css.bundleName}>{bundle.name}</span>
                            <span className={css.bundleCount}>{t('skillsCount', { n: bundle.skillCount })}</span>
                            <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                          </button>
                          <div className={css.bundleActions}>
                            <Tooltip label={t('rename')} side="bottom" delayMs={500}>
                              <button type="button" className={css.iconAction} aria-label={t('rename')}
                                onClick={() => { setRenameTarget({ bundleId: bundle.id, name: bundle.name }) }}>
                                <IconEditOutline16 size={14} />
                              </button>
                            </Tooltip>
                            <Tooltip label={t('delete')} side="bottom" delayMs={500}>
                              <button type="button" className={css.iconAction} aria-label={t('delete')}
                                onClick={() => { setConfirm({ kind: 'bundle', bundle }) }}>
                                <IconTrashOutline16 size={14} />
                              </button>
                            </Tooltip>
                          </div>
                        </>
                      )}
                      {open2 && (
                        <ul className={css.skillList}>
                          {bundle.skills.length === 0 ? (
                            <li className={css.status}>{t('bundleNoSkills')}</li>
                          ) : bundle.skills.map((skill) => (
                            <SkillRowItem key={skill.name} skill={skill} bundleId={bundle.id}
                              onView={openViewer}
                              onRemove={(s) => { void removeFromBundle(bundle.id, s.name) }}
                              onDelete={(s) => { setConfirm({ kind: 'skill', name: s.name }) }} />
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            <h3 className={css.sectionTitle}>{t('looseTitle')}</h3>
            {loose.length === 0 ? (
              <p className={css.looseEmpty}>{t('looseEmpty')}</p>
            ) : (
              <ul className={css.skillList}>
                {loose.map((skill) => (
                  <SkillRowItem key={skill.name} skill={skill} bundleId={null}
                    onView={openViewer}
                    onAssign={(s) => { setAssignTarget(s) }}
                    onDelete={(s) => { setConfirm({ kind: 'skill', name: s.name }) }} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => {
          if (!confirming) setConfirm(null)
        }}
        closeLabel={t('close')}
        title={confirmTitle}
        footer={
          <>
            <Button variant="outline" disabled={confirming} onClick={() => { setConfirm(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={confirming} onClick={() => { void confirmDelete() }}>{t('delete')}</Button>
          </>
        }
      />

      {viewer !== null && (
        <Modal
          open
          onClose={() => { setViewer(null) }}
          closeLabel={t('close')}
          title={viewer.skill.name + (viewer.file === 'SKILL.md' ? '' : ' · ' + viewer.file)}
          className={css.viewerModal}
          contentClassName={css.viewerBody}
        >
          <div className={css.viewerLayout}>
            <nav className={css.viewerNav} aria-label={t('viewerNav')}>
              {skillFileRows(Array.isArray(viewer.skill.files) ? viewer.skill.files : []).map((row, index) => (
                <div
                  key={row.path + '-' + String(index)}
                  className={css.viewerNavItem + (row.kind === 'dir' ? ' ' + css.viewerNavDir : '')}
                  data-active={row.kind === 'file' && row.path === viewer.file ? 'true' : undefined}
                  data-dir={row.kind === 'dir' ? 'true' : undefined}
                  style={{ paddingLeft: 8 + row.depth * 14 }}
                  title={row.path}
                  onClick={row.kind === 'file' ? () => { selectViewerFile(row.path) } : undefined}
                >
                  {row.kind === 'dir' ? '📁 ' : '📄 '}
                  {row.path}
                </div>
              ))}
            </nav>
            <div className={css.viewerContent}>
              {viewer.loading === true
                ? t('previewLoading')
                : viewer.error !== undefined
                  ? viewer.error
                  : <div dangerouslySetInnerHTML={{ __html: renderSkillMarkdown(viewer.content ?? '') }} />}
            </div>
          </div>
        </Modal>
      )}

      {assignTarget !== null && (
        <Modal
          open
          onClose={() => { setAssignTarget(null) }}
          closeLabel={t('close')}
          title={t('assignTitle', { name: assignTarget.name })}
          className={css.viewerModal}
          contentClassName={css.viewerBody}
        >
          <div className={css.skillList}>
            {bundles.length === 0 ? (
              <p className={css.looseEmpty}>{t('assignEmpty')}</p>
            ) : bundles.map((bundle) => (
              <div
                key={bundle.id}
                className={css.skillRow}
                style={{ cursor: 'pointer' }}
                onClick={() => { void doAssign(assignTarget, bundle.id) }}
              >
                <span className={css.skillLabel}>
                  <span className={css.skillName}>{bundle.name}</span>
                  <span className={css.skillDescription}>{t('skillsCount', { n: bundle.skillCount })}</span>
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </Modal>
  )
}
