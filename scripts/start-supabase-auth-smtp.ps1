param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $SupabaseArgs
)

$ErrorActionPreference = "Stop"

$envPath = Join-Path (Get-Location) ".env.local"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env.local was not found in the current directory."
}

$requiredKeys = @(
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD"
)

foreach ($line in Get-Content -LiteralPath $envPath) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
    continue
  }

  $key, $value = $trimmed.Split("=", 2)
  $key = $key.Trim()
  if ($requiredKeys -notcontains $key) {
    continue
  }

  $value = $value.Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  Set-Item -Path "Env:$key" -Value $value
}

foreach ($key in $requiredKeys) {
  if (-not (Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue).Value) {
    throw "$key is required in .env.local for Supabase Auth SMTP."
  }
}

if ($SupabaseArgs.Count -gt 0) {
  & supabase @SupabaseArgs
  exit $LASTEXITCODE
}

& supabase stop
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& supabase start
exit $LASTEXITCODE
