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
import { ChatProviderList } from './chat/ChatProviderList'
import { ChatProviderDetail } from './chat/ChatProviderDetail'
import type { ChatProviderMode, ChatProviderTarget } from './chat/ChatProviderDetail'
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

/* 添加自定义提供方的编辑面（官方 .editor 填充面）。 */
const editorStyle: CSSProperties = {
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-module-platform, #f2f3f5)',
  padding: '14px 16px',
  display: 'flex', flexDirection: 'column', gap: 12,
  maxWidth: 760,
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

  // 首次加载（仅 idle 时触发一次；后续靠推送失效刷新）。
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const closeDetail = (changed: boolean): void => {
    setSelected(undefined)
    setAddingCustom(false)
    if (changed) void controller.load()
  }

  /** 选中行在卡片内展开的详情（父组件包在行卡片的 editor 填充面里）。 */
  const renderDetail = (provider: string): ReactNode => {
    const row = state.rows.find(r => r.entry.provider === provider)
    if (row === undefined) return null
    return (
      <ChatProviderDetail
        key={provider}
        state={state}
        target={targetOf(row, row.configured ? 'edit' : 'adopt')}
        api={api}
        onClose={closeDetail}
      />
    )
  }

  return (
    <div className="phub-host">
      {/* 区块 1：对话供应商（行卡片列表，点击行内展开编辑器） */}
      <ChatProviderList
        state={state}
        selected={selected}
        onSelect={(p) => { setSelected(p); setAddingCustom(false) }}
        onAddCustom={() => { setAddingCustom(true); setSelected(undefined) }}
        onRetry={() => { void controller.load() }}
        renderDetail={renderDetail}
      />

      {/* 添加自定义提供方：按钮下方的独立编辑卡片 */}
      {addingCustom ? (
        <div style={editorStyle}>
          <ChatProviderDetail
            key="custom"
            state={state}
            target={CUSTOM_TARGET}
            api={api}
            onClose={closeDetail}
          />
        </div>
      ) : null}

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
