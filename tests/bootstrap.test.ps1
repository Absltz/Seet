$ErrorActionPreference = 'Stop'
$helper = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts/bootstrap-common.ps1'
if (-not (Test-Path -LiteralPath $helper)) { throw 'Bootstrap offline recovery helpers are missing.' }
. $helper
$fixture = Join-Path $env:TEMP ('Seet-bootstrap-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
function Assert($condition, $message) { if (-not $condition) { throw $message } }
try {
 $payload = Join-Path $fixture 'bundle.zip'
 [IO.File]::WriteAllText($payload, 'verified bundled bytes')
 $asset = [pscustomobject]@{ file='bundle.zip'; sha256=(Get-SeetFileHash $payload); bytes=(Get-Item $payload).Length; url='http://127.0.0.1:1/missing' }
 $target = Join-Path $fixture 'download.zip'
 $script:attempts = 0
 $script:switched = $false
 $resolved = Get-SeetArchive -Asset $asset -BundleRoot $fixture -Destination $target -Download {
  param($url,$destination,$bytes)
  $script:attempts++
  throw 'simulated network failure'
 } -OnFallback { $script:switched = $true }
 Assert ($script:attempts -eq 1) 'Online download must be attempted first.'
 Assert $script:switched 'Offline switch must be visible to the caller.'
 Assert ($resolved -eq $payload) 'Verified local archive must be used after network failure.'
 Assert (-not (Test-Path $target)) 'Partial online download must not be accepted.'
 $script:switched = $false
 $resolved = Get-SeetArchive -Asset $asset -BundleRoot $fixture -Destination $target -Download {
  param($url,$destination,$bytes)
  [IO.File]::WriteAllText($destination, 'verified bundled bytes')
 } -OnFallback { $script:switched = $true }
 Assert ($resolved -eq $target -and -not $script:switched) 'A valid online download must be preferred to the bundled archive.'
 Remove-Item -LiteralPath $target
 $resolved = Get-SeetArchive -Asset $asset -BundleRoot $fixture -Destination $target -Download {
  param($url,$destination,$bytes)
  [IO.File]::WriteAllText($destination, 'corrupt network response')
 } -OnFallback { $script:switched = $true }
 Assert ($resolved -eq $payload -and $script:switched) 'An invalid network checksum must switch to the verified local archive.'
 [IO.File]::WriteAllText($payload, 'tampered bytes')
 $rejected = $false
 try { Get-SeetArchive -Asset $asset -BundleRoot $fixture -Destination $target -Download { throw 'offline' } | Out-Null } catch { $rejected = $true }
 Assert $rejected 'A corrupt offline bundle must never be installed.'
 $source = Join-Path $fixture 'zip-source'
 New-Item -ItemType Directory -Path $source | Out-Null
 [IO.File]::WriteAllBytes((Join-Path $source 'payload.bin'), (New-Object byte[] 170001))
 $zip = Join-Path $fixture 'valid.zip'
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 [IO.Compression.ZipFile]::CreateFromDirectory($source, $zip)
 $script:lastBytes = 0L
 $script:totalBytes = 0L
 Expand-SeetArchive -Path $zip -Destination (Join-Path $fixture 'extracted') -Progress {
  param($current,$total)
  $script:lastBytes = $current
  $script:totalBytes = $total
 }
 Assert ($script:lastBytes -eq 170001 -and $script:totalBytes -eq 170001) 'Extraction progress must report actual uncompressed byte totals.'
 $badZip = Join-Path $fixture 'unsafe.zip'
 $archive = [IO.Compression.ZipFile]::Open($badZip, [IO.Compression.ZipArchiveMode]::Create)
 $entry = $archive.CreateEntry('../escaped.txt')
 $writer = New-Object IO.StreamWriter($entry.Open())
 $writer.Write('unsafe'); $writer.Dispose(); $archive.Dispose()
 $rejected = $false
 try { Expand-SeetArchive -Path $badZip -Destination (Join-Path $fixture 'safe') } catch { $rejected = $true }
 Assert $rejected 'Archive path traversal must be rejected.'
 Assert (-not (Test-Path (Join-Path $fixture 'escaped.txt'))) 'Extraction must stay inside destination.'
 Assert ((Get-SeetArchitecture -NativeArchitecture 'ARM64') -eq 'arm64') 'ARM64 must use its native runtime.'
 Assert ((Get-SeetArchitecture -NativeArchitecture 'AMD64') -eq 'x64') 'AMD64 must use x64 runtime.'
 Assert ((Get-SeetArchitecture) -in @('x64','arm64')) 'Architecture detection must also work without inherited processor environment variables.'
 $rejected = $false
 try { Get-SeetArchitecture -NativeArchitecture 'x86' | Out-Null } catch { $rejected = $true }
 Assert $rejected 'Unsupported 32-bit Windows must get a clear error, not an incompatible runtime.'
 $node = (Get-Command node.exe).Source
 $rejected = $false
 try { Invoke-SeetProcess -FilePath $node -Arguments '-e "process.exit(23)"' -WorkingDirectory $fixture -Label 'fixture' } catch { $rejected = $_.Exception.Message -match '23' }
 Assert $rejected 'Child exit codes must propagate on Windows PowerShell 5.1.'
 $pidFile = Join-Path $fixture 'child.pid'
 $parentScript = Join-Path $fixture 'parent.cjs'
 [IO.File]::WriteAllText($parentScript, 'const fs=require("fs"), cp=require("child_process"); const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"}); fs.writeFileSync(process.argv[2],String(child.pid)); setInterval(()=>{},1000);')
 $rejected = $false
 try { Invoke-SeetProcess -FilePath $node -Arguments ('"'+$parentScript+'" "'+$pidFile+'"') -WorkingDirectory $fixture -Label 'fixture' -Progress {
  if (Test-Path -LiteralPath $pidFile) { throw 'cancel fixture' }
 } } catch { $rejected = $_.Exception.Message -match 'cancel fixture' }
 Assert $rejected 'Cancellation fixture must interrupt the running command.'
 $childId = [int][IO.File]::ReadAllText($pidFile)
 $orphan = Get-Process -Id $childId -ErrorAction SilentlyContinue
 if ($orphan) { Stop-Process -Id $childId -Force }
 Assert (-not $orphan) 'Canceling startup must stop child processes as well as npm.'
 Write-Host 'PASS: online-first recovery, integrity, byte progress, safe extraction and architecture selection.'
} finally {
 $resolvedFixture = [IO.Path]::GetFullPath($fixture)
 if ($resolvedFixture.StartsWith([IO.Path]::GetFullPath($env:TEMP) + [IO.Path]::DirectorySeparatorChar) -and (Split-Path $resolvedFixture -Leaf) -like 'Seet-bootstrap-test-*') {
  Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
 }
}
