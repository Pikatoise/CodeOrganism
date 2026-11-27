# CodeOrganism

CodeOrganism is a local runtime visualization tool. It maps observed execution to an interactive graph so developers can find the code behind changes in CPU load, allocations and call frequency.

Development starts with a CPU proof of concept for running .NET applications on Windows. See the [product specification](specs/001-live-runtime-map/spec.md) and [task list](specs/001-live-runtime-map/tasks.md) for scope and progress.

## Development

Use the .NET 10 SDK, Node.js 24 and PowerShell on Windows 11 x64.

```powershell
dotnet build CodeOrganism.slnx -c Release
npm.cmd --prefix src/web ci
npm.cmd --prefix src/web run check
npm.cmd --prefix src/web run build
```

Start the local host with `dotnet run --project src/CodeOrganism.Host -c Release` from the repository root. Open the loopback URL printed by the host. Start a .NET 10 process, choose it by PID, and select **Attach**. Windows may prompt for permission to start the dedicated CPU collector.

Run the [CPU workflow checks](specs/001-live-runtime-map/quickstart.md#cpu-browser-workflow) after building.

### Authorize a third-party connector

Start the host with an explicit external grant from a private terminal.

```powershell
dotnet run --project src/CodeOrganism.Host -c Release -- --allow-external-connector
```

The terminal prints a fresh external producer credential and the loopback URL. Give the credential to the local connector you want to authorize. Use the credential in the `Authorization: Bearer` HTTP header for [v1 ingestion](specs/001-live-runtime-map/contracts/connector-v1.md). For example, paste it at the masked prompt in the [PowerShell connector example](samples/Connector.Example/README.md). Stop the host to revoke its generated credential.

For automation, set `CODEORGANISM_PRODUCER_TOKEN` in the host and connector processes to the same randomly generated secret. The host uses that value as the external grant and keeps it out of its output. Start the host with neither option for first-party collection only.
