# conversation-done-card.ps1 - desktop bottom-right "conversation done" card
# usage: powershell -NoProfile -ExecutionPolicy Bypass -STA -File conversation-done-card.ps1
#        -ExePath <shell exe> -IconPath <png icon> -Title <name> -Message <text> [-DurationMs 10000] [-SoundPath <wav>]
# - single instance: a card already showing exits this one (no stacking)
# - click card: launch shell exe (its single-instance lock focuses the main window), then close
# - no click: fade out after DurationMs
# - SoundPath: play the wav asynchronously while the card shows (host-side playback,
#   bypasses the browser autoplay policy that blocks audio.play() without user gesture)

param(
  [string]$ExePath = '',
  [string]$IconPath = '',
  [string]$Title = 'DeepSeek-Harness',
  [string]$Message = 'Conversation done',
  [int]$DurationMs = 10000,
  [string]$SoundPath = '',
  [string]$SessionLabel = ''
)

$ErrorActionPreference = 'Stop'
$logFile = 'D:\AI\Dsh\conversation-card.log'
function Log($m) {
  try { Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -Encoding UTF8 } catch {}
}

# IconPath 缺省时探测常见 PNG（host 未传时也能显示图标；PNG 文件方案比 exe 提取稳定）
if (-not $IconPath) {
  foreach ($candidate in @('D:\AI\Dsh\assets\app-icon.png', "$env:USERPROFILE\.dsh\profiles\web\plugins\dsh-task-done-sound\assets\app-icon.png")) {
    if (Test-Path $candidate) { $IconPath = $candidate; break }
  }
}

# single instance: skip when another card is showing
$mutex = New-Object System.Threading.Mutex($false, 'Local\DshConversationCard')
$acquired = $false
try { $acquired = $mutex.WaitOne(0) } catch { $acquired = $true }
if (-not $acquired) {
  Log "skipped: mutex busy - another card is showing (this completion does not pop)"
  exit 0
}
Log "show: title=$Title msg=$Message session=$SessionLabel exe=$ExePath icon=$IconPath sound=$SoundPath"

