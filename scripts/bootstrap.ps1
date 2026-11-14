param(
 [switch]$PrepareOnly,
 [switch]$Offline,
 [switch]$UseBundledRuntime,
 [string]$RuntimeCache = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'bootstrap-common.ps1')
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
Set-Location -LiteralPath $root
# Selecting text in the classic console must not suspend installation.
try {
 Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SeetConsole {
 [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
 [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
 [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint mode);
}
"@
 $handle = [SeetConsole]::GetStdHandle(-10); $mode = [uint32]0
 if ([SeetConsole]::GetConsoleMode($handle,[ref]$mode)) {
  [void][SeetConsole]::SetConsoleMode($handle,(($mode -bor 0x80) -band (-bnot 0x40)))
 }
 $outputHandle = [SeetConsole]::GetStdHandle(-11)
 if ([SeetConsole]::GetConsoleMode($outputHandle,[ref]$mode)) {
  [void][SeetConsole]::SetConsoleMode($outputHandle,($mode -bor 0x4))
 }
} catch { }

function Test-NodeRuntime([string]$Executable,[string]$Architecture) {
 if (-not (Test-Path -LiteralPath $Executable)) { return $false }
 try {
  $probe = & $Executable -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<13))process.exit(1);console.log(JSON.stringify({version:process.version,arch:process.arch}))" 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  $info = $probe | ConvertFrom-Json
  return $info.arch -eq $Architecture -and (Test-Path -LiteralPath (Join-Path (Split-Path $Executable -Parent) 'node_modules/npm/bin/npm-cli.js'))
 } catch { return $false }
}
function Remove-InstallDirectory([string]$Path,[string]$Parent) {
 $absolute = [IO.Path]::GetFullPath($Path)
 $allowed = [IO.Path]::GetFullPath($Parent).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
 if (-not $absolute.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw '安装目录超出预定范围。' }
 if (Test-Path -LiteralPath $absolute) { Remove-Item -LiteralPath $absolute -Recurse -Force }
}

