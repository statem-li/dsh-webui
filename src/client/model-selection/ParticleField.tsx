/**
 * ParticleField — 推理等级滑杆的光尘画布（**只有粒子**：无底色面、无雾团、无光带）。
 *
 * 设计：极细小的光尘沿轨道从左端向右漂移，被当前档位位置「吸收」而淡出；
 * 竖向分布用正态偏置贴近中线，读作一条流动的尘带。档位越高 → 铺得越远、
 * 越密越快越亮。切换档位时在滑块处散开一圈火星作为反馈。
 *
 * 主题自适应：深色主题 additive（'lighter'）叠加 + 高亮度核；浅色主题
 * 'source-over' + 饱和品牌蓝核（additive 在白底上会直接消失）。
 *
 * 工程细节：devicePixelRatio 自适应、真实时间步长（不假设 60fps）、
 * prefers-reduced-motion 下完全不启动、画布尺寸为 0（最小化）时只跳帧不自杀。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/** 一粒光尘。 */
interface Mote {
  /** 水平位置（CSS px）。 */
  x: number
  /** 摆动中线（CSS px）。 */
  baseY: number
  /** 当前纵向位置（CSS px）。 */
  y: number
  /** 水平速度（px/s）。 */
  vx: number
  /** 纵向速度（px/s，仅迸发火星用）。 */
  vy: number
  /** 核半径（CSS px，极细小）。 */
  size: number
  /** 色相（deg）。 */
  hue: number
  /** 明暗呼吸相位。 */
  phase: number
  /** 明暗呼吸频率（rad/s）。 */
  pulse: number
  /** 正弦摆动幅度（px）。 */
  amp: number
  /** 正弦空间频率（rad/px）。 */
  freq: number
  /** 剩余寿命（秒）；常驻光尘为 Infinity。 */
  life: number
  /** 初始寿命（秒）。 */
  maxLife: number
}

/** {@link ParticleFieldHandle.flow} / {@link ParticleFieldHandle.burst} 的参数。 */
export interface FlowOptions {
  /** 当前档位位置（滑块中心，归一化到轨道可用宽度 0..1）。 */
  end: number
  /** 强度 0..1（推理等级越高越强）。 */
  intensity: number
  /** 当前档位主色相（deg）。 */
  hue: number
}

/** 对外暴露的控制入口。 */
export interface ParticleFieldHandle {
  /** 启动 / 更新光尘流。 */
  flow(options: FlowOptions): void
  /** 停止（常驻光尘退场，在途火星自然淡出）。 */
  stop(): void
  /** 在滑块处散开一圈火星（切换档位的触感反馈）。 */
  burst(options: FlowOptions): void
}

interface ParticleFieldProps {
  className?: string
}

/** 常驻光尘上限。 */
const MAX_MOTES = 96
/** 左右内边距，与 .webui-eff-ticks 的 left/right 一致。 */
const TRACK_PAD = 10
/** 单帧最大时间步长（切标签页回来时防止跳跃）。 */
const MAX_STEP = 0.05

/** 画布调色模式：跟随 DSH 主题。 */
type Tone = 'light' | 'dark'

/** 光尘精灵缓存，key = `${tone}:${hue}`。 */
const cache = new Map<string, HTMLCanvasElement>()

/** 色相归一到 [0,360)。 */
function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

/** 当前 DSH 主题是否为深色（官方在 body 上打 data-ds-dark-theme）。 */
function currentTone(): Tone {
  if (typeof document === 'undefined') return 'dark'
  return document.body.dataset.dsDarkTheme === undefined ? 'light' : 'dark'
}

/**
 * 取光尘精灵（径向渐变：亮核 + 极小柔晕）。
 * @param hue - 色相（deg）。
 * @param tone - 调色模式：深色主题高亮度核，浅色主题饱和品牌蓝核。
 */
