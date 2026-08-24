/**
 * dsh-file-explorer — 文件打开弹窗主体：内容为主、历史为辅。
 *
 * 左侧时间线：
 *   顶部恒置「当前内容」条目（绿点 = 磁盘上的活文件），下方列出此文件在
 *   各次发消息前自动快照中的内容变化点。
 * 右栏两种视图（由父级 histView 状态驱动）：
 *   - contentMode：当前文件内容，CodeMirror 由父级经 editorHostRef 挂载，
 *     可直接编辑保存——打开文件第一眼看到的就是它；
 *   - 对比视图：点选时间线时点后进入，左右分栏 diff（左=时点快照，
 *     右=当前磁盘）。头部/时间线的「+N（蓝）/−N（红）」是可点击色块：
 *     循环跳到下一处新增/删除并闪烁定位；对比发现与当前完全相同时
 *     自动切回内容视图（内容本来就一致，无需停留）。
 * 数据来自 host /api/webui-rewind/history 与 /compare（对话退回快照体系）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  fetchFileCompare, fetchFileHistory,
  type CompareRow, type FileCompareResult, type FileHistoryPoint,
} from './api.ts'
import type { FileExplorerLocaleKey } from './locales.ts'
import { css } from './styles.ts'

type T = (key: FileExplorerLocaleKey) => string

export interface FileHistoryViewProps {
  /** 当前会话 id；快照按会话存放，缺失时无法定位历史。 */
  sessionId?: string
  /** 文件路径（绝对路径；host 内部换算为快照相对 key）。 */
  path: string
  t: T
  /** 右栏视图：true=当前内容（编辑器宿主）；false=选中时点的对比 diff。 */
  contentMode?: boolean
  /** 内容视图的编辑器宿主 div ref（父级在其上挂 CodeMirror）。 */
  editorHostRef?: RefObject<HTMLDivElement>
  /** 递增值：父级保存文件成功后触发，让当前对比按新磁盘内容重算。 */
  reloadToken?: number
  /** 点击时间线时点：请求父级切到对比视图。 */
  onRequestCompare?: () => void
  /** 请求回到内容视图（点「当前内容」条目 / 对比发现与当前完全相同）。 */
  onRequestContent?: () => void
}

type HistoryState = 'loading' | 'error' | 'empty' | 'ready' | 'no-session'

/** 时间线最多渲染的点数（更早的折叠成计数）。 */
const MAX_TIMELINE_ITEMS = 60
/** 最多渲染的对齐行数（防止超大 diff 卡死 DOM）。 */
const MAX_RENDER_ROWS = 4000

/** 跳转闪烁高亮时长（ms），与 styles 中 fe-flash-* 动画时长一致。 */
const FLASH_MS = 1000

/** 时间线时点时间：今天只看时分；今年 MM-DD；跨年带两位年。 */
function formatPointTime(ts: number): string {
  if (!(ts > 0)) return ''
  const d = new Date(ts)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const year = d.getFullYear() === now.getFullYear() ? '' : `${String(d.getFullYear()).slice(2)}-`
  return `${year}${mo}-${day} ${hh}:${mm}`
}

function formatPointSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

/** row.kind → 底色类（ctx/add/del/mod）。 */
const ROW_KIND_CLASS: Record<CompareRow['kind'], string> = {
  ctx: css.histRowCtx,
  add: css.histRowAdd,
  del: css.histRowDel,
  mod: css.histRowMod,
}

/** 一处可跳转的修改：所在渲染行下标 + 当前文件中的近似行号（0=文档开头）。 */
interface JumpTarget { rowIndex: number; line: number }

/**
 * 从对齐行构建增/删两条跳转序列：
 *   add = 右侧有内容的 add/mod 行（line 取右侧行号）
 *   del = 左侧有内容的 del/mod 行（line 取此前最近右侧行号——删除发生在它之前）
 */
