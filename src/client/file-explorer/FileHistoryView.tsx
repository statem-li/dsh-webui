/**
 * dsh-file-explorer — 文件「修改历史」对比视图：
 *   左侧时间线列出此文件在各次发消息前自动快照中的内容变化点（可点击），
 *   右侧左右分栏 diff：左 = 选中的历史版本，右 = 当前磁盘内容。
 * 数据来自 host /api/webui-rewind/history 与 /compare（对话退回快照体系）。
 */
import { useEffect, useMemo, useState } from 'react'
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
}

type HistoryState = 'loading' | 'error' | 'empty' | 'ready' | 'no-session'

/** 时间线最多渲染的点数（更早的折叠成计数）。 */
const MAX_TIMELINE_ITEMS = 60
/** 最多渲染的对齐行数（防止超大 diff 卡死 DOM）。 */
const MAX_RENDER_ROWS = 4000

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

/** 一条对齐行：左右两个半格；缺行的一侧留出空格子保持栅格对齐。 */
function HistRow({ row }: { row: CompareRow }): JSX.Element {
  return (
    <div className={`${css.histRow} ${ROW_KIND_CLASS[row.kind]}`}>
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

export function FileHistoryView({ sessionId, path, t }: FileHistoryViewProps): JSX.Element {
  const [state, setState] = useState<HistoryState>('loading')
  const [points, setPoints] = useState<FileHistoryPoint[]>([])
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [compare, setCompare] = useState<FileCompareResult | null>(null)
  const [comparing, setComparing] = useState(false)

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
        // 默认选中最近一次变化，直接呈现「最近改了什么」。
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
      },
      () => {
        if (!current) return
        setCompare({ ok: false, error: 'request failed' })
        setComparing(false)
      },
    )
    return () => { current = false }
  }, [state, selectedSeq, path, sessionId])

  // 时间线倒序（最新在上）；超出上限的更早点折叠成计数。
  const timeline = useMemo(() => [...points].reverse(), [points])
  const shownTimeline = timeline.slice(0, MAX_TIMELINE_ITEMS)
  const hiddenPoints = timeline.length - shownTimeline.length

  const rows = compare?.ok === true ? compare.rows ?? [] : []
  const shownRows = rows.slice(0, MAX_RENDER_ROWS)
  const hiddenRowCount = rows.length - shownRows.length
  const stats = compare?.stats

  if (state === 'no-session') return <div className={css.status}>{t('histNoSession')}</div>
  if (state === 'loading') return <div className={css.status}>{t('loading')}</div>
  if (state === 'error') return <div className={css.statusError}>{t('histLoadFailed')}</div>
  if (state === 'empty') return <div className={css.status}>{t('histEmpty')}</div>

  return (
    <div className={css.histView}>
      <aside className={css.histTimeline}>
        <div className={css.histTlTitle}>{t('histTimelineTitle')}</div>
        <div className={css.histTlList}>
          {shownTimeline.map(point => (
            <button
              key={point.seq}
              type="button"
              className={css.histTlItem}
              data-active={point.seq === selectedSeq}
              title={`#${point.seq}`}
              onClick={() => { setSelectedSeq(point.seq) }}
            >
              <span className={css.histTlTime}>{formatPointTime(point.createdAt)}</span>
              <span className={css.histTlMeta}>#{point.seq} · {formatPointSize(point.size)}</span>
            </button>
          ))}
          {hiddenPoints > 0 && (
            <div className={css.histTlMore}>{t('histMorePoints').replace('{n}', String(hiddenPoints))}</div>
          )}
        </div>
      </aside>
      <section className={css.histDiff}>
        {comparing && <div className={css.status}>{t('histComparing')}</div>}
        {!comparing && compare !== null && compare.ok !== true && (
          <div className={css.statusError}>{t('histLoadFailed')}</div>
        )}
        {!comparing && compare !== null && compare.ok === true && compare.status === 'unsupported' && (
          <div className={css.status}>{t('histUnsupported')}</div>
        )}
        {!comparing && compare !== null && compare.ok === true && compare.status === 'same' && (
          <div className={css.histSame}>{t('histSameNote')}</div>
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
                  {stats !== undefined && (
                    <>
                      <b className={css.histStatAdd}>+{stats.added}</b>
                      <b className={css.histStatDel}>−{stats.removed}</b>
                    </>
                  )}
                  {compare.truncated === true && <i className={css.histStatNote}>{t('histTruncated')}</i>}
                </span>
                <span className={css.histHeadSide}>{t('histRightLabel')}{rightNote}</span>
              </div>
              <div className={css.histScroll}>
                <div className={css.histGrid}>
                  {shownRows.map((row, i) => <HistRow key={i} row={row} />)}
                  {hiddenRowCount > 0 && (
                    <div className={css.histMoreRows}>{t('histMoreRows').replace('{n}', String(hiddenRowCount))}</div>
                  )}
                </div>
              </div>
            </>
          )
        })()}
      </section>
    </div>
  )
}
