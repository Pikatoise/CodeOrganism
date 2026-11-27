namespace CodeOrganism.Connector.DotNet;

public sealed class ManagedCodeIndex
{
    private readonly object gate = new();
    private readonly SortedList<ulong, (ulong End, CpuMethod Method)> methods = new();
    private readonly Dictionary<long, (string Name, string? Library)> modules = new();
    public bool Truncated { get; private set; }

    public void AddModule(long id, string path)
    {
        if (string.IsNullOrEmpty(path)) return;
        path = path.Replace('\\', '/');
        var library = path.Contains("/dotnet/shared/", StringComparison.OrdinalIgnoreCase) ? "framework"
            : path.Contains("/.nuget/packages/", StringComparison.OrdinalIgnoreCase) ? "third-party" : null;
        lock (gate)
        {
            if (modules.Count < 2_000 || modules.ContainsKey(id))
                modules[id] = (Path.GetFileNameWithoutExtension(path), library);
        }
    }

    public void AddMethod(ulong address, int size, CpuMethod method)
    {
        if (size <= 0) return;
        lock (gate)
        {
            if (methods.Count >= 32_768 && !methods.ContainsKey(address))
                Truncated = true;
            else
                methods[address] = (address + (ulong)size, method);
        }
    }

    public void RemoveMethod(ulong address, long id)
    {
        lock (gate)
        {
            if (methods.TryGetValue(address, out var range) && range.Method.MethodId == id)
                methods.Remove(address);
        }
    }

    public CpuMethod? Resolve(ulong address)
    {
        lock (gate)
        {
            var left = 0;
            var right = methods.Count;
            while (left < right)
            {
                var middle = left + (right - left) / 2;
                if (methods.Keys[middle] <= address) left = middle + 1;
                else right = middle;
            }

            if (left == 0 || address >= methods.Values[left - 1].End) return null;
            var range = methods.Values[left - 1];
            if (!modules.TryGetValue(range.Method.ModuleId, out var module) || module.Name == range.Method.ModuleName)
                return range.Method;

            var resolved = range.Method with { ModuleName = module.Name, Library = module.Library };
            methods[methods.Keys[left - 1]] = (range.End, resolved);
            return resolved;
        }
    }
}
