/**
 * ProviderHubSection — 「供应商」设置页主布局。
 * 三区块：对话供应商（左列表 + 右详情）+ 辅助视觉模型 + 生图模型。
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

const ROW_STYLE: CSSProperties = {
  display: 'flex', gap: 16, alignItems: 'flex-start',
}
const LIST_COL_STYLE: CSSProperties = { flex: '0 0 200px', minWidth: 0 }
const DETAIL_COL_STYLE: CSSProperties = { flex: 1, minWidth: 0 }
const EMPTY_STYLE: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary, #888)', padding: 24, fontSize: 13,
}
const SEP_STYLE: CSSProperties = {
  height: 1, background: 'var(--dsw-alias-border-l2, #333)', margin: '8px 0',
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

  // 构造详情目标：自定义创建优先；否则选中行 → edit/adopt。
  let target: ChatProviderTarget | undefined
  if (addingCustom) {
    target = CUSTOM_TARGET
  } else if (selected !== undefined) {
    const row = state.rows.find(r => r.entry.provider === selected)
    if (row !== undefined) target = targetOf(row, row.configured ? 'edit' : 'adopt')
  }

  const closeDetail = (changed: boolean): void => {
    setSelected(undefined)
    setAddingCustom(false)
    if (changed) void controller.load()
  }

  return (
    <div className="phub-host">
      {/* 区块 1：对话供应商（左列表 + 右详情） */}
      <div style={ROW_STYLE}>
        <div style={LIST_COL_STYLE}>
          <ChatProviderList
            state={state}
            selected={selected}
            onSelect={(p) => { setSelected(p); setAddingCustom(false) }}
            onAddCustom={() => { setAddingCustom(true); setSelected(undefined) }}
            onRetry={() => { void controller.load() }}
          />
        </div>
        <div style={DETAIL_COL_STYLE}>
          {target !== undefined ? (
            <ChatProviderDetail
              key={addingCustom ? 'custom' : target.provider}
              state={state}
              target={target}
              api={api}
              onClose={closeDetail}
            />
          ) : (
            <div style={EMPTY_STYLE}>选择一个供应商查看详情</div>
          )}
        </div>
      </div>

      <div style={SEP_STYLE} />

      {/* 区块 2：辅助视觉模型 */}
      <VisionModelBlock />

      <div style={SEP_STYLE} />

      {/* 区块 3：生图模型 */}
      <ImageModelBlock />
    </div>
  )
}
