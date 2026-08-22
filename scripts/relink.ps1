# 重建 dsh-webui 的 node_modules junction 链接
# 用途：npm install（尤其 --legacy-peer-deps）会删除 build.sh 创建的 junction，
#       导致构建/typecheck 报 "找不到模块"。运行本脚本即可恢复。
# 用法：powershell -ExecutionPolicy Bypass -File scripts/relink.ps1
param(
  [string]$Checkout = 'D:\AI\deepseek-harness'
)

$ErrorActionPreference = 'Stop'
$nm = Join-Path $PSScriptRoot '..\node_modules'

$linkScript = @'
const fs=require('fs');const path=require('path');
const link=path.resolve(process.argv[1]);const target=path.resolve(process.argv[2]);
fs.rmSync(link,{recursive:true,force:true});
fs.mkdirSync(path.dirname(link),{recursive:true});
fs.symlinkSync(target,link,'junction');
'@

function Link($name, $target) {
  if (-not (Test-Path $target)) { Write-Warning "target missing, skip: $name -> $target"; return }
  node -e $linkScript (Join-Path $nm $name) $target | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "link failed: $name" }
  Write-Host "OK: $name"
}

# vendor + @deepseek-ai + 外部目录（相对 checkout 或绝对路径）
$checkoutMappings = [ordered]@{
  'cordis' = 'vendor/cordis'
  'cosmokit' = 'vendor/cosmokit'
  'schemastery' = 'vendor/schemastery'
  '@deepseek-ai/cordis' = 'vendor/cordis'
  '@deepseek-ai/dsh-client-runtime' = 'packages/client/runtime'
  '@deepseek-ai/dsh-client-ui-slots' = 'packages/client/ui-slots'
  '@deepseek-ai/dsh-client-ui-conversation' = 'packages/client/ui-conversation'
  '@deepseek-ai/dsh-client-ui-primitives' = 'packages/client/ui-primitives'
  '@deepseek-ai/dsh-client-ui-layout' = 'packages/client/ui-layout'
  '@deepseek-ai/dsh-client-locale' = 'packages/client/locale'
  '@deepseek-ai/dsh-llm' = 'packages/llm/llm'
  '@deepseek-ai/dsh-agent' = 'packages/core/agent'
  '@deepseek-ai/dsh-api-remotes' = 'packages/api/remotes'
  '@deepseek-ai/dsh-client-connection' = 'packages/client/connection'
  '@deepseek-ai/dsh-client-schema-form' = 'packages/client/schema-form'
  '@deepseek-ai/dsh-client-ui-attachment' = 'packages/client/ui-attachment'
  '@deepseek-ai/dsh-client-ui-model-selection' = 'packages/client/ui-model-selection'
  '@deepseek-ai/dsh-client-ui-settings' = 'packages/client/ui-settings'
  '@deepseek-ai/dsh-client-ui-theme' = 'packages/client/ui-theme'
  '@deepseek-ai/dsh-client-ui-sidebar' = 'packages/client/ui-sidebar'
  '@deepseek-ai/dsh-client-ui-tool' = 'packages/client/ui-tool'
  '@deepseek-ai/dsh-client-ui-input-trigger' = 'packages/client/ui-input-trigger'
  '@deepseek-ai/dsh-credentials' = 'packages/credentials/credentials'
  '@deepseek-ai/dsh-launch-environment' = 'packages/util/launch-environment'
  '@deepseek-ai/dsh-settings' = 'packages/settings/settings'
  '@deepseek-ai/dsh-tools' = 'packages/core/tools'
  '@deepseek-ai/dsh-web' = 'packages/web/web'
  '@deepseek-ai/schemastery' = 'vendor/schemastery'
  'dsh-usage-skill' = 'D:/AI/Dsh/dsh-usage-skill'
  '@types/node' = 'node_modules/@types/node'
}

foreach ($e in $checkoutMappings.GetEnumerator()) {
  $rel = $e.Value
  $t = if ($rel -match '^[A-Za-z]:[\\/]') { $rel } else { Join-Path $Checkout $rel }
  Link $e.Key $t
}

# react 全家桶（从 pnpm store）
$storeMappings = @(
  @{ name = 'react'; store = 'react@*' },
  @{ name = 'react-dom'; store = 'react-dom@*' },
  @{ name = '@types/react'; store = '@types+react@*' },
  @{ name = '@types/react-dom'; store = '@types+react-dom@*' }
)
foreach ($m in $storeMappings) {
  $store = Get-ChildItem "$Checkout\node_modules\.pnpm" -Directory -ErrorAction SilentlyContinue |
    Where-Object Name -like $m.store | Select-Object -First 1
  if ($store) { Link $m.name (Join-Path $store.FullName "node_modules\$($m.name)") }
}

Write-Host "done. junction count: " -NoNewline
Write-Host (Get-ChildItem "$nm\@deepseek-ai" -Force | Where-Object LinkType -eq 'Junction').Count
