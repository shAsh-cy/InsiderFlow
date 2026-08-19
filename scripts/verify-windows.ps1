<#
.SYNOPSIS
  Verification probes for InsiderFlow that work on Windows PowerShell 5.1.

.DESCRIPTION
  Every probe PRINTS an unambiguous status and body. That is the whole design
  constraint, and it comes from two failures on this project:

    * `curl -X POST -d '{...}'` in PowerShell does not run curl. `curl` is an
      ALIAS for Invoke-WebRequest, so `-X` and `-d` are parsed as PowerShell
      parameters and the request that goes out is nothing like the one written.
      The observed symptoms were `bad_json` and "URL rejected".

    * `Invoke-RestMethod` inside try/catch swallows the response body on
      Windows PowerShell 5.1. `$_.ErrorDetails.Message` is empty there, so the
      catch block prints nothing and SILENCE READS AS SUCCESS. A command that
      can produce silence is the same failure class as an assertion that
      cannot fail.

  So: Invoke-WebRequest, and a catch that reads `$_.Exception.Response` through
  a StreamReader (5.1) or `$_.ErrorDetails.Message` (7+). Never silent.

.EXAMPLE
  .\scripts\verify-windows.ps1 -BaseUrl http://localhost:3000

.EXAMPLE
  .\scripts\verify-windows.ps1 -BaseUrl https://insiderflow.vercel.app `
      -SupabaseUrl https://abcdef.supabase.co -SupabaseAnonKey sb_publishable_...
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$SupabaseUrl,
  [string]$SupabaseAnonKey,
  # Cloudflare's documented ALWAYS-PASSES test secret. Swap for the real one
  # to check a real key; never commit a real one.
  [string]$TurnstileSecret = "1x0000000000000000000000000000000AA",
  [switch]$SkipTurnstile,
  [switch]$SkipSupabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 can still default to TLS 1.0 on an unpatched box,
# which fails against every host below with a connection error that looks
# like an outage.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
  Write-Host "note: could not pin TLS 1.2 ($($_.Exception.Message))"
}

$script:Failures = 0

function Write-Result {
  param([string]$Label, [bool]$Ok, [string]$Detail)
  $tag = if ($Ok) { "PASS" } else { "FAIL"; }
  if (-not $Ok) { $script:Failures++ }
  Write-Host ("    [{0}] {1}{2}" -f $tag, $Label, $(if ($Detail) { " -- $Detail" } else { "" }))
}

<#
  The one function everything else uses.

  Returns an object with Status, Body and Headers, and ALWAYS prints both.
  `-1` is the status when no HTTP response came back at all (DNS, TLS, refused
  connection) -- distinguishable from a real status, and never confusable with
  success.
#>
function Invoke-Probe {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Uri,
    [string]$Method = "GET",
    [hashtable]$RequestHeaders,
    $Body,
    [string]$ContentType,
    [int]$BodyPreview = 600
  )

  # NOT $args: that is an automatic variable and assigning it inside a
  # function is a good way to lose an afternoon.
  $params = @{
    Uri             = $Uri
    Method          = $Method
    UseBasicParsing = $true
    TimeoutSec      = 30
    ErrorAction     = "Stop"
  }
  if ($RequestHeaders) { $params.Headers = $RequestHeaders }
  if ($null -ne $Body) { $params.Body = $Body }
  if ($ContentType) { $params.ContentType = $ContentType }

  $status = $null
  $text = $null
  $headers = $null

  try {
    $response = Invoke-WebRequest @params
    $status = [int]$response.StatusCode
    $text = $response.Content
    $headers = $response.Headers
  } catch {
    $response = $null
    # `$_.Exception.Response` is HttpWebResponse on 5.1 and
    # HttpResponseMessage on 7+. Neither exists for a transport failure.
    if ($_.Exception | Get-Member -Name Response -ErrorAction SilentlyContinue) {
      $response = $_.Exception.Response
    }

    if ($null -ne $response) {
      try { $status = [int]$response.StatusCode } catch { $status = -1 }
      try { $headers = $response.Headers } catch { $headers = $null }

      # THE LINE THAT MATTERS ON 5.1. Invoke-RestMethod would have left the
      # body unreachable here, which is how a failing probe prints nothing.
      $stream = $null
      if ($response | Get-Member -Name GetResponseStream -ErrorAction SilentlyContinue) {
        try {
          $stream = $response.GetResponseStream()
          $reader = New-Object System.IO.StreamReader($stream)
          $text = $reader.ReadToEnd()
          $reader.Dispose()
        } catch {
          $text = $null
        }
      }
      # PowerShell 7+ path, and the 5.1 fallback if the stream was consumed.
      if ([string]::IsNullOrEmpty($text)) {
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $text = $_.ErrorDetails.Message }
      }
    } else {
      $status = -1
      $text = "no HTTP response: $($_.Exception.Message)"
    }
  }

  if ($null -eq $status) { $status = -1 }
  if ([string]::IsNullOrEmpty($text)) { $text = "<empty body>" }

  $shown = if ($text.Length -gt $BodyPreview) { $text.Substring(0, $BodyPreview) + " ...[truncated]" } else { $text }

  Write-Host ""
  Write-Host ("=== {0}" -f $Name)
  Write-Host ("    {0} {1}" -f $Method.ToUpper(), $Uri)
  Write-Host ("    STATUS: {0}" -f $status)
  Write-Host ("    BODY  : {0}" -f $shown)

  [pscustomobject]@{ Name = $Name; Status = $status; Body = $text; Headers = $headers }
}

