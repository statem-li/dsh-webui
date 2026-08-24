/**
 * ProviderHubSection — 「供应商」设置页主布局。
 * 对齐官方 ui-settings-models 的 ModelsSection：整页行卡片列表，点击行内展开
 * 编辑器；附加区块：辅助视觉模型 + 生图模型。
 * 对话供应商数据流复用官方 wire 链（ModelsSettingsStore）；视觉/生图复用
 * dsh-vision-helper 的 HTTP 接口。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { deriveKeyRef, ModelsSettingsStore } from './chat/store'
import type { ModelsSettingsState, ProviderRow } from './chat/store'
import { ChatProviderList, DevRoleProbeBar, modelsOf } from './chat/ChatProviderList'
import { ChatProviderDetail } from './chat/ChatProviderDetail'
import type { ChatProviderMode, ChatProviderTarget } from './chat/ChatProviderDetail'
import { PerfBenchModal } from './perf/PerfBenchModal'
import { VisionModelBlock } from './vision/VisionModelBlock'
import { ImageModelBlock } from './image/ImageModelBlock'
import { VideoModelBlock } from './video/VideoModelBlock'

/** slot `inject` 注入的依赖。 */
export interface ProviderHubInjected {
  controller: ModelsSettingsStore
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
}

/** 槽位出口交付的 props（inject 面摊平后）。 */
export type ProviderHubProps = Partial<ProviderHubInjected>

/** uSES 桥：把 snapshot store 订阅成 React 状态（免引入 web-react）。 */
function useSnapshot<T>(store: SnapshotStore<T>): T {
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.getSnapshot(),
  )
}

/** 从 ProviderRow 构造详情目标（credentialRef 仅页面惯例引用下可写才带上）。 */
function targetOf(row: ProviderRow, mode: ChatProviderMode): ChatProviderTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    ...row.entry.declared === true ? { declared: true } : {},
    mode,
  }
}

/** 自定义提供方目标：route id 由卡片内输入，写入 pi-ai 命名空间。 */
const CUSTOM_TARGET: ChatProviderTarget = {
  provider: '',
  displayName: '',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers'],
  mode: 'custom',
}

const SEP_STYLE: CSSProperties = {
  height: 1, background: 'var(--dsw-alias-border-l2, #333)', margin: '4px 0',
}

/* 对话供应商分栏容器：左导航 + 右详情；设置页拉宽以容纳双栏。 */
const hubLayoutStyle: CSSProperties = {
  display: 'flex', alignItems: 'stretch', gap: 12,
  maxWidth: 1100, minWidth: 0,
}

/* 右栏详情列：占满剩余宽度，与左栏等高。 */
const detailColStyle: CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
}

/* 右侧详情面板：细描边卡片（官方行卡同族），内部由 ChatProviderDetail 自排。 */
const detailPanelStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 12,
  padding: '14px 16px',
  display: 'flex', flexDirection: 'column', gap: 10,
  minWidth: 0, flex: 1,
}

/* 未选中任何提供方时的空态占位。 */
function DetailPlaceholder(): ReactNode {
  return (
    <div style={placeholderStyle}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>从左侧选择一个提供方</p>
      <p style={{ margin: 0, fontSize: 12 }}>查看或编辑 API Key、Base URL 与模型列表</p>
    </div>
  )
}

const placeholderStyle: CSSProperties = {
  flex: 1, minHeight: 220,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
  border: '1px dashed var(--dsw-alias-border-l3, #c9cdd4)',
  borderRadius: 12,
  color: 'var(--dsw-alias-label-tertiary, #8f959e)',
  textAlign: 'center', padding: 24,
}

/* 面板右上角小胶囊（与行内按钮同规格）。 */
const benchButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 28, padding: '0 10px', flexShrink: 0,
  border: '1px solid var(--dsw-alias-border-l2, #dcdfe6)',
  borderRadius: 14,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #1f2329)',
  fontSize: 12, lineHeight: '18px', cursor: 'pointer',
}

/** 渲染「供应商」section；shell 未注入依赖时先渲染 null。 */
export function ProviderHubSection(props: ProviderHubProps): ReactNode {
  const { controller, api } = props
  if (controller === undefined || api === undefined) return null
  return <Loaded injected={{ controller, api }} />
}

function Loaded({ injected }: { injected: ProviderHubInjected }): ReactNode {
  const { controller, api } = injected
  const state = useSnapshot(controller.store)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [addingCustom, setAddingCustom] = useState(false)
  // 打开推理性能基准测试弹窗的供应商行（null = 关闭）。
  const [benchRow, setBenchRow] = useState<ProviderRow | null>(null)

  // 首次加载（仅 idle 时触发一次；后续靠推送失效刷新）。
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const closeDetail = (changed: boolean): void => {
    setSelected(undefined)
    setAddingCustom(false)
    if (changed) void controller.load()
  }

  /** 右侧详情面板内容：选中的已配置/预设行，或「添加自定义提供方」卡片。 */
  const selectedRow = selected !== undefined
    ? state.rows.find(r => r.entry.provider === selected)
    : undefined
  let detail: ReactNode
  if (addingCustom) {
    detail = <ChatProviderDetail key="custom" state={state} target={CUSTOM_TARGET} api={api} onClose={closeDetail} />
  } else if (selectedRow !== undefined) {
    detail = (
      <ChatProviderDetail
        key={selectedRow.entry.provider}
        state={state}
        target={targetOf(selectedRow, selectedRow.configured ? 'edit' : 'adopt')}
        api={api}
        onClose={closeDetail}
      />
    )
  }

  return (
    <div className="phub-host">
      {/* 区块 1：对话供应商（左导航 + 右详情 分栏） */}
      <div style={hubLayoutStyle}>
        <ChatProviderList
          state={state}
          selected={selected}
          onSelect={(p) => { setSelected(p); setAddingCustom(false) }}
          onAddCustom={() => { setAddingCustom(true); setSelected(undefined) }}
          onRetry={() => { void controller.load() }}
        />

        <section style={detailColStyle}>
          {detail === undefined
            ? <DetailPlaceholder />
            : (
              <div style={detailPanelStyle}>
                {/* 已配置行：面板右上角放性能基准测试入口（原行内「测试」按钮）。 */}
                {selectedRow !== undefined && selectedRow.configured
                  ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="dsh-webui-capsule-btn"
                        style={benchButtonStyle}
                        onClick={() => { setBenchRow(selectedRow) }}
                      >
                        ⚡ 性能测试
                      </button>
                    </div>
                  )
                  : null}
                {detail}
              </div>
            )}
        </section>
      </div>

      {benchRow !== null
        ? (
          <PerfBenchModal
            key={benchRow.entry.provider}
            provider={benchRow.entry.provider}
            models={modelsOf(state, benchRow).map(m => ({ id: String(m['id'] ?? ''), name: typeof m['name'] === 'string' ? m['name'] : undefined }))}
            onClose={() => { setBenchRow(null) }}
          />
        )
        : null}

      {/* Developer Role 兼容检测条（结果面板需要整页宽度，放在分栏之外） */}
      <DevRoleProbeBar />

      <div style={SEP_STYLE} />

      {/* 区块 2：辅助视觉模型 */}
      <VisionModelBlock />

      <div style={SEP_STYLE} />

      {/* 区块 3：生图模型 */}
      <ImageModelBlock />

      <div style={SEP_STYLE} />

      {/* 区块 4：生视频模型 */}
      <VideoModelBlock />
    </div>
  )
}
