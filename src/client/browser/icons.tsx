/**
 * dsh-browser — 抽屉 UI 图标集（线条风格 SVG，1.6 描边，currentColor）。
 *
 * 旧版用全角字符（＋ ✕ ⧉ ▴）当按钮内容：字形随系统字体漂移、垂直居中不可控、
 * 不同缩放下粗细不一致。统一改为 16/14px viewBox=24 的线条图标，与 DSH 官方
 * ui-primitives/icons 的视觉重量一致（strokeWidth 1.6~1.8、圆角端点）。
 */

export interface IconProps {
  size?: number
}

/** 通用外壳：统一 viewBox / 描边风格，子元素只写路径。 */
function Svg({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** 地球（浏览器主图标）：球形网状，小尺寸下依然清晰。 */
export function GlobeIcon({ size = 14 }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4.2" ry="9" />
      <path d="M3.2 9h17.6M3.2 15h17.6" />
    </Svg>
  )
}

export function BackIcon({ size = 16 }: IconProps) {
  return <Svg size={size}><path d="M15 5l-7 7 7 7" /></Svg>
}

export function ForwardIcon({ size = 16 }: IconProps) {
  return <Svg size={size}><path d="M9 5l7 7-7 7" /></Svg>
}

/** 刷新（顺时针箭头环，缺口在右上）。 */
export function ReloadIcon({ size = 16 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.5V10h-5.4" />
    </Svg>
  )
}

/** 停止（加载中时替换刷新按钮）。 */
export function StopIcon({ size = 16 }: IconProps) {
  return <Svg size={size}><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></Svg>
}

export function PlusIcon({ size = 16 }: IconProps) {
  return <Svg size={size}><path d="M12 5v14M5 12h14" /></Svg>
}

export function CloseIcon({ size = 16 }: IconProps) {
  return <Svg size={size}><path d="M6 6l12 12M18 6L6 18" /></Svg>
}

/** 复制（双层卡片）。 */
export function CopyIcon({ size = 16 }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </Svg>
  )
}

export function CheckIcon({ size = 16 }: IconProps) {
  return <Svg size={size}><path d="M5 13l4.2 4.2L19 7" /></Svg>
}

/** 书签星（收藏当前页；filled 为已收藏态）。 */
export function StarIcon({ size = 16, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false"
    >
      <path d="M12 4.2l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />
    </svg>
  )
}

/** 选取元素（准星方框，对齐 DevTools 的 inspect 语义）。 */
export function PickIcon({ size = 16 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9M20 15v2.5A2.5 2.5 0 0 1 17.5 20H15M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15" />
      <circle cx="12" cy="12" r="2.2" />
    </Svg>
  )
}

/** 锁（https）。 */
export function LockIcon({ size = 14 }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Svg>
  )
}

/** 警示三角（http / 不安全）。 */
export function InsecureIcon({ size = 14 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 4.8l8 14.4H4z" />
      <path d="M12 10v4M12 16.6v.2" />
    </Svg>
  )
}

/** 更多（竖向三点）。 */
export function MoreIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
      xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
      <circle cx="12" cy="5.6" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.4" r="1.7" />
    </svg>
  )
}

export function ChevronUpIcon({ size = 14 }: IconProps) {
  return <Svg size={size}><path d="M6 14.5l6-6 6 6" /></Svg>
}

export function ChevronDownIcon({ size = 14 }: IconProps) {
  return <Svg size={size}><path d="M6 9.5l6 6 6-6" /></Svg>
}

/** 垃圾桶（删除书签）。 */
export function TrashIcon({ size = 14 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4.5 7.5h15M9.5 7.5V5.8A1.3 1.3 0 0 1 10.8 4.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.5 7.5l.8 10.4A1.7 1.7 0 0 0 9 19.5h6a1.7 1.7 0 0 0 1.7-1.6l.8-10.4" />
    </Svg>
  )
}