# ── 1. Turnstile siteverify ────────────────────────────────────────────────
#
# READ THE BODY, NOT THE STATUS. siteverify answers 200 for a REJECTED token
# as well as an accepted one; the verdict is the `success` field. A check that
# asserted `StatusCode -eq 200` would pass on every possible input.
if (-not $SkipTurnstile) {
  $verify = Invoke-Probe -Name "Turnstile siteverify (dummy token)" `
    -Uri "https://challenges.cloudflare.com/turnstile/v0/siteverify" `
    -Method POST `
    -Body @{ secret = $TurnstileSecret; response = "XXXX.DUMMY.TOKEN.XXXX" }

  if ($verify.Status -eq 200) {
    $json = $null
    try { $json = $verify.Body | ConvertFrom-Json } catch { }
    if ($null -ne $json) {
      Write-Result "siteverify answered with a parseable verdict" $true "success=$($json.success)"
      if ($TurnstileSecret -eq "1x0000000000000000000000000000000AA") {
        # The always-passes test secret must accept the dummy token. If it
        # does not, the probe itself is broken and no later result means
        # anything.
        Write-Result "always-passes test secret accepts the dummy token" ([bool]$json.success) `
          "error-codes: $($json.'error-codes' -join ', ')"
      }
    } else {
      Write-Result "siteverify body is JSON" $false "could not parse"
    }
  } else {
    Write-Result "siteverify reachable" $false "status $($verify.Status)"
  }
}

# ── 2. Supabase /auth/v1/signup with no captcha token ──────────────────────
#
# With Turnstile enforced in the Supabase dashboard, a token-less request is
# REFUSED. 400 is the PASS here and 200 is the failure -- a 200 means anyone
# can create accounts against this project without solving a challenge.
if (-not $SkipSupabase) {
  if (-not $SupabaseUrl -or -not $SupabaseAnonKey) {
    Write-Host ""
    Write-Host "=== Supabase captcha enforcement"
    Write-Host "    SKIPPED: pass -SupabaseUrl and -SupabaseAnonKey to run this probe."
    Write-Host "    A skip is an unchecked control, not a passing one."
    $script:Failures++
  } else {
    $throwaway = "r20-probe-{0}@example.com" -f ([guid]::NewGuid().ToString("N").Substring(0, 10))
    $payload = @{ email = $throwaway; password = "not-a-real-password-A1!" } | ConvertTo-Json -Compress

    $signup = Invoke-Probe -Name "Supabase /auth/v1/signup with no captcha token" `
      -Uri "$SupabaseUrl/auth/v1/signup" `
      -Method POST `
      -RequestHeaders @{ apikey = $SupabaseAnonKey; Authorization = "Bearer $SupabaseAnonKey" } `
      -Body $payload `
      -ContentType "application/json"

    $refused = ($signup.Status -eq 400) -and ($signup.Body -match "captcha")
    Write-Result "a token-less sign-up is refused" $refused `
      "status $($signup.Status); expected 400 with a captcha error"

    # /auth/v1/otp is the endpoint this was first confirmed on. Both are
    # covered because enabling the captcha in the dashboard covers the whole
    # Auth surface, and checking one and assuming the other is the habit
    # this file exists to break.
    $otp = Invoke-Probe -Name "Supabase /auth/v1/otp with no captcha token" `
      -Uri "$SupabaseUrl/auth/v1/otp" `
      -Method POST `
      -RequestHeaders @{ apikey = $SupabaseAnonKey; Authorization = "Bearer $SupabaseAnonKey" } `
      -Body (@{ email = $throwaway } | ConvertTo-Json -Compress) `
      -ContentType "application/json"

    $otpRefused = ($otp.Status -eq 400) -and ($otp.Body -match "captcha")
    Write-Result "a token-less magic link is refused" $otpRefused `
      "status $($otp.Status); expected 400 with a captcha error"
  }
}

