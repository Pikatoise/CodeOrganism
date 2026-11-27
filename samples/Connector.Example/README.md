# Stand-alone PowerShell connector

This example counts entries to `Invoke-ExampleWork` and sends the exact counts through the [v1 HTTP contract](../../specs/001-live-runtime-map/contracts/connector-v1.md). It runs in Windows PowerShell 5.1 or PowerShell 7. It uses only the shell and the local HTTP endpoint.

Start CodeOrganism, authorize a producer as described in the [host instructions](../../README.md), and open the loopback URL in your browser. In a separate PowerShell terminal, use that URL and paste the producer credential at the masked prompt.

```powershell
.\samples\Connector.Example\publish.ps1 -Origin http://127.0.0.1:12345
```

The Calls view shows alternating entry rates. Expand **Example script** and select **Invoke-ExampleWork** to see the count, interval, and coverage. CPU and Allocations are unavailable for this source. The script ends its session after eight intervals by default. Use `-Intervals` to keep it active longer.

For an automated run, supply the credential in the script process's `CODEORGANISM_PRODUCER_TOKEN` environment variable. HTTP `409` with `session-in-use` means another source holds the map. End that session before retrying. To check the compatibility response, run the script with `-Version 2` and expect `unsupported-version`.
