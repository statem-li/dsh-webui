/**
 * 工作区目录选择器自写弹窗：填充 ui-workspace 的两个 directory-flow 插槽
 * （conversation.hero.workspace.directoryFlow / sidebar.workspaces.directoryFlow）。
 *
 * 交互（对齐官方 Select Workspace Directory 弹窗语义，但为自写实现）：
 * - 面包屑导航（Home 起根，尾 crumb 高亮当前层），铅笔按钮进入路径编辑，
 *   输入绝对路径回车跳转；Escape / 焦点离开取消编辑。
 * - 目录行列表（仅可进入的子目录），点击行进下一层；hidden 行默认隐藏，
 *   footer 的「显示隐藏文件」开关（client-side）可揭示。
 * - 「新建文件夹」开嵌套弹窗：在当前层创建单段子目录，创建后落点该层并
 *   选中新目录。
 * - footer：新建文件夹 / 显示隐藏 / 取消 / 打开。打开提交当前浏览层
 *   （listing.path）；owner 置 busy 期间禁用提交。
 * - 失败（列表不可读、创建冲突）显示在弹窗内 alert 区域，不驱动 owner 的
 *   onError 错误面（与官方 browse 占用者一致）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconEditOutline16, IconFolderClose16, IconPlusOutline16, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { DirListing } from './api.ts'
import { createDirectory, listDirectory, listDrives } from './api.ts'
import { css } from './styles.ts'

/** 注入面：目录浏览 wire 调用（apply 闭包绑定，数据走 /api/webui-dir-picker）。 */
export interface DirPickerInjected {
  listDirectory: (path?: string) => Promise<DirListing>
  createDirectory: (path: string, name: string) => Promise<string>
}

/** 失败文本：DirApiError 的 message 已携带可读信息。 */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 列表层级行的可见性过滤：hidden 行仅在开关开启时显示。 */
function visibleEntries(listing: DirListing, showHidden: boolean) {
  return showHidden ? listing.entries : listing.entries.filter(entry => !entry.hidden)
}

/** 从绝对路径提取盘符/根（Windows `C:\`；POSIX `/`）；无法识别返回原路径。 */
function rootOf(path: string): string {
  const win = path.match(/^[A-Za-z]:\\/)
  if (win !== null) return win[0]
  return path.startsWith('/') ? '/' : path
}

/**
 * 渲染目录选择弹窗。
 * @param props - owner 会话（open/busy/onPicked/onCancel）+ 注入的浏览调用。
 * @returns 弹窗元素（关闭时通过 Modal 返回 null）。
 */
