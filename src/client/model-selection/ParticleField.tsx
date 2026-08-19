/**
 * ParticleField — canvas 粒子场，供推理等级滑杆使用。
 *
 * 流动效果：光点沿滑杆轨道**从左向右持续流动**（能量流 / 电流），颜色随
 * 位置从冷色渐变到暖色，只在已激活的渐变填充带内流动，到达滑块处消失。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  /** 水平流动光点（颜色随位置渐变），否则为迸发火花（固定色）。 */
  flow: boolean
}

/** 对外暴露的发射入口。 */
export interface ParticleFieldHandle {
  /**
   * 启动沿轨道持续流动的光点。
   * @param endTx - 流动终点（滑块位置，0..1）：光点流到这里消失。
   * @param ty - 轨道中线（0..1）。
   */
  flow(endTx: number, ty: number): void
  /** 停止持续流动（粒子仍自然淡出）。 */
  stop(): void
}

interface ParticleFieldProps {
  className?: string
}

/** 常驻粒子数上限。 */
const MAX_PARTICLES = 240
/** 流动发射速率（个/秒）。 */
const FLOW_RATE = 30

/**
 * 渲染粒子画布；`ref` 暴露 {@link ParticleFieldHandle}。
 */
export const ParticleField = forwardRef<ParticleFieldHandle, ParticleFieldProps>(
  function ParticleField({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const particlesRef = useRef<Particle[]>([])
    const emitterRef = useRef({ endTx: 0.5, ty: 0.5, active: false })
    const rafRef = useRef(0)
    const runningRef = useRef(false)
    const spawnAccRef = useRef(0)

    const spawnFlow = (): void => {
      // 从轨道左端生成，向右流动。
      const speed = 80 + Math.random() * 70
      const maxLife = 2.0 + Math.random() * 0.6
      particlesRef.current.push({
        x: 8 + Math.random() * 4,
        y: emitterRef.current.ty * (canvasRef.current?.getBoundingClientRect().height ?? 40)
          + (Math.random() - 0.5) * 3,
        vx: speed,
        vy: (Math.random() - 0.5) * 6,
        life: maxLife,
        maxLife,
        size: 1.2 + Math.random() * 1.7,
        color: '',
        flow: true,
      })
    }

    const trim = (): void => {
      const list = particlesRef.current
      if (list.length > MAX_PARTICLES) list.splice(0, list.length - MAX_PARTICLES)
    }

    useImperativeHandle(ref, () => ({
      flow(endTx, ty) {
        emitterRef.current = { endTx, ty, active: true }
        start()
      },
      stop() {
        emitterRef.current.active = false
      },
    }), [])

    const start = (): void => {
      if (runningRef.current) return
      runningRef.current = true
      rafRef.current = requestAnimationFrame(tick)
    }

    const tick = (): void => {
      const canvas = canvasRef.current
      if (canvas === null) {
        runningRef.current = false
        return
      }
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        runningRef.current = false
        return
      }
      if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
        canvas.width = Math.round(rect.width)
        canvas.height = Math.round(rect.height)
      }
      const ctx = canvas.getContext('2d')
      const particles = particlesRef.current

      // 持续流动：按固定速率从轨道左端生成光点。
      if (emitterRef.current.active) {
        spawnAccRef.current += FLOW_RATE / 60
        let budget = Math.floor(spawnAccRef.current)
        spawnAccRef.current -= budget
        if (budget > 3) budget = 3
        while (budget-- > 0) spawnFlow()
        trim()
      }

      if (ctx !== null) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.globalCompositeOperation = 'lighter'
        const dt = 1 / 60
        const endX = emitterRef.current.endTx * canvas.width
        for (let i = particles.length - 1; i >= 0; i -= 1) {
          const p = particles[i]
          p.life -= dt
          if (p.life <= 0) {
            particles.splice(i, 1)
            continue
          }
          p.x += p.vx * dt
          p.y += p.vy * dt
          // 流动光点到达滑块（填充带右端）即消失。
          if (p.flow && p.x >= endX - 2) {
            particles.splice(i, 1)
            continue
          }
          const alpha = Math.max(0, p.life / p.maxLife)
          ctx.globalAlpha = alpha
          // 流动光点颜色随位置从冷色(蓝)渐变到暖色(橙红)。
          ctx.fillStyle = p.flow
            ? `hsl(${Math.round(215 - (p.x / canvas.width) * 200)} 95% 60%)`
            : p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }

      if (particles.length === 0 && !emitterRef.current.active) {
        runningRef.current = false
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    useEffect(() => () => {
      runningRef.current = false
      emitterRef.current.active = false
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
    }, [])

    return <canvas ref={canvasRef} className={className} aria-hidden />
  },
)
