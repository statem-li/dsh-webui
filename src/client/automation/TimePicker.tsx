/**
 * automation — TimePicker：双列时/分滚轮弹层（openhanako 同款交互）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from './locales.ts'

function two(value: number): string {
  return String(value).padStart(2, '0')
}

function parseTime(value: string): { hour: number, minute: number } {
  const [hour = '9', minute = '0'] = String(value || '').split(':')
  return {
    hour: Math.max(0, Math.min(23, Number.parseInt(hour, 10) || 0)),
    minute: Math.max(0, Math.min(59, Number.parseInt(minute, 10) || 0)),
  }
}

export function TimePicker({ value, onChange }: {
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const { hour, minute } = parseTime(value)
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => index), [])
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => index), [])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // 打开时把两列滚动到当前选中值。
  useEffect(() => {
    if (!open) return
    const raf = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame
      : (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
    raf(() => {
      popRef.current?.querySelectorAll('[data-selected="true"]').forEach(node => {
        if (node instanceof HTMLElement && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'center' })
        }
      })
    })
  }, [hour, minute, open])

  const selectHour = (nextHour: number): void => { onChange(`${two(nextHour)}:${two(minute)}`) }
  const selectMinute = (nextMinute: number): void => { onChange(`${two(hour)}:${two(nextMinute)}`) }

  return (
    <div className="auto-time" ref={rootRef}>
      <button
        type="button"
        className="auto-time-btn"
        aria-label={t('time')}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span>{`${two(hour)}:${two(minute)}`}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      {open ? (
        <div className="auto-time-pop" ref={popRef}>
          <div className="auto-time-col" role="listbox" aria-label={t('hour')}>
            {hours.map(option => (
              <button
                key={option}
                type="button"
                className="auto-time-opt"
                data-selected={option === hour}
                onClick={() => selectHour(option)}
              >
                {two(option)}
              </button>
            ))}
          </div>
          <div className="auto-time-div" aria-hidden="true" />
          <div className="auto-time-col" role="listbox" aria-label={t('minute')}>
            {minutes.map(option => (
              <button
                key={option}
                type="button"
                className="auto-time-opt"
                data-selected={option === minute}
                onClick={() => selectMinute(option)}
              >
                {two(option)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
