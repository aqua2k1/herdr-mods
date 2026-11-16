param([string]$Path, [long]$Offset = 0, [int]$Count = 1048576, [string]$Expected = '')
# Passed inline; compatible with Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$stream = $null
$sha = $null
try {
    if ($Offset -lt 0 -or $Offset -gt 5242880 -or $Count -lt 0 -or $Count -gt 1048576) { throw 'Invalid image range' }
    # Deny writers/replacement for this request, then check the full version on every request.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $size = $stream.Length
    if ($size -gt 5242880) { throw 'Image exceeds 5 MiB' }
    $before = [IO.File]::GetLastWriteTimeUtc($Path).Ticks.ToString() + ':' + [IO.File]::GetCreationTimeUtc($Path).Ticks
    $buffer = New-Object byte[] 5242881
    $actual = 0
    while ($actual -lt $buffer.Length) {
        $n = $stream.Read($buffer, $actual, $buffer.Length - $actual)
        if ($n -eq 0) { break }
        $actual += $n
    }
    if ($actual -gt 5242880) { throw 'Image exceeds 5 MiB during read' }
    if ($actual -ne $size) { throw 'Image changed during read' }
    $sha = [Security.Cryptography.SHA256]::Create()
    $digest = [Convert]::ToBase64String($sha.ComputeHash($buffer, 0, $actual))
    $versionBytes = [Text.Encoding]::UTF8.GetBytes($before + ':' + $digest)
    $version = ([BitConverter]::ToString($sha.ComputeHash($versionBytes))).Replace('-', '').ToLowerInvariant()
    if ($Expected -and $Expected -cne $version) { throw 'Image changed between chunks' }
    if ($Offset -gt $size) { throw 'Invalid image offset' }
    $length = [int][Math]::Min($Count, $size - $Offset)
    $chunks = [int][Math]::Ceiling($size / 1048576.0)
    $after = [IO.File]::GetLastWriteTimeUtc($Path).Ticks.ToString() + ':' + [IO.File]::GetCreationTimeUtc($Path).Ticks
    if ($before -cne $after -or $stream.Length -ne $size) { throw 'Image changed during read' }
    [Console]::Write("FILES_PLUS_IMAGE_V2`n$Offset`n$size`n$chunks`n$length`n$version`n")
    [Console]::Write([Convert]::ToBase64String($buffer, [int]$Offset, $length))
    [Console]::Write("`n")
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -ne $sha) { $sha.Dispose() }
}
