/**
 * webui — PlanWeave 工作区映射（host 半身）。
 *
 * PlanWeave 默认把数据放在 `~/.planweave`。作为 DSH 插件，我们把它的数据根
 * 重定向到 DSH 数据目录下的 `planweave/` 子目录（`${DSH_HOME:-~/.dsh}/planweave`），
 * 与 dsh-memory 的 `${DSH_HOME}/memories/` 同款隔离约定，避免污染用户主目录、
 * 也避免与 DSH 其它数据混在一起。
 *
 * 这里只做「路径映射 + 托管项目（managed project）的幂等打开/创建」；
 * 真正的图/状态/提交逻辑全部复用 `@planweave-ai/runtime` 的公开 API。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initManagedWorkspace } from '@planweave-ai/runtime';
/** PlanWeave 数据根：`${DSH_HOME:-~/.dsh}/planweave`。 */
export function planweaveDataRoot() {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(dshHome, 'planweave');
}
/**
 * 把 runtime 的 `PLANWEAVE_HOME` 指向 DSH 数据根，并返回该路径。
 * 必须在任何 runtime 调用（init/claim/submit/…）之前执行一次，否则 runtime 会
 * 落到默认的 `~/.planweave`。
 */
export function ensurePlanweaveHome() {
    const home = planweaveDataRoot();
    process.env.PLANWEAVE_HOME = home;
    return home;
}
/**
 * 幂等打开（或首次创建）一个托管项目。
 * runtime 的 `initManagedWorkspace` 以 name 派生稳定的 projectId（name + hash），
 * 已存在时不会覆盖现有 manifest/state/results，返回 `created: false`。
 */
export async function openOrCreateProject(name) {
    ensurePlanweaveHome();
    const trimmed = name.trim();
    if (trimmed === '')
        throw new Error('PlanWeave 项目名不能为空');
    return initManagedWorkspace({ name: trimmed });
}
//# sourceMappingURL=workspace.js.map