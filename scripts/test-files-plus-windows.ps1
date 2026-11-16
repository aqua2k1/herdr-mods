param([string]$Herdr = '', [switch]$Keep)
# Real native Windows GUI test. Only this temporary app home/window is changed.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$utf8 = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
if (-not $Herdr) {
    $found = Get-Command herdr-app.exe -ErrorAction SilentlyContinue
    $Herdr = if ($found) { $found.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe' }
}
$repo = Split-Path $PSScriptRoot -Parent
$root = Join-Path ([IO.Path]::GetTempPath()) ('files-plus-win-' + [guid]::NewGuid())
$homeDir = Join-Path $root 'app'
$fixtures = Join-Path $root 'fixtures'
$oldHome = $env:HERDR_APP_HOME; $oldTelemetry = $env:HERDR_TELEMETRY
$process = $null; $passed = $false; $checks = @()
function Invoke-Herdr([string[]]$CliArgs) {
    $text = & $Herdr @CliArgs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw $text }
    return $text.Trim()
}
function Write-TestLayout([string]$file) {
    $props = @{ role='preview'; root=$fixtures; file=$file }
    if (-not $file) { $props = @{ root=$fixtures } }
    $layout = @{id='windows-media-test';type='block';content=@{mod='files-plus';props=$props}}
    [IO.File]::WriteAllText((Join-Path $homeDir 'layouts\windows-media-test.json'), ($layout | ConvertTo-Json -Depth 8), $utf8)
}
function Assert-Visible([string]$name, [string]$source, [string]$extension) {
    $shot = Join-Path $root ($name + '.png')
    $expected = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $deadline = [DateTime]::UtcNow.AddSeconds(50)
    do {
        Start-Sleep -Milliseconds 600
        $assets = @(Get-ChildItem -LiteralPath (Join-Path $homeDir 'layouts\files-plus-assets') -Filter ('*.'+$extension) -File -Recurse -ErrorAction SilentlyContinue)
        $matches = @($assets | Where-Object { $_.Length -gt 0 -and (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash -eq $expected })
        if ($matches.Count -eq 0) { continue }
        Invoke-Herdr -CliArgs @('shot',$shot) | Out-Null
        $bitmap = [Drawing.Bitmap]::new($shot)
        $hits = 0
        try {
            for ($y=150; $y -lt $bitmap.Height; $y+=12) {
                for ($x=0; $x -lt $bitmap.Width; $x+=12) {
                    $c=$bitmap.GetPixel($x,$y)
                    if ([Math]::Abs($c.R-24)+[Math]::Abs($c.G-50)+[Math]::Abs($c.B-76) -lt 20) { $hits++ }
                }
            }
        } finally { $bitmap.Dispose() }
        if ($hits -gt 100) { return }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw ('Image not rendered/checksummed: ' + $name + '; artifacts: ' + $root)
}
try {
    [IO.Directory]::CreateDirectory((Join-Path $homeDir 'mods')) > $null
    [IO.Directory]::CreateDirectory((Join-Path $homeDir 'layouts')) > $null
    [IO.Directory]::CreateDirectory($fixtures) > $null
    Copy-Item -LiteralPath (Join-Path $repo 'mods\files-plus') -Destination (Join-Path $homeDir 'mods\files-plus') -Recurse
    [IO.File]::WriteAllText((Join-Path $homeDir 'shared.json'), '{"frame.welcomed":"finished"}', $utf8)
    [IO.File]::WriteAllText((Join-Path $homeDir 'settings.json'), '{"zoom":1}', $utf8)
    $png = Join-Path $fixtures ('image-' + [char]0x56fe + [char]0x7247 + " 'test.png")
    $jpg = Join-Path $fixtures 'photo.jpg'
    $bitmap = [Drawing.Bitmap]::new(1600,1000)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([Drawing.Color]::FromArgb(24,50,76))
        $graphics.DrawRectangle([Drawing.Pens]::Orange,400,250,800,500)
        $bitmap.Save($png,[Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Save($jpg,[Drawing.Imaging.ImageFormat]::Jpeg)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    $boundary = Join-Path $fixtures 'boundary.png'
    [IO.File]::Copy($png,$boundary)
    $stream=[IO.File]::OpenWrite($boundary); try { $stream.SetLength(5242880) } finally { $stream.Dispose() }
    $env:HERDR_APP_HOME=$homeDir; $env:HERDR_TELEMETRY='0'
    $version=Invoke-Herdr -CliArgs @('--version')
    Invoke-Herdr -CliArgs @('check',(Join-Path $homeDir 'mods\files-plus')) | Out-Null
    Write-TestLayout ([IO.Path]::GetFileName($png))
    $process=Start-Process -FilePath $Herdr -WorkingDirectory $root -RedirectStandardOutput (Join-Path $root 'stdout.log') -RedirectStandardError (Join-Path $root 'stderr.log') -PassThru
    $ready=$false
    for ($n=0;$n -lt 60;$n++) {
        Start-Sleep -Milliseconds 300
        try { Invoke-Herdr -CliArgs @('status') | Out-Null; $ready=$true; break } catch { }
    }
    if (-not $ready) { throw 'Native window did not start' }
    Invoke-Herdr -CliArgs @('do','layout.switch','--name','windows-media-test') | Out-Null
    Assert-Visible '01-png-fit' $png 'png'; $checks+='native PNG display and exact cache checksum, Unicode/quote path'
    Invoke-Herdr -CliArgs @('do','files-plus.actual') | Out-Null
    Assert-Visible '02-png-100' $png 'png'; $checks+='100%'
    Invoke-Herdr -CliArgs @('do','files-plus.zoom-in') | Out-Null
    Assert-Visible '03-png-125' $png 'png'; $checks+='zoom in'
    Write-TestLayout 'photo.jpg'
    Assert-Visible '04-jpeg' $jpg 'jpg'; $checks+='native JPEG display and exact cache checksum'
    Write-TestLayout 'boundary.png'
    Assert-Visible '05-png-5MiB' $boundary 'png'; $checks+='exact 5 MiB, no oversized argv'
    Write-TestLayout ''
    Start-Sleep -Seconds 2
    # A restored core tab can contain unrelated, hidden MOD panes. Only our
    # fixture hashes belong to this test's preview; never count another pane.
    $fixtureHashes=@($png,$jpg,$boundary | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash })
    $remaining=@(Get-ChildItem -LiteralPath (Join-Path $homeDir 'layouts\files-plus-assets') -File -Recurse -ErrorAction SilentlyContinue | Where-Object {
        $_.Extension -in @('.png','.jpg') -and $fixtureHashes -contains (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    })
    $staged=@(Get-ChildItem -LiteralPath (Join-Path $homeDir 'data\files-plus-staging') -File -Recurse -ErrorAction SilentlyContinue)
    if ($remaining.Count -or $staged.Count) { throw 'Cached/staged media not cleaned' }
    $checks+='cache and staging cleanup'
    $status=Invoke-Herdr -CliArgs @('status') | ConvertFrom-Json
    if (@($status.errors).Count) { throw ($status.errors | Out-String) }
    $passed=$true
} catch { $failure=$_.Exception.Message }
finally {
    if ($process -and -not ($Keep -and $passed)) {
        try { Invoke-Herdr -CliArgs @('do','window.close') | Out-Null } catch { }
    }
    $report=@{passed=$passed;version=$version;checks=$checks;root=$root;home=$homeDir;error=$failure;kept=($Keep -and $passed)}
    [IO.File]::WriteAllText((Join-Path $root 'results.json'),($report | ConvertTo-Json -Depth 8),$utf8)
    [Console]::WriteLine(($report | ConvertTo-Json -Depth 8 -Compress))
    $env:HERDR_APP_HOME=$oldHome; $env:HERDR_TELEMETRY=$oldTelemetry
}
if (-not $passed) { exit 1 }
