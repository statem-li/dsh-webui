/**
 * 工作区文档卡片（sidebar.footer.action，order -1，位于峰谷时刻卡片上方）。
 * 检测当前会话工作区根的 AGENTS.md 与 CLAUDE.md（大小写不敏感）：存在则
 * 每个文件一张卡片，点击经 preview-bus 复用文件浏览器的应用内预览卡
 * （markdown 渲染 / 编辑）；两个都不存在时展示一张虚线「创建 AGENTS.md」
 * 占位卡，点击写入初始骨架并自动打开预览卡供直接编辑。收起态不渲染。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: 拉入 ui-sidebar 的 SlotMap 合并声明（sidebar.footer.action key）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// 复用文件浏览器：预览开合走 preview-bus，取数走其 api 薄封装。
import { requestFilePreview } from '../file-explorer/preview-bus.ts'
import {
  createAgentMd,
  joinWorkspacePath,
  probeWorkspaceDocs,
  type WorkspaceDocHit,
} from './api.ts'

export type WorkspaceDocsCardsProps = PropsRuntime<'sidebar.footer.action'>

/** 探测节奏：30 秒一次 loopback readdir（本地目录列表，毫秒级、无文件读取），覆盖会话中新建文件的场景。 */
const PROBE_INTERVAL_MS = 30_000

/** 卡片外壳：与峰谷时刻卡片同规格（独占一行、同圆角边框内距）。 */
const cardShell: CSSProperties = {
  flex: '0 0 100%',
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.08))',
}

const headRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}

/** 文件标识点：品牌蓝（state-business-primary，勿用反色的 brand-primary）。 */
const dot: CSSProperties = {
  flex: 'none',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--dsw-alias-state-business-primary, #4176e6)',
}

const nameText: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-primary, #eee)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const badge: CSSProperties = {
  flex: 'none',
  fontSize: 11,
  lineHeight: '16px',
  padding: '0 6px',
  borderRadius: 8,
  fontWeight: 600,
  color: 'var(--dsw-alias-label-secondary, #999)',
}

/** 创建占位卡的「+」号。 */
const plusMark: CSSProperties = {
  ...dot,
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary, #999)',
  fontSize: 13,
  lineHeight: '8px',
  textAlign: 'center',
}

/** 创建失败的错误徽标（红字提示，下次点击重试）。 */
const errorBadge: CSSProperties = {
  ...badge,
  color: '#ef4444',
}

/** 字节数 → 紧凑可读文本；未知时回退扩展名标签。 */
function formatSize(size?: number): string {
  if (size === undefined || !Number.isFinite(size) || size < 0) return 'MD'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 渲染工作区文档卡片组：每个存在的文档一张卡 + 可选的创建占位卡。
 * 展开态才有内容；rail 收起态与无当前会话工作区时不渲染。
 */
export function WorkspaceDocsCards({ wide, useSessions }: WorkspaceDocsCardsProps): JSX.Element {
  // 当前会话的工作区根（cwd）：卡片探测与创建的目标目录。
  const currentCwd = useSessions(state => {
    const id = state.current
    return id === undefined ? undefined : state.byId[id]?.cwd
  })

  const [hits, setHits] = useState<WorkspaceDocHit[]>([])
  const [probing, setProbing] = useState(false)
  const [probeFailed, setProbeFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // 防竞态：cwd 切换后旧探测/创建回调不再落状态。
  const epochRef = useRef(0)

  useEffect(() => {
    if (currentCwd === undefined || currentCwd === '') {
      epochRef.current += 1
      setHits([])
      setProbeFailed(false)
      return
    }
    const epoch = epochRef.current + 1
    epochRef.current = epoch
    const fresh = (): boolean => epochRef.current === epoch

    const probe = (): void => {
      setProbing(true)
      probeWorkspaceDocs(currentCwd)
        .then(rows => {
          if (!fresh()) return
          setHits(rows)
          setProbeFailed(false)
        })
        .catch(() => {
          if (!fresh()) return
          setHits([])
          setProbeFailed(true)
        })
        .finally(() => {
          if (fresh()) setProbing(false)
        })
    }
    probe()
    const timer = window.setInterval(probe, PROBE_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [currentCwd])

  /** 一键创建 AGENTS.md：写骨架 → 立即复检 → 打开应用内预览卡直接编辑。 */
  const handleCreate = (): void => {
    if (currentCwd === undefined || currentCwd === '' || creating) return
    const cwd = currentCwd
    setCreating(true)
    setCreateError(null)
    createAgentMd(cwd)
      .then(() => probeWorkspaceDocs(cwd))
      .then(rows => {
        setHits(rows)
        setProbeFailed(false)
        requestFilePreview(joinWorkspacePath(cwd, 'AGENTS.md'))
      })
      .catch((error: unknown) => {
        setCreateError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { setCreating(false) })
  }

  // 收起态（56px rail）不占位；无工作区可探测时同样静默。
  if (!wide || currentCwd === undefined || currentCwd === '') return <></>

  // 首帧探测中不渲染（避免先闪创建卡再变两张）；列目录失败时降级为空。
  if (probing && hits.length === 0) return <></>

  const showCreateCard = hits.length === 0 && !probeFailed

  return (
    <>
      {hits.map(doc => (
        <div
          key={doc.name}
          className="dsh-wsdoc-card"
          data-solid=""
          style={cardShell}
          title={`${doc.path} · 点击预览`}
          onClick={() => { requestFilePreview(doc.path) }}
        >
          <div style={headRow}>
            <span style={dot} aria-hidden />
            <span style={nameText}>{doc.name}</span>
            <span style={badge}>{formatSize(doc.size)}</span>
          </div>
        </div>
      ))}
      {showCreateCard && (
        <div
          className="dsh-wsdoc-card dsh-wsdoc-create"
          data-solid=""
          style={cardShell}
          title={`在当前工作区创建 ${joinWorkspacePath(currentCwd, 'AGENTS.md')} · 点击创建并编辑`}
          onClick={handleCreate}
        >
          <div style={headRow}>
            <span style={plusMark} aria-hidden>+</span>
            <span style={nameText}>{creating ? '正在创建 AGENTS.md…' : '创建 AGENTS.md'}</span>
            <span style={createError === null ? badge : errorBadge}>
              {createError ?? '未找到 AGENTS.md / CLAUDE.md'}
            </span>
          </div>
        </div>
      )}
    </>
  )
}