try {
  Add-Type -AssemblyName PresentationFramework
  Add-Type -AssemblyName PresentationCore
  Add-Type -AssemblyName WindowsBase
  Add-Type -AssemblyName System.Drawing

  # host-side hint sound (async; process lives for the card duration, plenty for a short wav)
  if ($SoundPath -and (Test-Path $SoundPath)) {
    try {
      $player = New-Object System.Media.SoundPlayer $SoundPath
      $player.Play()
      Log "sound: playing $SoundPath"
    } catch {
      Log ("sound ERROR: " + $_.Exception.Message)
    }
  }

  # theme -> card colors
  $light = 1
  try { $light = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction Stop).AppsUseLightTheme } catch {}
  $isDark = ($light -eq 0)
  $bg = if ($isDark) { '#2A2A30' } else { '#FFFFFF' }
  $border = if ($isDark) { '#4A4A55' } else { '#E0E0E4' }
  $hoverBg = if ($isDark) { '#34343C' } else { '#F3F3F6' }
  $fg = if ($isDark) { '#F5F5F7' } else { '#1B1B1F' }
  $fg2 = if ($isDark) { '#B8B8C2' } else { '#60606A' }

  # icon: PNG file first, then exe extraction, then system icon
  $iconSrc = $null
  if ($IconPath -and (Test-Path $IconPath)) {
    try {
      $bi = New-Object System.Windows.Media.Imaging.BitmapImage
      $bi.BeginInit()
      $bi.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
      $bi.UriSource = New-Object System.Uri($IconPath)
      $bi.EndInit()
      $bi.Freeze()
      $iconSrc = $bi
    } catch { $iconSrc = $null }
  }
  if ($null -eq $iconSrc -and $ExePath -and (Test-Path $ExePath)) {
    try {
      $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)
      if ($ico -and $ico.Handle -ne [IntPtr]::Zero) {
        # 纯托管路径：Icon → Bitmap → PNG 流 → BitmapImage。
        # 不用 GetHbitmap/CreateBitmapSourceFromHBitmap（HBITMAP 偶发无效时返回 null，
        # 且句柄需手动释放；PNG 流方案稳定且无 GDI 残留）。
        $bmp = $ico.ToBitmap()
        if ($bmp) {
          $ms = New-Object System.IO.MemoryStream
          try {
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $ms.Position = 0
            $bi = New-Object System.Windows.Media.Imaging.BitmapImage
            $bi.BeginInit()
            $bi.StreamSource = $ms
            $bi.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
            $bi.EndInit()
            $bi.Freeze()
            $iconSrc = $bi
          } finally {
            $ms.Dispose()
          }
          $bmp.Dispose(); $ico.Dispose()
          Log 'icon: extracted from exe'
        } else {
          Log 'icon: ToBitmap returned null'
        }
      } elseif ($null -eq $ico) {
        Log 'icon: exe extract returned null'
      } else {
        Log 'icon: exe icon has null handle'
      }
    } catch {
      Log ("icon ERROR(line " + $_.InvocationInfo.ScriptLineNumber + "): " + $_.Exception.Message)
      $iconSrc = $null
    }
  } elseif ($null -eq $iconSrc) {
    Log 'icon: skipped (no exe)'
  }

  # window: bottom-right, borderless, transparent, topmost, no taskbar
  $win = New-Object System.Windows.Window
  $win.WindowStyle = [System.Windows.WindowStyle]::None
  $win.AllowsTransparency = $true
  $win.Background = [System.Windows.Media.Brushes]::Transparent
  $win.Topmost = $true
  $win.ShowInTaskbar = $false
  $win.ResizeMode = [System.Windows.ResizeMode]::NoResize
  $win.UseLayoutRounding = $true
  $win.Width = 340
  $win.Height = 88
  $work = [System.Windows.SystemParameters]::WorkArea
  $win.Left = $work.Right - $win.Width - 18
  $win.Top = $work.Bottom - $win.Height - 18

  # card body
  $card = New-Object System.Windows.Controls.Border
  $card.CornerRadius = New-Object System.Windows.CornerRadius(14)
  $card.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($bg))
  $card.BorderBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($border))
  $card.BorderThickness = New-Object System.Windows.Thickness(1)
  $card.Padding = New-Object System.Windows.Thickness(16, 12, 16, 12)

  # grid: [icon | text column]
  $grid = New-Object System.Windows.Controls.Grid
  $colIcon = New-Object System.Windows.Controls.ColumnDefinition
  $colIcon.Width = New-Object System.Windows.GridLength(44)
  $colText = New-Object System.Windows.Controls.ColumnDefinition
  $colText.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
  $grid.ColumnDefinitions.Add($colIcon) | Out-Null
  $grid.ColumnDefinitions.Add($colText) | Out-Null

  # left: icon
  $iconBox = New-Object System.Windows.Controls.Grid
  if ($null -ne $iconSrc) {
    $img = New-Object System.Windows.Controls.Image
    $img.Source = $iconSrc
    $img.Width = 40
    $img.Height = 40
    $img.Stretch = [System.Windows.Media.Stretch]::Uniform
    $img.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
    $img.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $iconBox.Children.Add($img) | Out-Null
  }
  [System.Windows.Controls.Grid]::SetColumn($iconBox, 0)
  $grid.Children.Add($iconBox) | Out-Null

  # right: session label (main) + status line
  $textStack = New-Object System.Windows.Controls.StackPanel
  $textStack.Orientation = [System.Windows.Controls.Orientation]::Vertical
  $textStack.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $textStack.Margin = New-Object System.Windows.Thickness(12, 0, 0, 0)

  # 主行 = 会话标题（client 上报），无标题时回退到 Message；副行 = 状态文案
  $hasLabel = ($SessionLabel -and $SessionLabel.Trim() -ne '')
  $mainLabel = if ($hasLabel) { $SessionLabel } else { $Message }
  $subLabel = if ($hasLabel) { '对话完成了' } else { '点击打开' }

  $titleBlock = New-Object System.Windows.Controls.TextBlock
  $titleBlock.Text = $mainLabel
  $titleBlock.FontSize = 14
  $titleBlock.FontWeight = [System.Windows.FontWeights]::SemiBold
  $titleBlock.Foreground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($fg))
  # 单行 + 超长截断（…），长会话标题不会撑爆卡片
  $titleBlock.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
  $titleBlock.TextWrapping = [System.Windows.TextWrapping]::NoWrap
  $titleBlock.MaxWidth = 236
  $textStack.Children.Add($titleBlock) | Out-Null

  $msgBlock = New-Object System.Windows.Controls.TextBlock
  $msgBlock.Text = $subLabel
  $msgBlock.FontSize = 12.5
  $msgBlock.Margin = New-Object System.Windows.Thickness(0, 4, 0, 0)
  $msgBlock.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $msgBlock.Foreground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($fg2))
  $textStack.Children.Add($msgBlock) | Out-Null

  [System.Windows.Controls.Grid]::SetColumn($textStack, 1)
  $grid.Children.Add($textStack) | Out-Null

  $card.Child = $grid
  $win.Content = $card

  # click: launch shell exe (single-instance lock focuses the window) and close card
  $card.Add_MouseLeftButtonUp({
    try {
      if ($ExePath -and (Test-Path $ExePath)) {
        Start-Process -FilePath $ExePath -WindowStyle Normal
      } elseif ($Title -ne '') {
        Start-Process -FilePath $Title -WindowStyle Normal
      }
    } catch {}
    Log 'clicked: launch exe'
    $win.Close()
  })

  # hover highlight
  $card.Add_MouseEnter({ $card.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($hoverBg)) })
  $card.Add_MouseLeave({ $card.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($bg)) })

  $win.Show()

  # fade in
  $fadeIn = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, [TimeSpan]::FromMilliseconds(250))
  $win.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeIn)

  # timeout fade out
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds($DurationMs)
  $timer.Add_Tick({
    $timer.Stop()
    Log 'timeout: fade out'
    $fadeOut = New-Object System.Windows.Media.Animation.DoubleAnimation(1, 0, [TimeSpan]::FromMilliseconds(450))
    $fadeOut.add_Completed([System.EventHandler]{ param($s, $e) $win.Close() })
    $win.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeOut)
  })
  $timer.Start()

  Log 'card shown'
  $app = New-Object System.Windows.Application
  $app.Run($win) | Out-Null
  Log 'card closed'
} catch {
  Log ("ERROR(line " + $_.InvocationInfo.ScriptLineNumber + "): " + $_.Exception.Message)
} finally {
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
