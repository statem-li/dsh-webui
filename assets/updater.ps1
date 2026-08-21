# updater.ps1 — DSH 分离式更新脚本（由 dsh-updater 插件分离启动，独立于 DSH 进程存活）
# 流程：停 DSH 服务(:3080) -> 自动 stash 本地改动 -> git pull -> pnpm install -> pnpm build
#      -> 恢复 stash -> 写结果 -> 杀壳子 -> 重新拉起 exe
# 进度：每个阶段写 progress JSON 到 cfg.progressFile，前端 state 轮询读取渲染进度条。
param(
    [string]$ConfigFile
)

$ErrorActionPreference = 'Continue'

# 独立启动标记：即使后续 config 解析失败，也能确认脚本被 PowerShell 加载并留下痕迹
$bootMarker = Join-Path $env:TEMP 'dsh-updater-boot.log'
try {
    Add-Content -LiteralPath $bootMarker -Value ("[{0}] updater.ps1 已启动 pid={1} config={2}" -f (Get-Date -Format 'HH:mm:ss'), $PID, $ConfigFile) -Encoding utf8
} catch {}

# config 容错：解析失败（参数缺失/文件不存在）时写标记退出，避免无参数交互卡死
$cfg = $null
try {
    $cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
} catch {
    try { Add-Content -LiteralPath $bootMarker -Value ("[{0}] config 解析失败: {1}" -f (Get-Date -Format 'HH:mm:ss'), $_.Exception.Message) -Encoding utf8 } catch {}
}
if (-not $cfg) {
    try { Add-Content -LiteralPath $bootMarker -Value ("[{0}] 无法读取 config（参数缺失或文件不存在），退出" -f (Get-Date -Format 'HH:mm:ss')) -Encoding utf8 } catch {}
    exit 1
}
$progressFile = if ($cfg.progressFile) { $cfg.progressFile } else { Join-Path (Split-Path $ConfigFile -Parent) 'progress.json' }

function Log($msg) {
    $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg)
    try { Add-Content -LiteralPath $cfg.logFile -Value $line -Encoding utf8 } catch {}
}

# 写进度：{ stage, percent(0-100), msg }
function Set-Progress {
    param(
        [string]$stage,
        [int]$percent,
        [string]$msg
    )
    $prog = @{
        stage   = $stage
        percent = $percent
        msg     = $msg
        at      = (Get-Date -Format 'HH:mm:ss')
    }
    try { $prog | ConvertTo-Json -Compress | Set-Content -LiteralPath $progressFile -Encoding utf8 } catch {}
    Log ("progress: {0} {1}% {2}" -f $stage, $percent, $msg)
}

Log '==== dsh updater start ===='
Log ('pid={0} dshDir={1} shellDir={2}' -f $PID, $cfg.dshDir, $cfg.shellDir)
Set-Progress -stage 'boot' -percent 2 -msg '正在启动更新脚本…'

# 0) 等 2 秒，让浏览器收到 HTTP 响应（插件随后会被杀掉）
Start-Sleep -Milliseconds 2000

# 1) 停掉 3080 上的 DSH 服务（会连同插件宿主一起结束）
Set-Progress -stage 'stop-service' -percent 5 -msg '正在停止 DSH 服务…'
try {
    $lines = netstat -ano | Select-String ':3080' | Select-String 'LISTENING'
    $pids = @($lines | ForEach-Object { (($_.Line.Trim() -split '\s+') | Select-Object -Last 1) } | Where-Object { $_ -match '^\d+$' } | Sort-Object -Unique)
    foreach ($p in $pids) {
        taskkill /PID $p /T /F 2>&1 | Out-Null
        Log "killed dsh pid $p"
    }
} catch { Log "stop service: $_" }
Start-Sleep -Seconds 2
Set-Progress -stage 'stop-service' -percent 8 -msg '服务已停止'

# 2) 记录壳子进程（可执行文件在 shellDir / 实际壳子目录下的 Electron 进程）和要重新拉起的 exe
$shellPids = @()
$relaunch = $null
$relaunchArgs = @()
try {
    # 候选壳子目录：配置的 shellDir + 常见实际安装目录（D:\AI\DeepSeek Harness）
    $shellDirs = @($cfg.shellDir)
    $realShellDir = Join-Path 'D:\AI' 'DeepSeek Harness'
    if (Test-Path -LiteralPath $realShellDir) { $shellDirs += $realShellDir }
    $shellPids = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and ($shellDirs | Where-Object { $_.ExecutablePath.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) })
    } | ForEach-Object { $_.ProcessId })
    foreach ($p in $shellPids) { Log "shell pid $p" }
    # 重启目标候选（按修改时间最新优先）：shellDir\dist\*.exe → 实际壳子目录 exe → dev electron
    $candidates = @()
    $distExe = Get-ChildItem -LiteralPath (Join-Path $cfg.shellDir 'dist') -Filter '*.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($distExe) { $candidates += $distExe.FullName }
    $realExe = Get-ChildItem -LiteralPath $realShellDir -Filter '*.exe' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($realExe) { $candidates += $realExe.FullName }
    if ($candidates.Count -gt 0) {
        $relaunch = $candidates[0]
        Log "relaunch target: $relaunch"
    } else {
        $devElectron = Join-Path $cfg.shellDir 'node_modules\electron\dist\electron.exe'
        if (Test-Path -LiteralPath $devElectron) {
            $relaunch = $devElectron
            $relaunchArgs = @('.')
            Log "dev relaunch target: $relaunch"
        }
    }
} catch { Log "shell scan: $_" }

