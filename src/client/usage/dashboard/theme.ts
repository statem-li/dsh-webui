/** 固定供应商色板（8 色循环），同一 provider 跨图表一致。 */
const PALETTE = ['#4f8cff', '#7c6bff', '#22b8cf', '#51cf66', '#ffa94d', '#f06595', '#ff6b6b', '#868e96']
export function providerPalette(): string[] { return [...PALETTE] }
export function alertColor(level: string): string {
  switch (level) {
    case 'critical': return 'var(--dsw-alias-state-error-primary)'
    case 'warning': return 'var(--dsw-alias-state-warn-primary)'
    case 'normal': return 'var(--dsw-alias-state-success-primary)'
    default: return 'var(--dsw-alias-label-tertiary)'
  }
}
