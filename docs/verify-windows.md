# Verifying InsiderFlow from Windows

Every command here is written for **Windows PowerShell 5.1** — the one that
ships with Windows and the one `powershell.exe` starts. They also work in
PowerShell 7 (`pwsh`).

The whole file exists because of two failures on this project, and both had the
same shape: **the command printed nothing, and nothing was read as success.**

---

## The two traps

### 1. `curl` is not curl

```powershell
curl -X POST -d '{"limit":1}' https://example.com/api
```

In PowerShell, `curl` is an **alias for `Invoke-WebRequest`**. There is no
`-X` and no `-d`; PowerShell binds `-X` to nothing, treats the JSON as a
positional argument, and sends a request that resembles nothing in the line you
wrote. The observed symptoms on this project were `bad_json` from the server and
`URL rejected` from the shell — neither of which points at the actual cause.

Two ways out, in order of preference:

- Use `Invoke-WebRequest` properly (everything below does).
- If you genuinely want curl, call the binary by its full name — **`curl.exe`**
  — which exists on Windows 10 1803 and later. Even then, quoting JSON inline
  is fragile; put the body in a file and use `--data-binary "@body.json"`.

### 2. `Invoke-RestMethod` in a `try/catch` swallows the error body

This is the dangerous one.

```powershell
# DO NOT USE — on Windows PowerShell 5.1 this can print nothing at all
try   { Invoke-RestMethod -Uri $url -Method POST -Body $json }
catch { Write-Host $_.ErrorDetails.Message }
```

On PowerShell 5.1, `$_.ErrorDetails.Message` is **empty** for a
`WebException`. The catch block runs, prints an empty string, and the terminal
shows nothing. If you are checking "is the captcha enforced", a blank screen
looks exactly like a clean pass.

**A command that can produce silence is the same failure class as an assertion
that cannot fail.** The fix is `Invoke-WebRequest` plus a catch that reads the
response stream directly:

```powershell
catch {
  $response = $_.Exception.Response          # HttpWebResponse on 5.1
  $status   = [int]$response.StatusCode
  $reader   = New-Object System.IO.StreamReader($response.GetResponseStream())
  $body     = $reader.ReadToEnd()
  $reader.Dispose()
  Write-Host "STATUS: $status"
  Write-Host "BODY  : $body"
}
```

`scripts/verify-windows.ps1` wraps exactly this in `Invoke-Probe`, handles the
PowerShell 7 shape as well (`HttpResponseMessage`, no `GetResponseStream`), and
prints status **-1** with the exception message when no HTTP response came back
at all — so DNS failures, TLS failures and refused connections are all
distinguishable from a real status and none of them is silent.

---

## Run everything

```powershell
# Local, against a production build (pnpm --filter @insiderflow/web build; next start)
.\scripts\verify-windows.ps1 -BaseUrl http://localhost:3000

# A deployment, with the Supabase probes
.\scripts\verify-windows.ps1 `
  -BaseUrl      https://insiderflow.vercel.app `
  -SupabaseUrl  https://<ref>.supabase.co `
  -SupabaseAnonKey sb_publishable_...
```

Exits 0 only if every probe passed. **A skipped probe counts as a failure** —
an unchecked control is not a passing one, and a script that exits 0 while
silently skipping half its checks is the trap this file is about.

Set TLS 1.2 first if you are on an unpatched box; the script does it for you:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
```

---

## The three probes, individually

### Turnstile `siteverify`

```powershell
$body = @{
  secret   = "1x0000000000000000000000000000000AA"   # Cloudflare's always-passes TEST secret
  response = "XXXX.DUMMY.TOKEN.XXXX"
}
$r = Invoke-WebRequest -Uri "https://challenges.cloudflare.com/turnstile/v0/siteverify" `
       -Method POST -Body $body -UseBasicParsing
Write-Host "STATUS: $([int]$r.StatusCode)"
Write-Host "BODY  : $($r.Content)"
```

Observed:

```
STATUS: 200
BODY  : {"challenge_ts":"...","error-codes":[],"hostname":"example.com",
         "metadata":{"result_with_testing_key":true},"success":true}