function buildJumpIndex(rows: CompareRow[]): { add: JumpTarget[]; del: JumpTarget[] } {
  const add: JumpTarget[] = []
  const del: JumpTarget[] = []
  let lastRight = 0
  rows.forEach((row, rowIndex) => {
    if (row.r !== undefined) lastRight = row.r.no
    if ((row.kind === 'add' || row.kind === 'mod') && row.r !== undefined) {
      add.push({ rowIndex, line: row.r.no })
    }
    if ((row.kind === 'del' || row.kind === 'mod') && row.l !== undefined) {
      del.push({ rowIndex, line: lastRight })
    }
  })
  return { add, del }
}

/** 每个渲染行上的 data-jump 序号标记（add/del 各自序列内的位次）。 */
function buildRowMarks(index: { add: JumpTarget[]; del: JumpTarget[] }): Map<number, { add?: number; del?: number }> {
  const marks = new Map<number, { add?: number; del?: number }>()
  index.add.forEach((target, i) => {
    const mark = marks.get(target.rowIndex) ?? {}
    mark.add = i
    marks.set(target.rowIndex, mark)
  })
  index.del.forEach((target, i) => {
    const mark = marks.get(target.rowIndex) ?? {}
    mark.del = i
    marks.set(target.rowIndex, mark)
  })
  return marks
}

/** 一条对齐行：左右两个半格；缺行的一侧留出空格子保持栅格对齐。 */
function HistRow({ row, jump, flashKind }: { row: CompareRow; jump?: { add?: number; del?: number }; flashKind?: 'add' | 'del' }): JSX.Element {
  return (
    <div
      className={`${css.histRow} ${ROW_KIND_CLASS[row.kind]}`}
      data-flash={flashKind}
      {...(jump?.add !== undefined ? { 'data-jump-add': jump.add } : {})}
      {...(jump?.del !== undefined ? { 'data-jump-del': jump.del } : {})}
    >
      <div className={css.histCell}>
        {row.l !== undefined && (
          <>
            <span className={css.histNo}>{row.l.no}</span>
            <span className={css.histText}>{row.l.text}</span>
          </>
        )}
      </div>
      <div className={css.histCell}>
        {row.r !== undefined && (
          <>
            <span className={css.histNo}>{row.r.no}</span>
            <span className={css.histText}>{row.r.text}</span>
          </>
        )}
      </div>
    </div>
  )
}

