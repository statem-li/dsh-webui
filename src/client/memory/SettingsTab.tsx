/**
 * dsh-memory 面板「设置」Tab：运行时配置（开关 + 数字输入）。
 * 从 Panel.tsx 拆分出的独立子组件，改动即时生效并持久化到 config.json。
 */

import type { MemoryConfigView } from './api.js'
import { css } from './styles.js'

/** 设置区：开关行。 */
function ConfigSwitch({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className={css.switchLine} style={{ padding: '8px 0' }}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={css.switch}
        onClick={() => onChange(!value)}
      />
      <span className={css.switchText}>{label}</span>
    </label>
  )
}

/** 设置区：数字输入行。 */
function ConfigNumber({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <label className={css.switchLine} style={{ padding: '4px 0' }}>
      <span className={css.switchText} style={{ minWidth: 180 }}>{label}</span>
      <input
        type="number"
        className={css.inlineInput}
        style={{ width: 96 }}
        value={value ?? ''}
        onChange={e => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n > 0) onChange(n)
        }}
      />
    </label>
  )
}

/** 设置 Tab 内容。 */
export function SettingsTab({ config, onPatch }: { config: MemoryConfigView | null; onPatch: (patch: Partial<MemoryConfigView>) => void }): JSX.Element {
  if (config === null) return <div className={css.empty}>加载配置…</div>
  return (
    <div className={css.cardList}>
      <ConfigSwitch label="Memory Dream 每日整理" value={config.consolidateEnabled === true} onChange={v => { onPatch({ consolidateEnabled: v }) }} />
      <ConfigSwitch label="每日编译（衰减/折叠/滚出）" value={config.dailyCompileEnabled === true} onChange={v => { onPatch({ dailyCompileEnabled: v }) }} />
      <ConfigSwitch label="API 请求日志" value={config.logApiRequests === true} onChange={v => { onPatch({ logApiRequests: v }) }} />
      <ConfigNumber label="注入检索条数 top-k" value={config.injectTopK} onChange={v => { onPatch({ injectTopK: v }) }} />
      <ConfigNumber label="提取重要性下限 (1-10)" value={config.minImportance} onChange={v => { onPatch({ minImportance: v }) }} />
      <ConfigNumber label="每 N 轮提取一次" value={config.extractEveryTurns} onChange={v => { onPatch({ extractEveryTurns: v }) }} />
      <ConfigNumber label="全局条目上限" value={config.entryLimit} onChange={v => { onPatch({ entryLimit: v }) }} />
    </div>
  )
}
