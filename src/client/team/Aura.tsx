/**
 * team — 团队模式入场动画：从窗口中心扩散光晕（轻简版）。
 *
 * 打开团队模式：一圈光晕从窗口几何中心散开（光斑放大 + 圆环扩散），
 * 约 1.3s 一次过场，播放完即移除（无常驻层、不换背景）；
 * 关闭：光晕反向收拢回中心（0.6s）后移除。
 *
 * 实现要点：
 *  - portal 到 body、fixed 全屏、pointer-events:none、z-index 850；
 *  - 只动 transform/opacity（合成器零成本），光晕是静态 radial
 *    渐变、圆环是 border——无滤镜插值不卡帧；
 *  - 不使用 backdrop-filter（大面积采样有合成开销）；
 *  - 类名 team-aura-*：不含 glass.ts 浮层子串；
 *  - prefers-reduced-motion 时样式层关闭动画。
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** 动画信号：dir 决定扩散（in）或收拢（out）。 */
export interface AuraPulse {
  key: number
  dir: 'in' | 'out'
}

/** 光晕层主体。active=开关状态；pulse=切换信号（key 递增重播）。 */
export function TeamAura({ active, pulse }: { active: boolean, pulse: AuraPulse | null }): JSX.Element | null {
  /** 是否渲染 DOM（收拢过渡期内仍渲染）。 */
  const [shown, setShown] = useState(false)
  /** 当前方向（pulse 清空后保持，避免动画重置）。 */
  const [dir, setDir] = useState<'in' | 'out'>('in')

  useEffect(() => {
    if (pulse !== null) setDir(pulse.dir)
  }, [pulse?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // 开：显示并播放扩散；关：播放收拢后延迟卸载。
  useEffect(() => {
    if (active) {
      setShown(true)
      return
    }
    const timer = window.setTimeout(() => setShown(false), 700)
    return () => { window.clearTimeout(timer) }
  }, [active])

  if (!shown) return null

  return createPortal(
    <div className="team-aura" data-dir={dir} aria-hidden="true">
      {/* 中心光斑：从中心放大散开的光晕 */}
      <div className="team-aura-blob" />
      {/* 圆环：扩散的柔光圈 */}
      <div className="team-aura-ring" />
      {/* 微光填充：整体弥漫的淡蓝光辉 */}
      <div className="team-aura-wash" />
    </div>,
    document.body,
  )
}