# 3) 自动 stash 本地改动（避免 git pull 冲突）：
#    未跟踪文件一并 stash（-u），更新完成后尝试恢复（git stash pop）。
Set-Location -LiteralPath $cfg.dshDir
$stashed = $false
try {
    $dirtyCount = (git status --porcelain 2>$null | Measure-Object -Line).Lines
    if ($dirtyCount -gt 0) {
        Log "detected $dirtyCount local changes, auto-stashing…"
        Set-Progress -stage 'stash' -percent 10 -msg "工作区有 $dirtyCount 处改动，正在自动暂存（stash）…"
        git stash push -u -m 'dsh-updater auto-stash' 2>&1 | ForEach-Object { Log $_ }
        if ($LASTEXITCODE -eq 0) { $stashed = $true; Log 'stash ok' } else { Log 'stash failed' }
    }
} catch { Log "stash: $_" }

# 4) git pull
Set-Progress -stage 'git-pull' -percent 15 -msg '正在拉取最新源码（git pull）…'
Log 'step 1/3: git pull --ff-only'
$pull = $false
try {
    git pull --ff-only 2>&1 | ForEach-Object { Log $_ }
    $pull = ($LASTEXITCODE -eq 0)
} catch { Log "git pull: $_" }
if (-not $pull) { Log 'git pull failed' }
Set-Progress -stage 'git-pull' -percent 40 -msg '源码拉取完成'

# 5) pnpm install
$install = $false
if ($pull) {
    Log 'step 2/3: pnpm install'
    Set-Progress -stage 'install' -percent 45 -msg '正在安装依赖（pnpm install）…'
    try {
        pnpm install 2>&1 | ForEach-Object { Log $_ }
        $install = ($LASTEXITCODE -eq 0)
    } catch { Log "pnpm install: $_" }
} else { Log 'skipped pnpm install (pull failed)' }
Set-Progress -stage 'install' -percent 70 -msg '依赖安装完成'

# 6) pnpm build
$build = $false
if ($install) {
    Log 'step 3/3: pnpm build'
    Set-Progress -stage 'build' -percent 75 -msg '正在构建（pnpm build）…'
    try {
        pnpm build 2>&1 | ForEach-Object { Log $_ }
        $build = ($LASTEXITCODE -eq 0)
    } catch { Log "pnpm build: $_" }
} else { Log 'skipped pnpm build (install failed)' }
Set-Progress -stage 'build' -percent 90 -msg '构建完成'

# 6.5) 恢复 stash
if ($stashed) {
    Set-Progress -stage 'stash-pop' -percent 93 -msg '正在恢复本地改动（stash pop）…'
    try {
        git stash pop 2>&1 | ForEach-Object { Log $_ }
        if ($LASTEXITCODE -eq 0) { Log 'stash pop ok' } else { Log 'stash pop conflict — 请手动处理（git stash list）' }
    } catch { Log "stash pop: $_" }
}

# 7) 记录结果（设置页在重启后读取）
$ok = ($pull -and $install -and $build)
$commit = ''
try { $commit = ((git log --oneline -1 2>$null) -join ' ').Trim() } catch {}
$result = @{
    ok      = $ok
    commit  = $commit
    at      = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    pull    = $pull
    install = $install
    build   = $build
    stashed = $stashed
}
try {
    $result | ConvertTo-Json | Set-Content -LiteralPath $cfg.resultFile -Encoding utf8
    Log 'result written'
} catch { Log "result write: $_" }
Log ("result: ok={0} commit={1} stashed={2}" -f $ok, $commit, $stashed)

# 8) 杀壳子并重新拉起
Set-Progress -stage 'restart' -percent 95 -msg '正在重启壳子…'
foreach ($p in $shellPids) {
    try { taskkill /PID $p /T /F 2>&1 | Out-Null; Log "killed shell pid $p" } catch {}
}
Start-Sleep -Seconds 1
if ($relaunch) {
    # 清理 dist 里其他 exe（当前壳子已被杀，文件不再被占用）
    try {
        Get-ChildItem -LiteralPath (Join-Path $cfg.shellDir 'dist') -Filter '*.exe' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -ne $relaunch } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue; Log "removed stale exe $($_.Name)" }
    } catch { Log "stale exe cleanup: $_" }
    try {
        if ($relaunchArgs.Count -gt 0) {
            Start-Process -FilePath $relaunch -ArgumentList $relaunchArgs -WorkingDirectory $cfg.shellDir
        } else {
            Start-Process -FilePath $relaunch
        }
        Log "relaunched $relaunch"
    } catch { Log "relaunch: $_" }
} else {
    Log 'no relaunch target found — start the shell manually'
}
Set-Progress -stage 'done' -percent 100 -msg '更新完成，壳子已重启'

Log '==== dsh updater done ===='