# ── 3. security.txt and the security headers ───────────────────────────────
$sec = Invoke-Probe -Name "RFC 9116 security.txt" -Uri "$BaseUrl/.well-known/security.txt"
Write-Result "security.txt is served" ($sec.Status -eq 200) "status $($sec.Status)"

if ($sec.Status -eq 200) {
  $expires = $null
  if ($sec.Body -match "(?m)^Expires:\s*(.+)$") {
    try { $expires = [datetime]::Parse($Matches[1].Trim()).ToUniversalTime() } catch { }
  }
  if ($null -eq $expires) {
    Write-Result "security.txt declares a parseable Expires" $false "RFC 9116 requires it"
  } else {
    # An expired security.txt is worse than none: it tells a finder the
    # contact is stale and they should not bother.
    Write-Result "security.txt has not expired" ($expires -gt [datetime]::UtcNow) `
      "Expires $($expires.ToString('u'))"
  }
  Write-Result "security.txt names a contact" ($sec.Body -match "(?m)^Contact:") ""
}

# The constant headers, from lib/security/headers.ts. Checked against a
# DOCUMENT and against a JSON API, because the middleware matcher excludes
# /api/* -- a header set only in the middleware would cover one and not the
# other, which is the gap that made headers.ts exist.
$expectedHeaders = @{
  "Strict-Transport-Security" = "max-age=63072000; includeSubDomains"
  "X-Content-Type-Options"    = "nosniff"
  "X-Frame-Options"           = "DENY"
  "Referrer-Policy"           = "strict-origin-when-cross-origin"
  "X-DNS-Prefetch-Control"    = "off"
  "Cross-Origin-Opener-Policy" = "same-origin"
}

foreach ($path in @("/", "/api/health")) {
  $probe = Invoke-Probe -Name "security headers on $path" -Uri "$BaseUrl$path" -BodyPreview 160
  if ($probe.Status -lt 200) {
    Write-Result "reachable" $false "status $($probe.Status)"
    continue
  }
  foreach ($key in $expectedHeaders.Keys) {
    $actual = $null
    if ($null -ne $probe.Headers -and $probe.Headers.ContainsKey($key)) {
      $actual = ($probe.Headers[$key] -join ", ")
    }
    Write-Result "$key" ($actual -eq $expectedHeaders[$key]) "got '$actual'"
  }
  $csp = $null
  if ($null -ne $probe.Headers -and $probe.Headers.ContainsKey("Content-Security-Policy")) {
    $csp = ($probe.Headers["Content-Security-Policy"] -join ", ")
  }
  # CSP is set in the middleware, which deliberately does NOT match /api/*.
  if ($path -eq "/") {
    Write-Result "Content-Security-Policy present with a nonce" `
      ($null -ne $csp -and $csp -match "nonce-") "got '$csp'"
  }
  $powered = $null
  if ($null -ne $probe.Headers -and $probe.Headers.ContainsKey("X-Powered-By")) {
    $powered = ($probe.Headers["X-Powered-By"] -join ", ")
  }
  Write-Result "no X-Powered-By" ($null -eq $powered) "got '$powered'"
}

Write-Host ""
if ($script:Failures -eq 0) {
  Write-Host "ALL PROBES PASSED"
  exit 0
}
Write-Host ("{0} PROBE(S) FAILED OR WERE SKIPPED" -f $script:Failures)
exit 1