Initialize-SeetDisplay
try {
 Set-SeetStage 1 '检查 Windows 与 Node.js 运行环境'
 $arch = Get-SeetArchitecture
 $bundleRoot = Join-Path $root 'offline'
 $manifestFile = Join-Path $bundleRoot 'manifest.json'
 if (-not (Test-Path -LiteralPath $manifestFile)) { throw '缺少 offline/manifest.json。请保留完整的 Seet 文件夹。' }
 $manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
 $assets = $manifest.platforms.$arch
 if (-not $assets) { throw ('离线包不支持当前架构：' + $arch) }
 $nodePath = $null
 if (-not $UseBundledRuntime) {
  $existing = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($existing -and (Test-NodeRuntime $existing.Source $arch)) { $nodePath = $existing.Source }
 }
 Set-SeetProgress -Detail ("已识别 Windows $arch") -Complete

 Set-SeetStage 2 '准备便携运行环境'
 if (-not $nodePath) {
  if (-not $RuntimeCache) { $RuntimeCache = Join-Path $env:LOCALAPPDATA 'Seet/runtime' }
  [IO.Directory]::CreateDirectory($RuntimeCache) | Out-Null
  $nodeName = 'node-' + $manifest.nodeVersion + '-win-' + $arch
  $nodeDirectory = Join-Path $RuntimeCache $nodeName
  $nodePath = Join-Path $nodeDirectory 'node.exe'
  if (-not (Test-NodeRuntime $nodePath $arch)) {
   $downloadTarget = Join-Path $RuntimeCache ($assets.runtime.file + '.download')
   $runtimeZip = Get-SeetArchive -Asset $assets.runtime -BundleRoot $bundleRoot -Destination $downloadTarget -Download {
    param($url,$destination,$bytes)
    if ($Offline) { throw '已选择离线准备。' }
    Receive-SeetDownload $url $destination $bytes
   } -OnFallback {
    param($reason)
    Write-Host ("    联网下载不可用：$reason") -ForegroundColor Yellow
    Write-Host '    已自动切换到随包 Node.js 环境，正在校验文件。' -ForegroundColor Yellow
    Set-SeetProgress -Detail '已自动切换：校验随包运行环境'
   }
   Write-Host ('    SHA-256 校验通过：' + $assets.runtime.file) -ForegroundColor Gray
   $staging = Join-Path $RuntimeCache ('prepare-' + [Guid]::NewGuid().ToString('N'))
   try {
    Expand-SeetArchive -Path $runtimeZip -Destination $staging -Progress {
     param($current,$total)
     Set-SeetProgress -Detail '正在解压便携运行环境' -Current $current -Total $total
    }
    Remove-InstallDirectory $nodeDirectory $RuntimeCache
    Move-Item -LiteralPath (Join-Path $staging $nodeName) -Destination $nodeDirectory
   } finally { Remove-InstallDirectory $staging $RuntimeCache }
   if (-not (Test-NodeRuntime $nodePath $arch)) { throw '运行环境未能启动。请确认使用 64 位 Windows 10/11，并重新运行启动脚本。' }
  }
  Write-Host ('    使用便携 Node.js ' + $manifest.nodeVersion + ' (' + $arch + ')') -ForegroundColor Gray
 } else {
  Write-Host ('    使用现有 Node.js ' + (& $nodePath -p 'process.version') + ' (' + $arch + ')') -ForegroundColor Gray
 }
 $nodeDirectory = Split-Path $nodePath -Parent
 $env:PATH = $nodeDirectory + ';' + $env:PATH
 $npmCli = Join-Path $nodeDirectory 'node_modules/npm/bin/npm-cli.js'
 Set-SeetProgress -Detail '运行环境已就绪；无需管理员权限' -Complete

 Set-SeetStage 3 '安装并校验项目依赖'
 $lockHash = Get-SeetFileHash (Join-Path $root 'package-lock.json')
 $installKey = $lockHash + (& $nodePath -p 'process.version+process.arch')
 $modules = Join-Path $root 'node_modules'
 $stamp = Join-Path $modules '.seet-install-key'
 $ready = (Test-Path -LiteralPath $stamp) -and (Test-Path -LiteralPath (Join-Path $modules 'vite/package.json')) -and (Get-Content -LiteralPath $stamp -Raw).Trim() -eq $installKey
 if (-not $ready) {
  try {
   if ($Offline) { throw '已选择离线准备。' }
   # package-lock has an empty root key, which Windows PowerShell cannot parse.
   $packageList = & $nodePath -e "const p=require('./package-lock.json').packages;console.log(JSON.stringify(Object.entries(p).filter(([k,v])=>k&&(!v.os||v.os.includes(process.platform))&&(!v.cpu||v.cpu.includes(process.arch))).map(([k])=>k+'/package.json')))"
   $relativePaths = $packageList | ConvertFrom-Json
   $packagePaths = @(foreach ($relativePath in $relativePaths) { Join-Path $root $relativePath })
   Invoke-SeetProcess -FilePath $nodePath -Arguments ('"' + $npmCli + '" ci --include=dev --include=optional --no-audit --no-fund --no-update-notifier --loglevel=info --progress=false --fetch-retries=0 --fetch-timeout=20000') -WorkingDirectory $root -Label '联网安装依赖' -TimeoutSeconds 90 -Progress {
    $written = @($packagePaths | Where-Object { Test-Path -LiteralPath $_ }).Count
    Set-SeetProgress -Detail '正在联网安装；按已写入的依赖包统计，日志见下方' -Current $written -Total $packagePaths.Count -Unit '包'
   }
   # npm can exit 0 after skipping a failed optional native module.
   Invoke-SeetProcess -FilePath $nodePath -Arguments '--input-type=module -e "await import(\"vite\"); await import(\"express\"); await import(\"@napi-rs/canvas\")"' -WorkingDirectory $root -Label '校验联网安装的依赖'
  } catch {
   Write-Host ('    联网安装未完成：' + $_.Exception.Message) -ForegroundColor Yellow
   Write-Host '    已自动切换到随包项目依赖，正在校验并解压。' -ForegroundColor Yellow
   Set-SeetProgress -Detail '已自动切换：校验随包项目依赖'
   if ($lockHash -ne $manifest.lockSha256) { throw '随包依赖与当前 package-lock.json 不一致。请更新离线包或联网重试。' }
   $dependencyZip = Join-Path $bundleRoot $assets.dependencies.file
   if (-not (Test-SeetAsset $assets.dependencies $dependencyZip)) { throw ('随包依赖缺失或损坏：' + $assets.dependencies.file) }
   $staging = Join-Path $root ('.seet-install-' + [Guid]::NewGuid().ToString('N'))
   try {
    Expand-SeetArchive -Path $dependencyZip -Destination $staging -Progress {
     param($current,$total)
     Set-SeetProgress -Detail '正在安装随包项目依赖' -Current $current -Total $total
    }
    Remove-InstallDirectory $modules $root
    Move-Item -LiteralPath (Join-Path $staging 'node_modules') -Destination $modules
   } finally { Remove-InstallDirectory $staging $root }
  }
  Invoke-SeetProcess -FilePath $nodePath -Arguments '--input-type=module -e "await import(\"vite\"); await import(\"express\"); await import(\"@napi-rs/canvas\"); console.log(\"依赖加载校验通过\")"' -WorkingDirectory $root -Label '校验依赖'
  [IO.File]::WriteAllText($stamp,$installKey)
 } else { Write-Host '    依赖与锁文件一致，跳过重复安装。' -ForegroundColor Gray }
 Set-SeetProgress -Detail '项目依赖已就绪' -Complete

 Set-SeetStage 4 '构建网页'
 Invoke-SeetProcess -FilePath $nodePath -Arguments ('"' + $npmCli + '" run build') -WorkingDirectory $root -Label '构建网页'
 Set-SeetProgress -Detail '网页构建完成' -Complete

 Set-SeetStage 5 '启动服务'
 Write-Host ('    准备完成，总用时 ' + [int]$script:seetClock.Elapsed.TotalSeconds + ' 秒。') -ForegroundColor Green
 if ($PrepareOnly) { Set-SeetProgress -Detail '准备检查已完成' -Complete }
 if (-not $PrepareOnly) {
  Set-SeetProgress -Detail '正在启动服务；成功后自动打开网页'
  Write-Host '    关闭此窗口会停止服务。' -ForegroundColor Gray
  $previousProgress = $env:SEET_STARTUP_PROGRESS
  try {
   $env:SEET_STARTUP_PROGRESS = '1'
   & $nodePath (Join-Path $PSScriptRoot 'start.mjs')
   if ($LASTEXITCODE -ne 0) { throw '服务启动失败，请查看上方日志。' }
  } finally { $env:SEET_STARTUP_PROGRESS = $previousProgress }
 }
} catch {
 Write-Host ('    启动未完成：' + $_.Exception.Message) -ForegroundColor Red
 exit 1
}
