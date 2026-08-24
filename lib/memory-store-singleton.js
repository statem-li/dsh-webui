/**
 * webui 内部模块共享的单例 store 槽位。
 *
 * 历史：以前把 store 直接挂到 ctx（ctx.webuiMemoryStore = store）上共享，
 * harness rc.8 起的 cordis 对未 declare/provide 的 ctx 属性赋值直接 throw
 * （cannot set property without provide），导致启动即崩。改为模块级单例，
 * 语义不变：memory 模块启动时写入，tmp-cleaner 等读取复用，绝不二次实例化。
 */
let webuiMemoryStoreSingleton;
/** 写入单例（仅 memory 模块启动时调用）。 */
export function setWebuiMemoryStore(store) {
    webuiMemoryStoreSingleton = store;
}
/** 读取单例（未启用 memory 模块时为 undefined）。 */
export function getWebuiMemoryStore() {
    return webuiMemoryStoreSingleton;
}
//# sourceMappingURL=memory-store-singleton.js.map