export function FileHistoryView({ sessionId, path, t, contentMode = false, editorHostRef, reloadToken = 0, onRequestCompare, onRequestContent }: FileHistoryViewProps): JSX.Element {
  const [state, setState] = useState<HistoryState>('loading')
  const [points, setPoints] = useState<FileHistoryPoint[]>([])
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [compare, setCompare] = useState<FileCompareResult | null>(null)
  const [comparing, setComparing] = useState(false)
  // 色块跳转：add/del 各自的循环游标与当前闪烁命中的行。
  const jumpCursor = useRef({ add: -1, del: -1 })
  const [flash, setFlash] = useState<{ rowIndex: number; kind: 'add' | 'del' } | null>(null)
  const flashTimer = useRef<number | null>(null)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  // 父级回调经 ref 中转：load effect 的 deps 不含它们，父级每次渲染的新 lambda 不会触发重新拉取。
  const requestContentRef = useRef(onRequestContent)
  useEffect(() => { requestContentRef.current = onRequestContent })

  // 加载该文件的修改历史点；文件或会话变化时重置选择。
  useEffect(() => {
    setSelectedSeq(null)
    setCompare(null)
    setPoints([])
    if (sessionId === undefined || sessionId === '') {
      setState('no-session')
      return
    }
    let current = true
    setState('loading')
    void fetchFileHistory(sessionId, path).then(
      (result) => {
        if (!current) return
        if (result.ok !== true || result.points === undefined) {
          setState('error')
          return
        }
        if (result.points.length === 0) {
          setState('empty')
          return
        }
        setPoints(result.points)
        // 默认选中最近一次变化；右栏仍停留在内容视图，点时点才切对比。
        setSelectedSeq(result.points[result.points.length - 1]?.seq ?? null)
        setState('ready')
      },
      () => { if (current) setState('error') },
    )
    return () => { current = false }
  }, [sessionId, path])

  // 选中时点变化 → 拉取双栏对齐对比（左=该时点，右=当前磁盘）。
  useEffect(() => {
    if (state !== 'ready' || selectedSeq === null || sessionId === undefined || sessionId === '') return
    let current = true
    setComparing(true)
    setCompare(null)
    void fetchFileCompare(sessionId, selectedSeq, path).then(
      (result) => {
        if (!current) return
        setCompare(result)
        setComparing(false)
        // 该时点与当前完全相同：没有可比的差异，请父级切回内容视图。
        if (result.ok === true && result.status === 'same') requestContentRef.current?.()
      },
      () => {
        if (!current) return
        setCompare({ ok: false, error: 'request failed' })
        setComparing(false)
      },
    )
    return () => { current = false }
  }, [state, selectedSeq, path, sessionId, reloadToken])

  const rows = compare?.ok === true ? compare.rows ?? [] : []
  const shownRows = rows.slice(0, MAX_RENDER_ROWS)
  const hiddenRowCount = rows.length - shownRows.length
  const stats = compare?.stats

  // 对比内容变化：重置跳转游标与闪烁（旧坐标不再有效）。
  useEffect(() => {
    jumpCursor.current = { add: -1, del: -1 }
    setFlash(null)
  }, [compare])

  // 卸载时清掉闪烁计时器。
  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
  }, [])

  const jumpIndex = useMemo(() => buildJumpIndex(rows), [rows])
  const rowMarks = useMemo(() => buildRowMarks(jumpIndex), [jumpIndex])

  /** 点击增/删色块：循环选中下一处对应修改并定位闪烁。 */
  const jumpTo = (kind: 'add' | 'del'): void => {
    const targets = jumpIndex[kind]
    if (targets.length === 0) return
    const next = (jumpCursor.current[kind] + 1) % targets.length
    jumpCursor.current[kind] = next
    const target = targets[next]
    const root = scrollRootRef.current
    const el = root?.querySelector(`[data-jump-${kind}="${next}"]`)
    if (el !== null && el !== undefined) {
      el.scrollIntoView({ block: 'center' })
      setFlash({ rowIndex: target.rowIndex, kind })
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => { setFlash(null) }, FLASH_MS)
    }
  }

  /** 统计色块（头部大块 / 时间线小块共用）；无差异或对比中不显示。 */
  const chipButtons = (size: 'head' | 'mini'): JSX.Element | null => {
    if (stats === undefined || comparing || contentMode) return null
    const addCls = size === 'head' ? css.histStatAdd : css.histTlChipAdd
    const delCls = size === 'head' ? css.histStatDel : css.histTlChipDel
    const showAdd = stats.added > 0
    const showDel = stats.removed > 0
    if (!showAdd && !showDel) return null
    return (
      <>
        {showAdd && (
          <button type="button" className={addCls} title={t('jumpAddTip')} onClick={() => { jumpTo('add') }}>
            +{stats.added}
          </button>
        )}
        {showDel && (
          <button type="button" className={delCls} title={t('jumpDelTip')} onClick={() => { jumpTo('del') }}>
            −{stats.removed}
          </button>
        )}
      </>
    )
  }

  /** 内容视图的编辑器宿主（CodeMirror 由父级经 editorHostRef 挂载）。 */
  const editorHost = contentMode && editorHostRef !== undefined ? (
    <div className={css.histEditor} ref={editorHostRef} />
  ) : null

  // 时间线倒序（最新在上）；超出上限的更早点折叠成计数。
  const timeline = useMemo(() => [...points].reverse(), [points])
  const shownTimeline = timeline.slice(0, MAX_TIMELINE_ITEMS)
  const hiddenPoints = timeline.length - shownTimeline.length

  return (
    <div className={css.histView}>
      <aside className={css.histTimeline}>
        <div className={css.histTlTitle}>{t('histTimelineTitle')}</div>
        <div className={css.histTlList}>
          {/* 「当前内容」恒置顶：点击回到内容视图；绿点 = 磁盘上的活文件 */}
          <div
            role="button"
            tabIndex={0}
            className={`${css.histTlItem} ${css.histTlCurrent}`}
            data-active={contentMode}
            onClick={() => { onRequestContent?.() }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onRequestContent?.()
              }
            }}
          >
            <span className={css.histTlTime}>{t('tlCurrentLabel')}</span>
            {contentMode && <span className={css.histTlMeta}>{t('histEditingLabel')}</span>}
          </div>
          {state === 'loading' && <div className={css.status}>{t('loading')}</div>}
          {state === 'no-session' && <div className={css.histTlMore}>{t('histNoSession')}</div>}
          {state === 'empty' && <div className={css.histTlMore}>{t('histEmptyShort')}</div>}
          {state === 'error' && <div className={css.statusError}>{t('histLoadFailed')}</div>}
          {shownTimeline.map(point => (
            <div
              key={point.seq}
              role="button"
              tabIndex={0}
              className={css.histTlItem}
              data-active={!contentMode && point.seq === selectedSeq}
              title={`#${point.seq}`}
              onClick={() => {
                setSelectedSeq(point.seq)
                onRequestCompare?.()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedSeq(point.seq)
                  onRequestCompare?.()
                }
              }}
            >
              <span className={css.histTlTime}>{formatPointTime(point.createdAt)}</span>
              <span className={css.histTlMeta}>#{point.seq} · {formatPointSize(point.size)}</span>
              {!contentMode && point.seq === selectedSeq && (
                <span className={css.histTlChips}>{chipButtons('mini')}</span>
              )}
            </div>
          ))}
          {hiddenPoints > 0 && (
            <div className={css.histTlMore}>{t('histMorePoints').replace('{n}', String(hiddenPoints))}</div>
          )}
        </div>
      </aside>
      <section className={css.histDiff}>
        {editorHost !== null ? (
          <>
            <div className={css.histHead}>
              <span className={css.histHeadSide}>{t('histRightLabel')}</span>
              <span className={css.histHeadStats} />
              <span className={css.histHeadSide}>{t('histEditingLabel')}</span>
            </div>
            {editorHost}
          </>
        ) : (
          <>
            {comparing && <div className={css.status}>{t('histComparing')}</div>}
            {!comparing && compare !== null && compare.ok !== true && (
              <div className={css.statusError}>{t('histLoadFailed')}</div>
            )}
            {!comparing && compare !== null && compare.ok === true && compare.status === 'unsupported' && (
              <div className={css.status}>{t('histUnsupported')}</div>
            )}
            {!comparing && compare !== null && compare.ok === true && compare.status === 'changed' && (() => {
              const leftNote = compare.leftMissing === true ? ` · ${t('histAbsentThen')}` : ''
              const rightNote = compare.rightMissing === true ? ` · ${t('histDeletedNow')}` : ''
              return (
                <>
                  <div className={css.histHead}>
                    <span className={css.histHeadSide}>
                      {t('histLeftLabel')}
                      {selectedSeq !== null ? ` · #${selectedSeq}` : ''}
                      {leftNote}
                    </span>
                    <span className={css.histHeadStats}>
                      {chipButtons('head')}
                      {compare.truncated === true && <i className={css.histStatNote}>{t('histTruncated')}</i>}
                    </span>
                    <span className={css.histHeadSide}>{t('histRightLabel')}{rightNote}</span>
                  </div>
                  <div className={css.histScroll} ref={scrollRootRef}>
                    <div className={css.histGrid}>
                      {shownRows.map((row, i) => (
                        <HistRow
                          key={i}
                          row={row}
                          jump={rowMarks.get(i)}
                          flashKind={flash !== null && flash.rowIndex === i ? flash.kind : undefined}
                        />
                      ))}
                      {hiddenRowCount > 0 && (
                        <div className={css.histMoreRows}>{t('histMoreRows').replace('{n}', String(hiddenRowCount))}</div>
                      )}
                    </div>
                  </div>
                </>
              )
            })()}
          </>
        )}
      </section>
    </div>
  )
}