```

**Read `success`, not the status code.** `siteverify` answers **200 for a
rejected token too**; the verdict is in the body. A check written as
`if ($r.StatusCode -eq 200) { "captcha ok" }` passes on every possible input and
is worse than no check.

Cloudflare's documented test keys:

| Secret                                | Behaviour           |
| ------------------------------------- | ------------------- |
| `1x0000000000000000000000000000000AA` | always passes       |
| `2x0000000000000000000000000000000AA` | always fails        |
| `3x0000000000000000000000000000000AA` | token already spent |

### Supabase `/auth/v1/signup` and `/auth/v1/otp` with no captcha token

**400 is the pass. 200 is the failure** — a 200 means anyone can create
accounts against the project without solving a challenge.

```powershell
$SupabaseUrl = "https://<ref>.supabase.co"
$AnonKey     = "sb_publishable_..."
$headers = @{ apikey = $AnonKey; Authorization = "Bearer $AnonKey" }
$json    = @{ email = "probe-$(New-Guid)@example.com"; password = "not-a-real-password-A1!" } |
             ConvertTo-Json -Compress

try {
  $r = Invoke-WebRequest -Uri "$SupabaseUrl/auth/v1/signup" -Method POST `
         -Headers $headers -Body $json -ContentType "application/json" -UseBasicParsing
  Write-Host "STATUS: $([int]$r.StatusCode)  <-- NOT REFUSED, captcha is not enforced"
  Write-Host "BODY  : $($r.Content)"
} catch {
  $resp   = $_.Exception.Response
  $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
  Write-Host "STATUS: $([int]$resp.StatusCode)"
  Write-Host "BODY  : $($reader.ReadToEnd())"
  $reader.Dispose()
}
```

Observed against the development project, **both endpoints**:

```
STATUS: 400
BODY  : {"code":400,"error_code":"captcha_failed",
         "msg":"captcha protection: request disallowed (no captcha_token found)"}
```

Both are probed because enabling the captcha in the Supabase dashboard covers
the whole Auth surface, and checking one endpoint while assuming the other is
the habit this file exists to break. The password/e-mail probe creates nothing:
the request never reaches user creation.

### `security.txt` and the security headers

```powershell
$r = Invoke-WebRequest -Uri "https://<host>/.well-known/security.txt" -UseBasicParsing
Write-Host "STATUS: $([int]$r.StatusCode)"
Write-Host $r.Content

# Headers, on a DOCUMENT and on a JSON API — the middleware matcher excludes
# /api/*, so a header set only there covers one and not the other.
foreach ($path in @("/", "/api/health")) {
  $h = (Invoke-WebRequest -Uri "https://<host>$path" -UseBasicParsing).Headers
  foreach ($key in @("Strict-Transport-Security","X-Content-Type-Options","X-Frame-Options",
                     "Referrer-Policy","X-DNS-Prefetch-Control","Cross-Origin-Opener-Policy",
                     "Content-Security-Policy","X-Powered-By")) {
    $value = if ($h.ContainsKey($key)) { ($h[$key] -join ", ") } else { "<absent>" }
    Write-Host ("{0,-28} {1} {2}" -f $key, $path, $value)
  }
}
```

`X-Powered-By` must read `<absent>`. Everything else must be present on **both**
paths except `Content-Security-Policy`, which is set in the middleware and
therefore appears on the document and not on `/api/*` — that is by design, and
the constant headers in `next.config.ts` are what cover the API.

---

## What a failing run looks like

Worth showing, because a green run proves nothing about a probe that cannot go
red. Run against a stale container built before the r19/r20 header work:

```
=== RFC 9116 security.txt
    STATUS: 404
    [FAIL] security.txt is served -- status 404

=== security headers on /
    [FAIL] Strict-Transport-Security -- got ''
    [FAIL] no X-Powered-By -- got 'Next.js'

15 PROBE(S) FAILED OR WERE SKIPPED
```

Against a current build, the same script prints `ALL PROBES PASSED` and exits 0. If a run is entirely silent, the script is not the thing that is broken —
check that you invoked `.ps1` and not a truncated pipeline (`| Select-Object
-First N` kills the child process and reports exit 255).

---

## Related

- [security.md](security.md) — what is and is not a secret, rotation procedure
- [auth.md](auth.md) — Turnstile's two halves, and why the secret key is not in
  any environment this app reads
- [../PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md) — every claim with
  the command that checks it
