using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

namespace CodeOrganism.Host;

internal sealed class ConnectorAuthorization
{
    public const string GrantOption = "--allow-external-connector";
    public const string TokenEnvironmentVariable = "CODEORGANISM_PRODUCER_TOKEN";

    private readonly byte[] firstParty;
    private readonly byte[]? external;

    public ConnectorAuthorization(bool grant, string? configuredToken)
    {
        FirstPartyToken = NewToken();
        firstParty = Encoding.UTF8.GetBytes(FirstPartyToken);
        if (string.IsNullOrWhiteSpace(configuredToken) && grant)
            configuredToken = GeneratedExternalToken = NewToken();
        if (!string.IsNullOrWhiteSpace(configuredToken))
            external = Encoding.UTF8.GetBytes(configuredToken);
    }

    public string FirstPartyToken { get; }
    public string? GeneratedExternalToken { get; }

    public bool Allows(string? value)
    {
        if (!AuthenticationHeaderValue.TryParse(value, out var authorization) ||
            !authorization.Scheme.Equals("Bearer", StringComparison.OrdinalIgnoreCase) ||
            authorization.Parameter is not { } supplied)
            return false;

        var actual = Encoding.UTF8.GetBytes(supplied);
        return CryptographicOperations.FixedTimeEquals(firstParty, actual) ||
            (external is not null && CryptographicOperations.FixedTimeEquals(external, actual));
    }

    private static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
}
