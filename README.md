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

Start the browser shell separately during development with `npm.cmd --prefix src/web run dev`. The [validation guide](specs/001-live-runtime-map/quickstart.md) describes the planned integrated workflow.
