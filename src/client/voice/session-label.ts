/**
 * webui — 会话显示名（语音播报用）。
 *
 * 多个会话同时跑时，别的会话的总结会加上会话名前缀（"XX 项目：已修复…"），
 * 否则听者根本不知道刚念的是哪个会话的结果。名字取自运行时 sessions 服务的
 * displayTitle；服务不可用或没标题时返回空串（host 侧就不加前缀）。
 */

/** 运行时 sessions 服务（client 入口注入；未注入时降级为无名字）。 */
let sessionsService: any

/**
 * 注入 sessions 服务。
 * @param service - ClientContext.get('sessions') 的结果。
 */
export function setSessionsService(service: unknown): void {
  sessionsService = service
}

/**
 * 取某会话的显示名。
 * @param sessionId - 会话 id。
 * @returns 显示名；取不到返回空串。
 */
export function sessionLabel(sessionId: string): string {
  try {
    if (sessionsService === undefined) return ''
    const snapshot = sessionsService.list.getSnapshot()
    const summary = snapshot?.byId?.[sessionId]
    const title = summary?.displayTitle
    return typeof title === 'string' ? title.trim().slice(0, 24) : ''
  } catch {
    return ''
  }
}