function sprite(hue: number, tone: Tone): HTMLCanvasElement {
  const bucket = wrapHue(Math.round(hue / 6) * 6)
  const key = `${tone}:${bucket}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (ctx !== null) {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    if (tone === 'dark') {
      gradient.addColorStop(0, `hsla(${bucket}, 92%, 86%, .9)`)
      gradient.addColorStop(0.24, `hsla(${bucket}, 92%, 76%, .46)`)
      gradient.addColorStop(0.6, `hsla(${bucket}, 90%, 68%, .1)`)
      gradient.addColorStop(1, `hsla(${bucket}, 90%, 66%, 0)`)
    } else {
      gradient.addColorStop(0, `hsla(${bucket}, 82%, 54%, .9)`)
      gradient.addColorStop(0.26, `hsla(${bucket}, 80%, 58%, .42)`)
      gradient.addColorStop(0.62, `hsla(${bucket}, 76%, 62%, .09)`)
      gradient.addColorStop(1, `hsla(${bucket}, 76%, 64%, 0)`)
    }
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)
  }
  cache.set(key, canvas)
  return canvas
}

/** 用户是否要求减少动效。 */
function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 平滑插值（0..1）。 */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * 渲染光尘画布；`ref` 暴露 {@link ParticleFieldHandle}。
 */
export const ParticleField = forwardRef<ParticleFieldHandle, ParticleFieldProps>(
  function ParticleField({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const motesRef = useRef<Mote[]>([])
    const flowRef = useRef<FlowOptions & { active: boolean }>({ end: 0.5, intensity: 0.5, hue: 212, active: false })
    const rafRef = useRef(0)
    const runningRef = useRef(false)
    const lastRef = useRef(0)
    const toneRef = useRef<Tone>('dark')

    /** 滑块（流动终点）的画布 x 坐标。 */
    const endX = (width: number): number => {
      const inner = Math.max(0, width - TRACK_PAD * 2)
      return TRACK_PAD + inner * Math.min(1, Math.max(0, flowRef.current.end))
    }

    /** 中线正态偏置的纵向坐标（多数贴近中线，少数外扩）。 */
    const bandY = (height: number): number => {
      const mid = height / 2
      const spread = (Math.random() + Math.random() - 1) * (height * 0.3)
      return Math.min(height - 3, Math.max(3, mid + spread))
    }

    /** 生成一粒常驻光尘。 */
    const makeMote = (width: number, height: number, fresh: boolean): Mote => {
      const y = bandY(height)
      return {
        x: fresh ? -3 - Math.random() * 8 : Math.random() * width,
        baseY: y,
        y,
        vx: 10 + Math.random() * 22,
        vy: 0,
        size: 0.34 + Math.random() * 0.6,
        hue: flowRef.current.hue - 10 + Math.random() * 22,
        phase: Math.random() * Math.PI * 2,
        pulse: 0.5 + Math.random() * 1.3,
        amp: 0.6 + Math.random() * 2.2,
        freq: 0.02 + Math.random() * 0.03,
        life: Infinity,
        maxLife: Infinity,
      }
    }

    /** 在滑块处散开一圈火星。 */
    const spawnBurst = (x: number, mid: number, hue: number, intensity: number): void => {
      const count = 12 + Math.round(intensity * 12)
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6
        const speed = 24 + Math.random() * 54
        motesRef.current.push({
          x,
          baseY: mid,
          y: mid,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.55,
          size: 0.42 + Math.random() * 0.6,
          hue: hue - 10 + Math.random() * 22,
          phase: Math.random() * Math.PI * 2,
          pulse: 5 + Math.random() * 5,
          amp: 0,
          freq: 0,
          life: 0.36 + Math.random() * 0.3,
          maxLife: 0.68,
        })
      }
    }

    /** 常驻光尘数量按画布宽度 / 强度补齐或裁剪。 */
    const syncMotes = (width: number, height: number): void => {
      const target = Math.min(MAX_MOTES, Math.round(width * (0.12 + flowRef.current.intensity * 0.2)))
      const list = motesRef.current
      let resident = 0
      for (const mote of list) if (mote.life === Infinity) resident += 1
      if (resident < target) {
        for (let i = resident; i < target; i += 1) list.push(makeMote(width, height, false))
        return
      }
      let excess = resident - target
      for (let i = 0; i < list.length && excess > 0; i += 1) {
        if (list[i].life !== Infinity) continue
        list.splice(i, 1)
        i -= 1
        excess -= 1
      }
    }

    const start = (): void => {
      if (runningRef.current) return
      runningRef.current = true
      lastRef.current = 0
      rafRef.current = requestAnimationFrame(tick)
    }

    const tick = (now: number): void => {
      const canvas = canvasRef.current
      if (canvas === null) {
        runningRef.current = false
        return
      }
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      const list = motesRef.current
      const active = flowRef.current.active

      // 窗口最小化 / 面板刚挂载：尺寸为 0 时只跳帧，不结束循环（否则永久停摆）。
      if (width === 0 || height === 0) {
        if (!active && list.length === 0) {
          runningRef.current = false
          return
        }
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      toneRef.current = currentTone()

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const pixelWidth = Math.round(width * dpr)
      const pixelHeight = Math.round(height * dpr)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      const ctx = canvas.getContext('2d')
      if (ctx === null) {
        runningRef.current = false
        return
      }
      // 之后一律用 CSS px 作画，缩放交给变换矩阵。
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const dt = lastRef.current === 0 ? 1 / 60 : Math.min(MAX_STEP, (now - lastRef.current) / 1000)
      lastRef.current = now

      if (active) syncMotes(width, height)

      const dark = toneRef.current === 'dark'
      ctx.clearRect(0, 0, width, height)
      // 深色主题：additive 让光尘发光；浅色主题：常规叠加，否则白底上完全消失。
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'

      const stop = endX(width)
      const toneGain = dark ? 0.95 : 0.8
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const mote = list[i]
        if (mote.life !== Infinity) {
          mote.life -= dt
          if (mote.life <= 0) {
            list.splice(i, 1)
            continue
          }
          mote.vx *= 1 - 2.4 * dt
          mote.vy *= 1 - 2.4 * dt
          mote.x += mote.vx * dt
          mote.y += mote.vy * dt
        } else {
          mote.x += mote.vx * dt
          mote.y = mote.baseY + Math.sin(mote.phase * 0.6 + mote.x * mote.freq) * mote.amp
        }
        mote.phase += mote.pulse * dt
        if (mote.life === Infinity && mote.x > width + 3) {
          // 出界回绕，保持密度恒定。
          mote.x = -3
          mote.baseY = bandY(height)
          mote.hue = flowRef.current.hue - 10 + Math.random() * 22
        }
        // 呼吸明暗 + 「未达等级」区域淡出（尘流被滑块吸收）。
        const breath = 0.58 + 0.42 * (0.5 + 0.5 * Math.sin(mote.phase))
        const zone = mote.life === Infinity
          ? 0.06 + 0.94 * (1 - smoothstep(stop - 8, stop + 20, mote.x))
          : 1
        const decay = mote.life === Infinity ? 1 : Math.max(0, mote.life / mote.maxLife) ** 1.3
        const alpha = Math.min(1, breath * zone * decay * toneGain * (0.5 + flowRef.current.intensity * 0.5))
        if (alpha <= 0.012) continue
        // 光尘画得极小：光晕半径 = 核半径 * 3.4。
        const halo = mote.size * 3.4
        ctx.globalAlpha = alpha
        ctx.drawImage(sprite(mote.hue, toneRef.current), mote.x - halo, mote.y - halo, halo * 2, halo * 2)
      }

      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      if (!active) {
        // 停止后清场（常驻光尘退场，火星随寿命淡出）。
        const remaining = list.filter(mote => mote.life !== Infinity)
        motesRef.current = remaining
        if (remaining.length === 0) {
          runningRef.current = false
          ctx.clearRect(0, 0, width, height)
          return
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    useImperativeHandle(ref, () => ({
      flow(options) {
        if (reducedMotion()) return
        flowRef.current = { ...options, active: true }
        start()
      },
      stop() {
        flowRef.current.active = false
      },
      burst(options) {
        if (reducedMotion()) return
        flowRef.current = { ...options, active: flowRef.current.active }
        const canvas = canvasRef.current
        if (canvas === null) return
        const rect = canvas.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        spawnBurst(endX(rect.width), rect.height / 2, options.hue, options.intensity)
        start()
      },
    }), [])

    useEffect(() => () => {
      runningRef.current = false
      flowRef.current.active = false
      motesRef.current = []
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
    }, [])

    return <canvas ref={canvasRef} className={className} aria-hidden />
  },
)
