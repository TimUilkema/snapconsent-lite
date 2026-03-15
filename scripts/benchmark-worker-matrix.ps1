param(
  [string]$Token = "<MATCHING_WORKER_TOKEN>",
  [string]$WorkerUri = "http://localhost:3000/api/internal/matching/worker",
  [int[]]$WorkerCounts = @(1, 2, 4, 6),
  [int[]]$BatchSizes = @(10),
  [int]$Rounds = 2,
  [int]$MaxSucceededPerRun = 100,
  [string]$ProviderConcurrencyTag = "unset"
)

function Invoke-WorkerFleet {
  param(
    [int]$Workers,
    [int]$BatchSize,
    [string]$Token,
    [string]$WorkerUri,
    [int]$MaxSucceededPerRun
  )

  $start = Get-Date
  $workerIds = 1..$Workers | ForEach-Object {
    "bench-w$Workers-rand-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  }

  $totalClaimed = 0
  $totalSucceeded = 0
  $totalRetried = 0
  $totalDead = 0
  $totalCalls = 0
  $emptyTickStreak = 0

  while ($true) {
    $jobs = $workerIds | ForEach-Object {
      $wid = $_
      Start-Job -ScriptBlock {
        param($wid, $BatchSize, $Token, $WorkerUri)
        $body = @{ batchSize = $BatchSize; workerId = $wid } | ConvertTo-Json -Compress
        $res = Invoke-RestMethod -Method POST -Uri $WorkerUri `
          -Headers @{ Authorization = "Bearer $Token" } `
          -ContentType "application/json" `
          -Body $body

        [pscustomobject]@{
          workerId = $wid
          claimed = [int]$res.claimed
          succeeded = [int]$res.succeeded
          retried = [int]$res.retried
          dead = [int]$res.dead
        }
      } -ArgumentList $wid, $BatchSize, $Token, $WorkerUri
    }

    Wait-Job $jobs | Out-Null
    $rows = Receive-Job $jobs
    Remove-Job $jobs | Out-Null

    $tickClaimed = ($rows | Measure-Object claimed -Sum).Sum
    $tickSucceeded = ($rows | Measure-Object succeeded -Sum).Sum
    $tickRetried = ($rows | Measure-Object retried -Sum).Sum
    $tickDead = ($rows | Measure-Object dead -Sum).Sum

    $totalCalls += $Workers
    $totalClaimed += $tickClaimed
    $totalSucceeded += $tickSucceeded
    $totalRetried += $tickRetried
    $totalDead += $tickDead

    if ($tickClaimed -eq 0) { $emptyTickStreak++ } else { $emptyTickStreak = 0 }
    if ($totalSucceeded -ge $MaxSucceededPerRun) { break }
    if ($emptyTickStreak -ge 2) { break }
  }

  $elapsed = ((Get-Date) - $start).TotalSeconds

  [pscustomobject]@{
    providerConcurrency = $ProviderConcurrencyTag
    workers = $Workers
    batchSize = $BatchSize
    elapsedSec = [math]::Round($elapsed, 2)
    calls = $totalCalls
    claimed = $totalClaimed
    succeeded = $totalSucceeded
    retried = $totalRetried
    dead = $totalDead
    jobsPerSec = [math]::Round(($totalSucceeded / [math]::Max($elapsed, 0.001)), 3)
  }
}

$results = @()

Write-Host "Run config: providerConcurrencyTag=$ProviderConcurrencyTag, batchSizes=$($BatchSizes -join ','), workers=$($WorkerCounts -join ','), rounds=$Rounds, maxSucceededPerRun=$MaxSucceededPerRun"

foreach ($b in $BatchSizes) {
  foreach ($w in $WorkerCounts) {
    for ($r = 1; $r -le $Rounds; $r++) {
      Write-Host "`n=== batchSize=$b workers=$w round=$r ==="
      Write-Host "Target cap: $MaxSucceededPerRun succeeded jobs this run."
      Write-Host "Make sure queue has backlog before this run. Press Enter to start..."
      Read-Host | Out-Null

      $res = Invoke-WorkerFleet `
        -Workers $w `
        -BatchSize $b `
        -Token $Token `
        -WorkerUri $WorkerUri `
        -MaxSucceededPerRun $MaxSucceededPerRun
      $res | Add-Member -NotePropertyName round -NotePropertyValue $r
      $results += $res
      $res | Format-List
    }
  }
}

Write-Host "`n=== Raw Results ==="
$results | Sort-Object batchSize, workers, round | Format-Table -AutoSize

$summary = $results |
  Group-Object -Property providerConcurrency, batchSize, workers |
  ForEach-Object {
    $rows = $_.Group
    [pscustomobject]@{
      providerConcurrency = [string]$rows[0].providerConcurrency
      batchSize = [int]$rows[0].batchSize
      workers = [int]$rows[0].workers
      rounds = $rows.Count
      avgJobsPerSec = [math]::Round((($rows | Measure-Object jobsPerSec -Average).Average), 3)
      minJobsPerSec = [math]::Round((($rows | Measure-Object jobsPerSec -Minimum).Minimum), 3)
      maxJobsPerSec = [math]::Round((($rows | Measure-Object jobsPerSec -Maximum).Maximum), 3)
      avgSucceeded = [math]::Round((($rows | Measure-Object succeeded -Average).Average), 1)
      avgElapsedSec = [math]::Round((($rows | Measure-Object elapsedSec -Average).Average), 2)
    }
  }

Write-Host "`n=== Summary (avg/min/max by batchSize+workers) ==="
$summary | Sort-Object providerConcurrency, batchSize, workers | Format-Table -AutoSize

Write-Host "`n=== Best Config By Avg Throughput ==="
$summary | Sort-Object avgJobsPerSec -Descending | Select-Object -First 5 | Format-Table -AutoSize
