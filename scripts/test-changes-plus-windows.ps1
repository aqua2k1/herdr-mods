param([string]$Repo = '', [string]$Herdr = '', [switch]$Keep)
# Real native Windows GUI test for Changes Plus. Only this temporary app home/window is changed.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$utf8 = [Text.UTF8Encoding]::new($false)
if (-not $Herdr) {
    $found = Get-Command herdr-app.exe -ErrorAction SilentlyContinue
    $Herdr = if ($found) { $found.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe' }
}
if (-not $Repo) { $Repo = Split-Path $PSScriptRoot -Parent }
$root = Join-Path ([IO.Path]::GetTempPath()) ('changes-plus-win-' + [guid]::NewGuid())
$homeDir = Join-Path $root 'app'
$fixtures = Join-Path $root 'fixtures'
[IO.Directory]::CreateDirectory((Join-Path $homeDir 'mods')) > $null
[IO.Directory]::CreateDirectory((Join-Path $homeDir 'layouts')) > $null
[IO.Directory]::CreateDirectory((Join-Path $fixtures 'nested')) > $null
$oldHome = $env:HERDR_APP_HOME; $oldTelemetry = $env:HERDR_TELEMETRY
$process = $null; $tab = $null; $remoteTab = $null; $passed = $false; $checks = @()
$sideSerial = 0; $previewSerial = 0
function Invoke-Herdr([string[]]$CliArgs) {
    $text = & $Herdr @CliArgs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "herdr-app $($CliArgs -join ' ') failed: $text" }
    return $text.Trim()
}
function Invoke-Git([string[]]$GitArgs, [switch]$AllowFailure) {
    # git writes LF/CRLF warnings to stderr; PowerShell 5.1 turns that into a
    # terminating error under Stop, so keep those warnings as plain text here.
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & git -C $fixtures @GitArgs 2>&1 | Out-String; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    if ($code -ne 0 -and -not $AllowFailure) { throw "git $($GitArgs -join ' ') failed: $out" }
    return $out
}
function Invoke-GitAt([string]$cwd, [string[]]$GitArgs) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & git -C $cwd @GitArgs 2>&1 | Out-String; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    if ($code -ne 0) { throw "git $($GitArgs -join ' ') failed: $out" }
    return $out
}
function Write-Text([string]$path, [string]$text) { [IO.File]::WriteAllText($path, $text, $utf8) }
function Wait-State([string]$file, [int]$after) {
    $path = Join-Path $homeDir $file
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-Path -LiteralPath $path) {
            try { $v = [IO.File]::ReadAllText($path, $utf8) | ConvertFrom-Json; if ($v.serial -gt $after) { return $v } } catch { }
        }
        Start-Sleep -Milliseconds 100
    }
    return $null
}
function Get-Snapshot([string]$name) {
    Invoke-Herdr @('do', 'changes-plus.snapshot') | Out-Null
    $side = Wait-State 'driver-state.json' $script:sideSerial
    if (-not $side) { throw 'Sidebar snapshot not delivered' }
    $script:sideSerial = $side.serial
    $preview = $null
    $diffPanes = @($side.panes | Where-Object { $_.mod -eq 'changes-plus' -and $_.tab -eq $script:tab })
    if ($diffPanes.Count -gt 0) {
        Invoke-Herdr @('do', 'changes-plus.preview-snapshot') | Out-Null
        $preview = Wait-State 'preview-state.json' $script:previewSerial
        if ($preview) { $script:previewSerial = $preview.serial }
    }
    $report = @{ sidebar = $side; preview = $preview; status = (Invoke-Herdr @('status') | ConvertFrom-Json) }
    Write-Text (Join-Path $root ($name + '.json')) ($report | ConvertTo-Json -Depth 10)
    if (@($report.status.errors).Count -gt 0) { throw (@($report.status.errors) -join '; ') }
    return @{ state = $side; previewState = $preview; panes = @($side.panes | Where-Object { $_.tab -eq $script:tab }) }
}
function Wait-Loaded {
    for ($i = 0; $i -lt 120; $i++) {
        $s = Get-Snapshot 'latest'
        if (-not $s.state.loading -and @($s.state.files).Count -gt 0) { return $s }
        Start-Sleep -Milliseconds 500
    }
    throw 'Timed out waiting for Git status to load'
}
function Wait-Commits {
    for ($i = 0; $i -lt 120; $i++) {
        $s = Get-Snapshot 'latest'
        if (-not $s.state.commitsLoading -and @($s.state.commits).Count -gt 0 -and @($s.state.historyGroups).Count -gt 0) { return $s }
        Start-Sleep -Milliseconds 300
    }
    throw 'Timed out waiting for commit history'
}
function Wait-CommitFiles {
    for ($i = 0; $i -lt 120; $i++) {
        $s = Get-Snapshot 'latest'
        if (-not $s.state.commitFilesLoading -and @($s.state.commitFiles).Count -gt 0) { return $s }
        Start-Sleep -Milliseconds 300
    }
    throw 'Timed out waiting for commit files'
}
function Wait-Panes([int]$count) {
    for ($i = 0; $i -lt 50; $i++) {
        $s = Get-Snapshot 'latest'
        if ($s.panes.Count -eq $count) { return $s }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for $count workarea panes"
}
try {
    # A real repository: modified, untracked and conflicted files.
    $lines = 1..24 | ForEach-Object { "line $_" }
    Write-Text (Join-Path $fixtures 'sample.txt') (($lines -join "`n") + "`n")
    Write-Text (Join-Path $fixtures 'nested\code.ts') "export const n = 1;`n"
    Invoke-Git @('init', '-q')
    Invoke-Git @('config', 'user.email', 'test@example.com')
    Invoke-Git @('config', 'user.name', 'Test')
    Invoke-Git @('config', 'core.autocrlf', 'false')
    Invoke-Git @('add', '-A')
    Invoke-Git @('commit', '-qm', 'base')
    # A local bare remote with the base pushed gives the Commits tab a real
    # unpushed group to read (no network, no fetch).
    $remote = Join-Path $root 'remote.git'
    Invoke-GitAt $root @('init', '--bare', '-q', $remote)
    Invoke-Git @('remote', 'add', 'origin', $remote)
    $baseBranch = (Invoke-Git @('branch', '--show-current')).Trim()
    Invoke-Git @('push', '-q', '-u', 'origin', $baseBranch)
    Invoke-Git @('symbolic-ref', 'refs/remotes/origin/HEAD', "refs/remotes/origin/$baseBranch")
    Invoke-Git @('checkout', '-qb', 'other')
    Write-Text (Join-Path $fixtures 'nested\code.ts') "export const n = 2; // incoming`n"
    Invoke-Git @('commit', '-qam', 'other')
    Invoke-Git @('checkout', '-q', '-')
    Write-Text (Join-Path $fixtures 'nested\code.ts') "export const n = 3; // ours`n"
    Invoke-Git @('commit', '-qam', 'ours')
    Invoke-Git @('merge', 'other') -AllowFailure | Out-Null
    $changed = 1..25 | ForEach-Object { if ($_ -eq 13) { 'line 13 CHANGED' } else { "line $_" } }
    Write-Text (Join-Path $fixtures 'sample.txt') (($changed -join "`n") + "`n")
    Write-Text (Join-Path $fixtures 'untracked.md') "# brand new`n`nUntracked file line`n"
    $fixtureStatus = Invoke-Git @('status', '--porcelain=v1')
    if ($fixtureStatus -notmatch 'UU nested/code.ts') { throw 'Conflict fixture missing' }

    # Install the unmodified production mod plus a test-only driver subclass.
    $install = Join-Path $homeDir 'mods\changes-plus'
    Copy-Item -LiteralPath (Join-Path $Repo 'mods\changes-plus') -Destination $install -Recurse
    Copy-Item -LiteralPath (Join-Path $Repo 'mods\changes-plus') -Destination (Join-Path $install 'production') -Recurse
    $driver = @'
import ChangesPlus from './production/main.js';
import { groupCommits } from './production/lib/commits.js';
import { panes, focused, shared, settings, props, appHome } from 'herdr';
import * as fs from 'fs/promises';
export default class Driver extends ChangesPlus {
 command(command, cx) {
  const files = { 'open:modified': 'sample.txt', 'open:untracked': 'untracked.md', 'open:conflict': 'nested/code.ts' };
  if (files[command] && !this.preview) return this.pick(files[command], cx);
  if (command === 'full' && !this.preview) return this.toggleFull(cx);
  if (command === 'commits' && !this.preview) return this.setTab('commit', cx);
  if (command === 'changes' && !this.preview) return this.setTab('changes', cx);
  if (command === 'restored-commits' && !this.preview) { this.tab = 'commit'; this.selectedCommit = null; this.commits = []; return this.refresh(cx); }
  if (command === 'snapshot' && !this.preview) {
   const t = focused()?.tab;
   const value = { serial: this.serial = (this.serial || 0) + 1, panes: panes(), focused: focused(), settings: settings(), props: props(),
    preview: this.preview, files: this.files, groups: this.groups, open: this.open, full: this.fullFile, on: this.on,
    context: this.context, root: this.root, on: this.on, loading: this.loading, busy: this.busy,
    tab: this.tab, commits: this.commits, commitsLoading: this.commitsLoading, commitsError: this.commitsError,
    remote: this.remote, branch: this.branch, historyGroups: this.tab === 'commit' && !this.selectedCommit
      ? groupCommits({ commits: this.commits, remote: this.remote, remoteHead: this.remoteHead, behind: this.behind, branch: this.branch, done: this.commitsDone }) : [],
    selectedCommit: this.selectedCommit, commitFiles: this.commitFiles, commitFilesLoading: this.commitFilesLoading,
    request: t ? shared('changes-plus.diff.' + t) : null };
   cx.spawn(async () => { await fs.writeFile(appHome() + '/driver-state.json', JSON.stringify(value)); });
   return;
  }
  if (command === 'preview-snapshot' && this.preview) {
   const r = this.req();
   const value = { serial: this.serial = (this.serial || 0) + 1, panes: panes(), props: props(), preview: true,
    rows: this.rows, full: this.fullFile, request: r ? shared(r.channel) : null, note: this.note };
   cx.spawn(async () => { await fs.writeFile(appHome() + '/preview-state.json', JSON.stringify(value)); });
   return;
  }
  return super.command(command, cx);
 }
}
'@
    Write-Text (Join-Path $install 'main.js') $driver
    Write-Text (Join-Path $homeDir 'shared.json') '{"frame.welcomed":"finished","workspace.panels":["files","changes"]}'
    Write-Text (Join-Path $homeDir 'settings.json') '{"zoom":1,"font":"FiraCode Nerd Font","font_size":20,"sounds":{"enabled":false}}'
    $env:HERDR_APP_HOME = $homeDir; $env:HERDR_TELEMETRY = '0'
    $version = Invoke-Herdr @('--version')
    Invoke-Herdr @('check', $install) | Out-Null
    $checks += 'herdr-app check passed on native Windows'

    $process = Start-Process -FilePath $Herdr -WorkingDirectory $root -RedirectStandardOutput (Join-Path $root 'stdout.log') -RedirectStandardError (Join-Path $root 'stderr.log') -PassThru
    $ready = $false
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep -Milliseconds 300
        try { Invoke-Herdr @('status') | Out-Null; $ready = $true; break } catch { }
    }
    if (-not $ready) { throw 'Isolated native window did not start' }
    Invoke-Herdr @('do', 'overlay.close', '--id', 'frame-welcome') | Out-Null

    # Clone the freshly shipped layout, keeping the active-tab workarea.
    $layout = [IO.File]::ReadAllText((Join-Path $homeDir 'layouts\main.json'), $utf8) | ConvertFrom-Json
    function Patch-Layout($node) {
        if ($node.id -eq 'panel') { $node.hidden = $false }
        if ($node.content -and $node.content.mod -eq 'changes') { $node.content.mod = 'changes-plus' }
        foreach ($child in @($node.children)) { if ($child) { Patch-Layout $child } }
    }
    Patch-Layout $layout
    Write-Text (Join-Path $homeDir 'layouts\changes-plus-win.json') (($layout | ConvertTo-Json -Depth 14))

    $created = Invoke-Herdr @('do', 'tab.new', '--name', ('ChangesPlusWin' + [guid]::NewGuid().ToString('N').Substring(0, 6)), '--folder', $fixtures) | ConvertFrom-Json
    $script:tab = $created.tab
    if (-not $script:tab) { throw "Could not create dedicated test tab: $created" }
    Invoke-Herdr @('do', 'tab.select', '--id', $script:tab) | Out-Null
    Invoke-Herdr @('do', 'layout.switch', '--name', 'changes-plus-win') | Out-Null
    Start-Sleep -Milliseconds 1400
    Invoke-Herdr @('do', 'layout.select', '--stack', 'panel-body', '--child', 'changes') | Out-Null
    Invoke-Herdr @('do', 'layout.show', '--id', 'panel') | Out-Null
    Invoke-Herdr @('do', 'changes-plus.refresh') | Out-Null
    $s = Wait-Loaded
    $s = Get-Snapshot '01-groups'
    if ($s.state.preview) { throw 'Sidebar copy has preview role' }
    if ($s.state.settings.font_size -ne 20) { throw 'Terminal font size was not read from settings' }
    $keys = @($s.state.groups | ForEach-Object { $_.key })
    if (($keys -join ',') -ne 'conflicts,changed,untracked') { throw "Unexpected groups: $($keys -join ',')" }
    if (-not @($s.state.groups | Where-Object { $_.key -eq 'conflicts' } | ForEach-Object { $_.files } | Where-Object { $_.path -eq 'nested/code.ts' }).Count) { throw 'Conflict not listed' }
    if (-not @($s.state.groups | Where-Object { $_.key -eq 'changed' } | ForEach-Object { $_.files } | Where-Object { $_.path -eq 'sample.txt' }).Count) { throw 'Modified file not listed' }
    if (-not @($s.state.groups | Where-Object { $_.key -eq 'untracked' } | ForEach-Object { $_.files } | Where-Object { $_.path -eq 'untracked.md' }).Count) { throw 'Untracked file not listed' }
    if ($s.panes.Count -ne 1) { throw 'Expected one workarea pane before opening a diff' }
    $shot = Join-Path $root '01-sidebar-groups.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'native Windows layout: Conflicts / Changed / Untracked sections'

    Invoke-Herdr @('do', 'changes-plus.open:modified') | Out-Null
    $s = Wait-Panes 2
    Start-Sleep -Milliseconds 700
    $s = Get-Snapshot '02-diff-split'
    $previewPane = @($s.panes | Where-Object { $_.mod -eq 'changes-plus' })[0]
    if (-not $previewPane) { throw 'No diff pane created' }
    if ($s.state.request.file -ne 'sample.txt') { throw "Wrong shared request: $($s.state.request.file)" }
    if (-not @($s.previewState.rows | Where-Object { $_.kind -eq '@' }).Count) { throw 'No hunk header in unified diff' }
    if (-not @($s.previewState.rows | Where-Object { $_.kind -eq '+' -and $_.newNo -ne $null }).Count) { throw 'No numbered added line' }
    $shot = Join-Path $root '02-unified-diff.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'click splits a native right pane with a unified diff and line numbers'

    $rowsBefore = @($s.previewState.rows).Count
    Invoke-Herdr @('do', 'changes-plus.full') | Out-Null
    Start-Sleep -Milliseconds 900
    $s = Get-Snapshot '02b-full-file'
    if (-not $s.state.full) { throw 'Full-file state not shared' }
    if (@($s.previewState.rows).Count -le ($rowsBefore + 10)) { throw 'Full file did not show the whole file' }
    $shot = Join-Path $root '02b-full-file-toggle.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'Full file toggles to the whole file on native Windows'
    Invoke-Herdr @('do', 'changes-plus.full') | Out-Null
    Start-Sleep -Milliseconds 900

    $revision = $s.state.request.revision
    Invoke-Herdr @('do', 'changes-plus.open:untracked') | Out-Null
    Start-Sleep -Milliseconds 700
    $s = Get-Snapshot '03-reuse'
    if ($s.panes.Count -ne 2) { throw 'A second pane was opened instead of reusing' }
    $again = @($s.panes | Where-Object { $_.mod -eq 'changes-plus' })[0]
    if ($again.pane -ne $previewPane.pane) { throw 'Diff pane was not reused' }
    if ($s.state.request.file -ne 'untracked.md' -or $s.state.request.revision -eq $revision) { throw 'Shared request was not updated' }
    if (-not @($s.previewState.rows | Where-Object { $_.kind -eq '+' -and $_.text -eq '# brand new' }).Count) { throw 'Untracked file content missing from diff' }
    $shot = Join-Path $root '03-reused-untracked.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'same-tab diff pane reused; shared request and revision updated'

    # Commits tab: real local bare remote, unpushed grouping, commit files and diff.
    Invoke-Herdr @('do', 'changes-plus.full') | Out-Null
    Invoke-Herdr @('do', 'changes-plus.commits') | Out-Null
    $s = Wait-Commits
    $s = Get-Snapshot '07-commits-groups'
    if ($s.state.tab -ne 'commit') { throw 'Commits tab not selected' }
    if (@($s.state.commits).Count -lt 2) { throw 'Commit history is empty' }
    $scopes = @($s.state.historyGroups | ForEach-Object { $_.scope })
    if (($scopes -join ',') -ne 'branch,remote') { throw "Unexpected commit groups: $($scopes -join ',')" }
    $shot = Join-Path $root '07-commits-tabs.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'Commits tab reads real history with unpushed/remote groups'
    $commit = @($s.state.commits | Where-Object { $_.subject -eq 'ours' })[0]
    if (-not $commit) { $commit = $s.state.commits[0] }
    Invoke-Herdr @('do', ('changes-plus.commit:' + $commit.short)) | Out-Null
    $s = Wait-CommitFiles
    $s = Get-Snapshot '08-commit-detail'
    if (-not $s.state.selectedCommit) { throw 'Commit was not opened' }
    if (-not @($s.state.commitFiles | Where-Object { $_.path -eq 'nested/code.ts' }).Count) { throw 'Commit files missing' }
    $shot = Join-Path $root '08-commit-files.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'opening a commit lists the files it changed'
    Invoke-Herdr @('do', 'changes-plus.open:nested/code.ts') | Out-Null
    Start-Sleep -Milliseconds 800
    $s = Get-Snapshot '09-commit-diff'
    if ($s.state.request.scope -ne 'commit') { throw 'Commit diff request scope missing' }
    if ($s.state.request.commit.hash -ne $s.state.selectedCommit.hash) { throw 'Wrong commit hash in diff request' }
    if (-not @($s.previewState.rows | Where-Object { $_.kind -eq '@' }).Count) { throw 'No unified hunk in commit diff' }
    $shot = Join-Path $root '09-commit-unified-diff.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'commit file reuses the unified diff pane via git show'
    Invoke-Herdr @('do', 'changes-plus.restored-commits') | Out-Null
    $s = Wait-Commits
    if (@($s.state.commits).Count -lt 2) { throw 'Restored Commits tab did not load history' }
    $shot = Join-Path $root '09b-restored-commits.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'restored Commits tab loads history without a pill click'
    Invoke-Herdr @('do', 'changes-plus.changes') | Out-Null

    # A remote POSIX folder must run Git on its machine. A local run on Windows
    # fails with os error 267 ("directory name invalid").
    $remoteCreated = Invoke-Herdr @('do', 'space.new', '--machine', 'wsl-arch', '--folder', '/home/mingzi47/Projects/herdr-mods', '--name', ('ChangesPlusRemote' + [guid]::NewGuid().ToString('N').Substring(0, 6))) | ConvertFrom-Json
    $script:remoteTab = $remoteCreated.tab
    if (-not $script:remoteTab) { throw "Could not create remote tab: $remoteCreated" }
    Invoke-Herdr @('do', 'tab.select', '--id', $script:remoteTab) | Out-Null
    Invoke-Herdr @('do', 'layout.select', '--stack', 'panel-body', '--child', 'changes') | Out-Null
    Invoke-Herdr @('do', 'layout.show', '--id', 'panel') | Out-Null
    Start-Sleep -Seconds 3
    $s = Get-Snapshot '10-remote-posix'
    if ($s.state.on -ne 'wsl-arch') { throw "Remote folder was not routed to its machine: on=$($s.state.on)" }
    if ($s.state.context.on -ne 'wsl-arch') { throw "Refresh context lost the machine: context.on=$($s.state.context.on)" }
    if ($s.state.error) { throw "Remote Git read failed: $($s.state.error)" }
    $shot = Join-Path $root '10-remote-posix.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'remote POSIX folder runs Git on its machine, not locally on Windows'
    Invoke-Herdr @('do', 'tab.select', '--id', $script:tab) | Out-Null

    Invoke-Herdr @('do', 'pane.close', '--pane', $previewPane.pane) | Out-Null
    $s = Wait-Panes 1
    $s = Wait-Loaded
    if (@($s.state.groups).Count -ne 3) { throw 'Sidebar groups lost after closing the diff' }
    $shot = Join-Path $root '04-close-keeps-sidebar.png'
    Invoke-Herdr @('shot', $shot) | Out-Null
    $checks += 'closing the diff leaves the sidebar intact'
    $passed = $true
} catch { $failure = $_.Exception.Message } finally {
    if ($process -and -not ($Keep -and $passed)) {
        try { Invoke-Herdr @('do', 'window.close') | Out-Null } catch { }
        if (-not $process.HasExited) { Start-Sleep -Seconds 2 }
        if (-not $process.HasExited) { $process.Kill() }
    }
    if ($script:tab -and -not ($Keep -and $passed)) {
        try { Invoke-Herdr @('do', 'tab.close', '--id', $script:tab, '--confirmed', 'true') | Out-Null } catch { }
    }
    if ($script:remoteTab -and -not ($Keep -and $passed)) {
        try { Invoke-Herdr @('do', 'tab.close', '--id', $script:remoteTab, '--confirmed', 'true') | Out-Null } catch { }
    }
    $report = @{ passed = $passed; version = $version; checks = $checks; root = $root; home = $homeDir; error = $failure; kept = ($Keep -and $passed) }
    Write-Text (Join-Path $root 'results.json') ($report | ConvertTo-Json -Depth 8)
    [Console]::WriteLine(($report | ConvertTo-Json -Depth 8 -Compress))
    $env:HERDR_APP_HOME = $oldHome; $env:HERDR_TELEMETRY = $oldTelemetry
}
if (-not $passed) { exit 1 }
