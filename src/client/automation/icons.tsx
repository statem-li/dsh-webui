/**
 * automation — 线性图标集（16px 网格，stroke=currentColor，随文字着色）。
 *
 * 与 DSH 官方图标同款风格：1.8 描边、round 端点、无填充。
 */

interface IconProps {
  size?: number
}

function svgProps(size: number): Record<string, unknown> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
}

/** 时钟（模块主图标）。 */
export function ClockIcon({ size = 16 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

/** 加号。 */
export function PlusIcon({ size = 14 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** 搜索。 */
export function SearchIcon({ size = 14 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

/** 关闭 / 清空。 */
export function CloseIcon({ size = 12 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** 刷新。 */
export function RefreshIcon({ size = 14 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  )
}

/** 加载中转圈（半环）。 */
export function SpinnerIcon({ size = 12 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)} strokeWidth={2.2}>
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  )
}

/** 播放（立即运行）。 */
export function PlayIcon({ size = 13 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  )
}

/** 停止（中止运行）。 */
export function StopIcon({ size = 13 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  )
}

/** 复制。 */
export function CopyIcon({ size = 13 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </svg>
  )
}

/** 垃圾桶（删除）。 */
export function TrashIcon({ size = 13 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 7h16M9.5 7V5h5v2M6 7l1 13h10l1-13" />
    </svg>
  )
}

/** 下拉箭头。 */
export function ChevronIcon({ size = 13 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** 空态：日历。 */
export function CalendarIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)} strokeWidth={1.5}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
    </svg>
  )
}

/** 空态：文档（运行记录）。 */
export function DocIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)} strokeWidth={1.5}>
      <path d="M6 3.5h7l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20.5v-16Z" />
      <path d="M13 3.5V9h5M9 13h6M9 16.5h6" />
    </svg>
  )
}

/** 警告（错误横幅）。 */
export function AlertIcon({ size = 13 }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.2v.6" />
    </svg>
  )
}
