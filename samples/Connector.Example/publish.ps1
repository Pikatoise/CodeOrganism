[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Origin,
    [ValidateRange(1, 120)] [int] $Intervals = 8,
    [ValidateRange(1, 2)] [int] $Version = 1
)

$ErrorActionPreference = 'Stop'
if ($Origin -notmatch '^http://127\.0\.0\.1:[0-9]{1,5}/?$' -or ([uri] $Origin).Port -eq 0) {
    throw 'Use the HTTP loopback origin printed by CodeOrganism.'
}

$token = $env:CODEORGANISM_PRODUCER_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
    $secret = Read-Host 'Producer credential' -AsSecureString
    $token = [System.Net.NetworkCredential]::new('', $secret).Password
    $secret.Dispose()
}
if ([string]::IsNullOrWhiteSpace($token)) { throw 'Supply a producer credential.' }

Add-Type -AssemblyName System.Net.Http
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.UseProxy = $false
$handler.AllowAutoRedirect = $false
$client = [System.Net.Http.HttpClient]::new($handler)
$client.BaseAddress = [uri] $Origin
$client.Timeout = [TimeSpan]::FromSeconds(2)
$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)

function Send-ConnectorMessage([string] $Path, [hashtable] $Message) {
    $json = ConvertTo-Json -InputObject $Message -Depth 8 -Compress
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $wait = 100 * $attempt
        $content = [System.Net.Http.StringContent]::new($json, [Text.Encoding]::UTF8, 'application/json')
        try {
            try { $response = $client.PostAsync($Path, $content).GetAwaiter().GetResult() }
            catch {
                if ($attempt -eq 3) { throw }
                Start-Sleep -Milliseconds $wait
                continue
            }
            try {
                $status = [int] $response.StatusCode
                $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if ($response.IsSuccessStatusCode) {
                    if ($body) { return ConvertFrom-Json -InputObject $body }
                    return
                }
                if ($null -ne $response.Headers.RetryAfter.Delta) {
                    $wait = [int] $response.Headers.RetryAfter.Delta.TotalMilliseconds
                }
                if ($attempt -eq 3 -or ($status -ne 429 -and $status -lt 500) -or $wait -gt 2000) {
                    $code = 'request-failed'
                    try { $code = (ConvertFrom-Json -InputObject $body).code } catch { }
                    throw "Connector request rejected (HTTP $status, $code)."
                }
            } finally { $response.Dispose() }
        } finally { $content.Dispose() }
        Start-Sleep -Milliseconds ([Math]::Max(0, $wait))
    }
}

function Invoke-ExampleWork {
    $script:entries++
}

$api = 'api/connector/v1/sessions'
$ending = 'producer-error'
$sessionPath = $null
try {
    $registration = Send-ConnectorMessage $api @{
        requestId = [guid]::NewGuid().ToString('N')
        version = $Version
        source = @{ id = 'powershell-example'; label = 'PowerShell example' }
        capabilities = @(@{ metric = 'calls'; unit = 'count'; method = 'entry-counter'; quality = 'exact' })
    }
    $sessionPath = "$api/$($registration.sessionId)"
    $interval = [Math]::Max(1000, $registration.limits.minIntervalMs + 25)
    $nodes = @(
        @{ id = 'example'; kind = 'module'; label = 'Example script' }
        @{ id = 'work'; kind = 'method'; label = 'Invoke-ExampleWork'; parentId = 'example' }
    )
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $start = 0
    for ($sequence = 1; $sequence -le $Intervals; $sequence++) {
        $script:entries = 0
        $iterations = if ($sequence % 2 -eq 0) { 120 } else { 12 }
        for ($i = 0; $i -lt $iterations; $i++) { Invoke-ExampleWork }
        Start-Sleep -Milliseconds $interval
        $end = $clock.ElapsedMilliseconds
        Send-ConnectorMessage "$sessionPath/batches" @{
            sequence = $sequence; startMs = $start; endMs = $end; nodes = $nodes; relationships = @(); loss = @()
            measurements = @(@{ nodeId = 'work'; metric = 'calls'; value = $script:entries; quality = 'exact'; complete = $true })
        }
        Write-Output "Published $script:entries calls in $($end - $start) ms."
        $start = $end
    }
    $ending = 'detached'
} finally {
    try {
        if ($sessionPath) { Send-ConnectorMessage "$sessionPath/end" @{ reason = $ending } }
    } finally { $client.Dispose() }
}