export function WorkspaceDirPickerFlow({ open, busy, onPicked, onCancel, listDirectory: list, createDirectory: create }: DirectoryFlowOwnerProps & DirPickerInjected) {
  // 注入函数固定到 ref：宿主渲染可能每次传入新函数，但导航/创建的
  // useCallback 依赖必须稳定（否则 open effect 每次渲染重跑）。
  const listRef = useRef(list)
  listRef.current = list
  const createRef = useRef(create)
  createRef.current = create
  // 当前浏览层（breadcrumb 尾）；null = 尚未加载（首次打开 / 关闭）。
  const [listing, setListing] = useState<DirListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 路径编辑状态：null = 面包屑模式；字符串 = 正在输入的草稿。
  const [pathDraft, setPathDraft] = useState<string | null>(null)
  // 显示隐藏文件开关（纯 client-side 过滤，每次打开重置）。
  const [showHidden, setShowHidden] = useState(false)
  // 新建文件夹嵌套弹窗状态：null = 关闭；字符串 = 名称草稿。
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // 盘符/根切换：drives 加载结果 + 下拉展开态。
  const [drives, setDrives] = useState<Array<{ name: string; path: string }> | null>(null)
  const [drivesOpen, setDrivesOpen] = useState(false)
  // 过期响应护栏：新请求递增 seq，旧结算不落地（卸载 / 重新打开同理）。
  const requestSeq = useRef(0)
  // IME 确认（Enter 选候选）不得提交输入。
  const composingRef = useRef(false)
  const compositionGuard = {
    onCompositionStart: () => { composingRef.current = true },
    onCompositionEnd: () => { composingRef.current = false },
  }

  /** 跳转一个层级；新意图使旧结算失效。 */
  const navigate = useCallback((path?: string) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    listRef.current(path).then((next) => {
      if (seq !== requestSeq.current) return
      setListing(next)
      setLoading(false)
    }, (reason: unknown) => {
      if (seq !== requestSeq.current) return
      setLoading(false)
      setError(failureText(reason))
    })
  }, [])

  // 每次打开从宿主 home 目录开始；关闭使在途结算失效并复位状态。
  useEffect(() => {
    requestSeq.current += 1
    if (open) {
      setListing(null)
      setError(null)
      setPathDraft(null)
      setShowHidden(false)
      setFolderDraft(null)
      setCreateError(null)
      setDrivesOpen(false)
      navigate()
      return
    }
    setLoading(false)
    setError(null)
    setPathDraft(null)
    setFolderDraft(null)
    setCreateError(null)
    setDrivesOpen(false)
  }, [open, navigate])

  // 卸载（HMR 替换占用者）时作废在途结算。
  useEffect(() => () => { requestSeq.current += 1 }, [])

  // 盘符列表独立加载：每次打开拉取一次，alive 护栏防止关闭后落地。
  useEffect(() => {
    if (!open) return
    let alive = true
    listDrives().then((next) => {
      if (alive) setDrives(next)
    }, () => {
      // 盘符枚举失败不阻塞浏览：入口退化为不可用。
    })
    return () => { alive = false }
  }, [open])

  if (!open) return null

  const crumbs = listing === null ? [] : listing.crumbs
  const targetName = listing === null
    ? ''
    : (crumbs.at(-1)?.name ?? listing.path)

  /** 新建文件夹确认：非空白单段名 → create → 落点该层并选中新目录。 */
  const confirmCreate = (): void => {
    if (listing === null || folderDraft === null || creatingFolder) return
    const name = folderDraft
    if (name.trim() === '') return
    setCreatingFolder(true)
    setCreateError(null)
    const seq = requestSeq.current
    createRef.current(listing.path, name).then((createdPath) => {
      if (seq !== requestSeq.current) return
      setCreatingFolder(false)
      setFolderDraft(null)
      // 落点该层并选中新目录：重新列当前层。
      const nextSeq = ++requestSeq.current
      setLoading(true)
      listRef.current(listing.path).then((next) => {
        if (nextSeq !== requestSeq.current) return
        setListing(next)
        setLoading(false)
      }, (reason: unknown) => {
        if (nextSeq !== requestSeq.current) return
        setLoading(false)
        setError(failureText(reason))
      })
      // 选中新目录（视觉反馈；打开提交的目标仍是当前层）。
      const row = document.querySelector<HTMLButtonElement>(`.${css.row}[data-path="${CSS.escape(createdPath)}"]`)
      row?.focus()
    }, (reason: unknown) => {
      if (seq !== requestSeq.current) return
      setCreatingFolder(false)
      setCreateError(failureText(reason))
    })
  }

  const editing = pathDraft !== null
  const parentInert = busy || folderDraft !== null
  const currentPath = listing?.path ?? null

  return (
    <Modal
      open={open}
      onClose={() => { if (folderDraft === null && !busy) onCancel() }}
      title="选择工作区目录"
      className={css.dialog}
      headless
    >
      <div
        className={css.scope}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          if (pathDraft !== null) {
            event.stopPropagation()
            setPathDraft(null)
            return
          }
          if (drivesOpen) {
            event.stopPropagation()
            setDrivesOpen(false)
          }
        }}
      >
        <div className={css.header}>
          <h2 className={css.title}>选择工作区目录</h2>
          <div className={css.crumbBar}>
            {!editing ? (
              <>
                {/* 盘符/根切换（Windows 盘符入口） */}
                <div className={css.drivesSeat}>
                  {drivesOpen && <div className={css.drivesDismiss} onClick={() => { setDrivesOpen(false) }} />}
                  <button
                    type="button"
                    className={css.drivesBtn}
                    aria-expanded={drivesOpen}
                    aria-haspopup="listbox"
                    disabled={parentInert || drives === null}
                    onClick={() => { setDrivesOpen(prev => !prev) }}
                  >
                    <IconFolderClose16 size={14} className={css.drivesIcon} />
                    <span className={css.drivesLabel}>{listing === null ? '…' : rootOf(listing.path)}</span>
                    <IconChevronRightOutline14 size={10} className={css.drivesChevron} />
                  </button>
                  {drivesOpen && (
                    <div className={css.drivesMenu} role="listbox">
                      {drives!.map(drive => (
                        <button
                          key={drive.path}
                          type="button"
                          role="option"
                          aria-selected={listing !== null && rootOf(listing.path) === drive.path}
                          className={css.drivesItem}
                          onClick={() => {
                            setDrivesOpen(false)
                            navigate(drive.path)
                          }}
                        >
                          <IconFolderClose16 size={14} className={css.drivesIcon} />
                          <span className={css.drivesLabel}>{drive.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className={css.crumbTrail} role="navigation">
                  {crumbs.map((crumb, index) => (
                    <span key={crumb.path} className={css.crumbSeat}>
                      {index > 0 && <IconChevronRightOutline14 size={12} className={css.crumbChevron} />}
                      <button
                        type="button"
                        className={css.crumb}
                        aria-current={index === crumbs.length - 1 || undefined}
                        disabled={parentInert}
                        onClick={() => { navigate(crumb.path) }}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </span>
                <button
                  type="button"
                  className={css.crumbEdit}
                  aria-label="编辑路径"
                  title="编辑路径"
                  disabled={parentInert}
                  onClick={() => {
                    // 打开编辑器：以当前层路径 + 尾分隔符为草稿起点。
                    const base = listing?.path ?? ''
                    const sep = base.includes('\\') ? '\\' : '/'
                    setPathDraft(base.endsWith(sep) ? base : `${base}${sep}`)
                  }}
                >
                  <IconEditOutline16 size={14} />
                </button>
              </>
            ) : (
              <input
                className={css.pathInput}
                value={pathDraft}
                aria-label="编辑路径"
                autoFocus
                disabled={parentInert}
                onChange={(event) => { setPathDraft(event.target.value) }}
                {...compositionGuard}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !composingRef.current) {
                    event.preventDefault()
                    if (pathDraft.trim() !== '') {
                      setPathDraft(null)
                      navigate(pathDraft)
                    }
                  }
                }}
              />
            )}
          </div>
        </div>

        <div className={css.list}>
          {listing === null ? (
            <div className={css.status} role="status">加载中…</div>
          ) : visibleEntries(listing, showHidden).length === 0 ? (
            <div className={css.status}>此目录下没有可进入的子目录</div>
          ) : visibleEntries(listing, showHidden).map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={css.row}
              data-path={entry.path}
              disabled={parentInert}
              onClick={() => { navigate(entry.path) }}
            >
              <IconFolderClose16 size={16} className={css.rowIcon} />
              <span className={css.rowName}>{entry.name}</span>
            </button>
          ))}
          {loading && <div className={css.status} role="status">加载中…</div>}
          {listing?.truncated === true && <div className={css.status}>文件夹过多，仅显示开头部分。</div>}
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </div>

        <div className={css.footer}>
          <Button
            variant="outline"
            size="sm"
            icon={<IconPlusOutline16 size={14} />}
            disabled={listing === null || loading || parentInert}
            onClick={() => { setFolderDraft(''); setCreateError(null) }}
          >
            新建文件夹
          </Button>
          <button
            type="button"
            className={clsx(css.hiddenToggle, showHidden && css.hiddenToggleActive)}
            aria-pressed={showHidden}
            disabled={parentInert}
            onClick={() => { setShowHidden(prev => !prev) }}
          >
            显示隐藏文件
            {showHidden && <IconCheckOutline16 size={14} />}
          </button>
          <span className={css.footerGap} />
          <Button variant="outline" size="sm" disabled={parentInert} onClick={onCancel}>取消</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={currentPath === null || loading || parentInert}
            onClick={() => { if (currentPath !== null) onPicked(currentPath) }}
          >
            {busy ? '打开中…' : '打开'}
          </Button>
        </div>
      </div>

      {/* 新建文件夹嵌套弹窗 */}
      <Modal
        open={folderDraft !== null}
        onClose={() => { if (!creatingFolder) setFolderDraft(null) }}
        title="新建文件夹"
        className={css.createDialog}
        headless
      >
        <div className={css.createBody}>
          <h3 className={css.createTitle}>新建文件夹</h3>
          <p className={css.createIn}>在“{targetName}”中新建文件夹</p>
          <input
            className={css.createInput}
            value={folderDraft ?? ''}
            aria-label="文件夹名称"
            placeholder="未命名文件夹"
            autoFocus
            disabled={creatingFolder}
            onChange={(event) => { setFolderDraft(event.target.value) }}
            {...compositionGuard}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !composingRef.current) {
                event.preventDefault()
                confirmCreate()
              }
              if (event.key === 'Escape') {
                event.stopPropagation()
                if (!creatingFolder) setFolderDraft(null)
              }
            }}
          />
          {createError !== null && <div className={css.error} role="alert">{createError}</div>}
          <div className={css.createActions}>
            <Button variant="outline" size="sm" disabled={creatingFolder} onClick={() => { setFolderDraft(null) }}>取消</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={creatingFolder || (folderDraft ?? '').trim() === ''}
              onClick={confirmCreate}
            >
              {creatingFolder ? '创建中…' : '创建'}
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  )
}
