# 在文件中搜索多个 GBK 词（用 Unicode 码点传入避免编码问题），输出命中上下文
# 用法: powershell -File scripts/search-words.ps1 <文件> <词1码点串>;<词2码点串>;...
param(
  [string]$File,
  [string]$WordsCsv,
  [int]$MaxHits = 4,
  [int]$ContextBytes = 160
)
$enc936 = [System.Text.Encoding]::GetEncoding(950)  # Big5
$latin1 = [System.Text.Encoding]::GetEncoding('latin1')

function SearchWord($file, $word, $maxHits) {
  $pattern = $latin1.GetString($enc936.GetBytes($word))
  $fs = [System.IO.File]::OpenRead($file)
  $chunkSize = 16MB
  $buf = New-Object byte[] $chunkSize
  $pos = [long]0
  $carry = ''
  $hits = @()
  while ($hits.Count -lt $maxHits) {
    $n = $fs.Read($buf, 0, $chunkSize)
    if ($n -le 0) { break }
    $s = $carry + $latin1.GetString($buf, 0, $n)
    $startAt = 0
    while ($true) {
      $idx = $s.IndexOf($pattern, $startAt)
      if ($idx -lt 0) { break }
      $hits += ($pos - $carry.Length + $idx)
      $startAt = $idx + 1
      if ($hits.Count -ge $maxHits) { break }
    }
    $carry = $s.Substring([Math]::Max(0, $s.Length - 4))
    $pos += $n
  }
  $fs.Close()
  return $hits
}

foreach ($entry in $WordsCsv.Split(';')) {
  if (-not $entry) { continue }
  $codePoints = $entry.Split(',') | ForEach-Object { [char][Convert]::ToInt32($_, 16) }
  $word = -join $codePoints
  $hits = SearchWord $File $word $MaxHits
  Write-Host ("=== {0} ({1} hits) ===" -f $word, $hits.Count)
  foreach ($off in $hits) {
    $fs = [System.IO.File]::OpenRead($File)
    $start = [Math]::Max(0, $off - [int]($ContextBytes / 2))
    $null = $fs.Seek($start, 'Begin')
    $ctx = New-Object byte[] $ContextBytes
    $n = $fs.Read($ctx, 0, $ContextBytes)
    $fs.Close()
    $text = $enc936.GetString($ctx, 0, $n)
    $clean = ($text -replace '[\x00-\x08\x0B-\x1F\x7F]+', '|')
    Write-Host ('  0x{0:X}: {1}' -f $off, $clean)
  }
}
