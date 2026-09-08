# 在 pkres 中搜索 GBK 地形名称表（搜索词用 Unicode 码点传入，避免脚本编码问题）
# 用法: powershell -File scripts/find-terrain-names.ps1 <pkres路径> <码点逗号串> [最大命中数]
# 例: 草地 = U+8349,U+5730
param(
  [string]$File = 'C:\san11\san11_原版\San11\Media\san11pkres.bin',
  [string]$CodePoints = '8349,5730',
  [int]$MaxHits = 8
)
$enc936 = [System.Text.Encoding]::GetEncoding(936)
$latin1 = [System.Text.Encoding]::GetEncoding('latin1')

$chars = $CodePoints.Split(',') | ForEach-Object { [char][Convert]::ToInt32($_, 16) }
$word = -join $chars
$pattern = $latin1.GetString($enc936.GetBytes($word))

$fs = [System.IO.File]::OpenRead($File)
$chunkSize = 16MB
$buf = New-Object byte[] $chunkSize
$pos = [long]0
$carry = ''
$hits = @()
while ($hits.Count -lt $MaxHits) {
  $n = $fs.Read($buf, 0, $chunkSize)
  if ($n -le 0) { break }
  $s = $carry + $latin1.GetString($buf, 0, $n)
  $startAt = 0
  while ($true) {
    $idx = $s.IndexOf($pattern, $startAt)
    if ($idx -lt 0) { break }
    $hits += ($pos - $carry.Length + $idx)
    $startAt = $idx + 1
    if ($hits.Count -ge $MaxHits) { break }
  }
  $carry = $s.Substring([Math]::Max(0, $s.Length - 4))
  $pos += $n
}
$fs.Close()

Write-Host ("File: {0}" -f $File)
Write-Host ("Hits: {0}" -f $hits.Count)
foreach ($off in $hits) {
  $fs = [System.IO.File]::OpenRead($File)
  $null = $fs.Seek([Math]::Max(0, $off - 100), 'Begin')
  $ctx = New-Object byte[] 220
  $n = $fs.Read($ctx, 0, 220)
  $fs.Close()
  $text = $enc936.GetString($ctx, 0, $n)
  $clean = ($text -replace '[\x00-\x1F\x7F-\xFF]+', '|')
  Write-Host ('  offset=0x{0:X} ctx={1}' -f $off, $clean)
}
