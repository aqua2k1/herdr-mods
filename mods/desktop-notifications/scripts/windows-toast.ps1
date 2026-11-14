param(
    [string]$TitleHex = "hex:4865726472",
    [string]$MessageHex = "hex:"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function ConvertFrom-NotificationHex([string]$Value) {
    if ($Value -notmatch '^hex:(?:[0-9a-fA-F]{2})*$') {
        throw "Invalid notification text encoding"
    }
    $hex = $Value.Substring(4)
    $bytes = [byte[]]::new($hex.Length / 2)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16)
    }
    return [Text.Encoding]::UTF8.GetString($bytes)
}

$Title = ConvertFrom-NotificationHex $TitleHex
$Message = ConvertFrom-NotificationHex $MessageHex

# Prefer Herdr's registered identity. WSL/unpackaged installs can use Terminal.
$apps = @(Get-StartApps)
$appId = $apps |
    Where-Object { $_.Name -eq "Herdr" -or $_.AppID -like "*Herdr*" } |
    Select-Object -First 1 -ExpandProperty AppID
if ([string]::IsNullOrWhiteSpace($appId)) {
    $appId = $apps |
        Where-Object { $_.AppID -like "*WindowsTerminal*" } |
        Select-Object -First 1 -ExpandProperty AppID
}
if ([string]::IsNullOrWhiteSpace($appId)) {
    throw "Registered Herdr or Windows Terminal AppUserModelID not found"
}

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02
)
$text = $xml.GetElementsByTagName("text")
[void]$text.Item(0).AppendChild($xml.CreateTextNode($Title))
[void]$text.Item(1).AppendChild($xml.CreateTextNode($Message))

$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$toast.ExpirationTime = [DateTimeOffset]::Now.AddMinutes(1)
$toast.Tag = "herdr-notification"
$toast.Group = "Herdr"
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
