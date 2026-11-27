namespace CodeOrganism.Protocol;

public sealed record ProcessTarget(int Pid, string Name, DateTime StartedUtc);
public sealed record AttachTarget(int Pid, DateTime? StartedUtc = null);
public sealed record LocalAttachRequest(AttachTarget Target, string Origin, string ProducerToken);
public sealed record LocalAttachStatus(string State, string? Reason = null, int? Pid = null);
