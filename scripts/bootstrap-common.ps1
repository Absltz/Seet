# Windows PowerShell 5.1-compatible startup helpers. No machine-wide installation.
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-SeetFileHash([string]$Path) {
 $stream = [IO.File]::OpenRead($Path)
 $hasher = [Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','') }
 finally { $hasher.Dispose(); $stream.Dispose() }
}

function Get-SeetArchitecture([string]$NativeArchitecture) {
 if (-not $NativeArchitecture) {
  $NativeArchitecture = $env:PROCESSOR_ARCHITEW6432
  if (-not $NativeArchitecture) { $NativeArchitecture = $env:PROCESSOR_ARCHITECTURE }
  if (-not $NativeArchitecture) {
   try { $NativeArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch { }
  }
 }
 switch ($NativeArchitecture.ToUpperInvariant()) {
  'ARM64' { return 'arm64' }
  'AMD64' { return 'x64' }
  'X64' { return 'x64' }
  default { throw '本离线包需要 64 位 Windows 10/11（x64 或 ARM64）。' }
 }
}

function Test-SeetAsset($Asset, [string]$Path) {
 if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
 if ($Asset.bytes -and (Get-Item -LiteralPath $Path).Length -ne [long]$Asset.bytes) { return $false }
 return (Get-SeetFileHash $Path) -eq $Asset.sha256
}

function Get-SeetArchive {
 param($Asset, [string]$BundleRoot, [string]$Destination, [scriptblock]$Download, [scriptblock]$OnFallback)
 try {
  & $Download $Asset.url $Destination $Asset.bytes
  if (-not (Test-SeetAsset $Asset $Destination)) { throw '下载文件未通过 SHA-256 校验。' }
  return $Destination
 } catch {
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
  if ($OnFallback) { & $OnFallback $_.Exception.Message }
  $local = Join-Path $BundleRoot $Asset.file
  if (-not (Test-SeetAsset $Asset $local)) { throw ('随包文件缺失或损坏：' + $Asset.file + '。请重新获取完整的 Seet 文件夹。') }
  return $local
 }
}

function Expand-SeetArchive {
 param([string]$Path, [string]$Destination, [scriptblock]$Progress)
 $destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
 $archive = [IO.Compression.ZipFile]::OpenRead($Path)
 try {
  # Validate all paths before writing any entry.
  foreach ($entry in $archive.Entries) {
   $target = [IO.Path]::GetFullPath((Join-Path $destinationRoot $entry.FullName))
   if (-not $target.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase) -or $entry.FullName -match ':') {
    throw '安装包包含不安全的文件路径。'
   }
  }
  $total = [long]($archive.Entries | Measure-Object -Property Length -Sum).Sum
  $current = 0L
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $nextUpdate = 0L
  $buffer = New-Object byte[] 131072
  foreach ($entry in $archive.Entries) {
   $target = [IO.Path]::GetFullPath((Join-Path $destinationRoot $entry.FullName))
   if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) {
    [IO.Directory]::CreateDirectory($target) | Out-Null
    continue
   }
   [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
   $inputStream = $entry.Open()
   $outputStream = [IO.File]::Create($target)
   try {
    while (($count = $inputStream.Read($buffer,0,$buffer.Length)) -gt 0) {
     $outputStream.Write($buffer,0,$count)
     $current += $count
     if ($Progress -and $clock.ElapsedMilliseconds -ge $nextUpdate) {
      & $Progress $current $total
      $nextUpdate = $clock.ElapsedMilliseconds + 150
     }
    }
   } finally { $outputStream.Dispose(); $inputStream.Dispose() }
  }
  if ($Progress) { & $Progress $current $total }
 } finally { $archive.Dispose() }
}

function Initialize-SeetDisplay {
 $script:seetStage = 1
 $script:seetTitle = '检查运行环境'
 $script:seetClock = [Diagnostics.Stopwatch]::StartNew()
 $script:seetLastPrint = -5000
 $script:seetLastDetail = ''
 $script:seetInteractive = $false
 try { $script:seetInteractive = -not [Console]::IsOutputRedirected -and [Console]::WindowWidth -ge 60 } catch { }
 Write-Host ''
 Write-Host '  见数 Seet | 启动准备' -ForegroundColor Green
 Write-Host '  优先联网安装；失败时自动切换到已校验的随包环境。' -ForegroundColor DarkGray
 if ($script:seetInteractive) { 1..6 | ForEach-Object { Write-Host '' } }
 Write-Host '  运行日志' -ForegroundColor DarkGray
}

function Set-SeetProgress {
 param([string]$Detail, [long]$Current=-1, [long]$Total=0, [string]$Unit='MB', [switch]$Complete)
 if (-not $script:seetClock) { return }
 $elapsed = [int]$script:seetClock.Elapsed.TotalSeconds
 $percent = if ($Total -gt 0 -and $Current -ge 0) { [math]::Min(100,[math]::Floor(100*$Current/$Total)) } elseif ($Complete) {100} else {-1}
 # package.json can exist before a native binary has finished extracting.
 if ($Unit -eq '包' -and -not $Complete) { $percent = -1 }
 $filled = if ($percent -ge 0) { [int][math]::Floor($percent/5) } else { ($elapsed % 18)+1 }
 $bar = if ($percent -ge 0) { ('#' * $filled).PadRight(20,'-') } else { (' ' * ($filled-1) + '>>>').PadRight(20,' ') }
 $amount = if ($Total -gt 0 -and $Current -ge 0) {
  if ($Unit -eq 'MB') { '{0:N1} / {1:N1} MB' -f ($Current/1MB),($Total/1MB) } else { "$Current / $Total $Unit" }
 } else { '处理中' }
 if ($Complete) { $amount = '已完成' }
 $completedStages = if ($Complete -and $script:seetStage -eq 5) {5} else {$script:seetStage-1}
 $lines = @(
  '  见数 Seet | 启动准备',
  ('  总体 [' + ('#' * $completedStages).PadRight(5,'-') + "] 第 $script:seetStage/5 阶段"),
  ('  ' + $script:seetTitle),
  ("  [$bar] " + $(if($percent -ge 0){"$percent%  "}else{''}) + $amount + " | ${elapsed} 秒"),
  ('  ' + $Detail),
  '  ------------------------------------------------------'
 )
 if ($script:seetInteractive) {
  try {
   $left = [Console]::CursorLeft; $top = [Console]::CursorTop
   $visibleTop = [Console]::WindowTop
   $width = [math]::Max(58, [Console]::WindowWidth-2)
   for ($i=0; $i -lt $lines.Count; $i++) {
    [Console]::SetCursorPosition(0,$visibleTop+$i)
    # Chinese glyphs take two columns in the classic console.
    $text = ''; $columns = 0
    foreach ($character in $lines[$i].ToCharArray()) {
    $nextColumns = $columns + $(if ([int]$character -gt 255) {2} else {1})
     if ($nextColumns -gt $width) { break }
     $columns = $nextColumns
     $text += $character
    }
    [Console]::Write($text + (' ' * [math]::Max(0,$width-$columns)))
   }
   [Console]::SetCursorPosition($left,[math]::Max($top,$visibleTop+7))
  } catch { $script:seetInteractive = $false }
 }
 if (-not $script:seetInteractive -and ($Complete -or $Detail -ne $script:seetLastDetail -or $script:seetClock.ElapsedMilliseconds-$script:seetLastPrint -ge 5000)) {
  Write-Host ("  [$script:seetStage/5] $script:seetTitle | $amount | $Detail") -ForegroundColor DarkCyan
  $script:seetLastPrint = $script:seetClock.ElapsedMilliseconds
 }
 $script:seetLastDetail = $Detail
}

function Set-SeetStage([int]$Number, [string]$Title) {
 $script:seetStage = $Number
 $script:seetTitle = $Title
 Write-Host ("  第 $Number/5 阶段：$Title") -ForegroundColor Green
 Set-SeetProgress -Detail '正在准备'
}

function Receive-SeetDownload {
 param([string]$Url, [string]$Destination, [long]$ExpectedBytes=0)
 [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
 $client = New-Object Net.WebClient
 $clock = [Diagnostics.Stopwatch]::StartNew()
 $lastChange = 0L
 $previousBytes = -1L
 try {
  # Transfer runs on .NET's worker thread. UI polling never throttles the download.
  $task = $client.DownloadFileTaskAsync([Uri]$Url,$Destination)
  while (-not $task.IsCompleted) {
   $current = if (Test-Path -LiteralPath $Destination) { (Get-Item -LiteralPath $Destination).Length } else {0L}
   if ($current -ne $previousBytes) { $lastChange = $clock.ElapsedMilliseconds; $previousBytes = $current }
   if ($clock.ElapsedMilliseconds-$lastChange -gt 20000 -or $clock.Elapsed.TotalSeconds -gt 60) {
    $client.CancelAsync()
    throw '下载长时间无响应，或已超过本次联网等待时间。'
   }
   Set-SeetProgress -Detail '正在下载官方运行环境' -Current $current -Total $ExpectedBytes
   Start-Sleep -Milliseconds 150
  }
  $task.GetAwaiter().GetResult()
  Set-SeetProgress -Detail '下载完成，正在校验 SHA-256' -Current (Get-Item -LiteralPath $Destination).Length -Total $ExpectedBytes
 } finally { $client.Dispose() }
}

function Invoke-SeetProcess {
 param([string]$FilePath, [string]$Arguments, [string]$WorkingDirectory, [string]$Label, [scriptblock]$Progress, [int]$TimeoutSeconds=0)
 $process = New-Object Diagnostics.Process
 $process.StartInfo = New-Object Diagnostics.ProcessStartInfo
 $process.StartInfo.FileName = $FilePath
 $process.StartInfo.Arguments = $Arguments
 $process.StartInfo.WorkingDirectory = $WorkingDirectory
 $process.StartInfo.UseShellExecute = $false
 $process.StartInfo.CreateNoWindow = $true
 $process.StartInfo.RedirectStandardOutput = $true
 $process.StartInfo.RedirectStandardError = $true
 $process.StartInfo.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
 $process.StartInfo.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
 $clock = [Diagnostics.Stopwatch]::StartNew()
 $started = $false
 try {
  [void]$process.Start()
  $started = $true
  $readers = @($process.StandardOutput,$process.StandardError)
  $pending = @($readers[0].ReadLineAsync(),$readers[1].ReadLineAsync())
  $done = @($false,$false)
  $nextUpdate = 0L
  while (-not ($process.HasExited -and $done[0] -and $done[1])) {
   if ($TimeoutSeconds -gt 0 -and $clock.Elapsed.TotalSeconds -gt $TimeoutSeconds) { throw ("$Label 超过等待时间，将继续使用随包环境。") }
   for ($i=0; $i -lt 2; $i++) {
    while (-not $done[$i] -and $pending[$i].IsCompleted) {
     $line = $pending[$i].GetAwaiter().GetResult()
     if ($null -eq $line) { $done[$i] = $true; break }
     Write-Host ('    ' + ($line -replace '\x1B\[[0-9;]*[A-Za-z]','')) -ForegroundColor Gray
     $pending[$i] = $readers[$i].ReadLineAsync()
    }
   }
   if ($clock.ElapsedMilliseconds -ge $nextUpdate) {
    if ($Progress) { & $Progress } else { Set-SeetProgress -Detail ("正在$Label；日志实时显示在下方") }
    $nextUpdate = $clock.ElapsedMilliseconds+500
   }
   Start-Sleep -Milliseconds 60
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw ("$Label 失败，退出码 " + $process.ExitCode) }
 } finally {
  if ($started -and -not $process.HasExited) {
   # npm -> cmd -> vite must all stop on cancellation, including on PS 5.1.
   $killer = New-Object Diagnostics.Process
   $killer.StartInfo = New-Object Diagnostics.ProcessStartInfo
   $killer.StartInfo.FileName = Join-Path $env:SystemRoot 'System32/taskkill.exe'
   $killer.StartInfo.Arguments = '/PID ' + $process.Id + ' /T /F'
   $killer.StartInfo.UseShellExecute = $false
   $killer.StartInfo.CreateNoWindow = $true
   $killer.StartInfo.RedirectStandardOutput = $true
   $killer.StartInfo.RedirectStandardError = $true
   try { [void]$killer.Start(); $killer.WaitForExit() } finally { $killer.Dispose() }
   if (-not $process.HasExited) { $process.Kill() }
   $process.WaitForExit()
  }
  $process.Dispose()
 }
}
