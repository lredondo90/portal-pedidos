using Portal.Domain;

namespace Portal.Api;

public sealed record SyncRun(DateTimeOffset At, bool Ok, string? Cursor, int Orders, int Invoices, IReadOnlyList<ImportIssue> Issues, string? Error);

/// <summary>Trae los cambios del ERP al almacén del portal. Lo usa el trabajo periódico y el botón de sincronizar.</summary>
public sealed class SyncService(IErpConnector connector, IPortalStore store, ILogger<SyncService> log)
{
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly List<SyncRun> _history = [];
    private string? _cursor;

    public string ConnectorName => connector.Name;
    public IReadOnlyList<SyncRun> History { get { lock (_history) return _history.ToList(); } }

    public async Task<SyncRun> RunAsync(CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var batch = await connector.FetchChangesAsync(_cursor, ct);
            store.Apply(batch);
            _cursor = batch.Cursor;
            var run = new SyncRun(DateTimeOffset.UtcNow, true, _cursor, batch.Orders.Count, batch.Invoices.Count, batch.Issues, null);
            foreach (var i in batch.Issues) log.LogWarning("Importación {Source} fila {Row}: {Message}", i.Source, i.Row, i.Message);
            Record(run);
            return run;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "Fallo al sincronizar con {Connector}", connector.Name);
            var run = new SyncRun(DateTimeOffset.UtcNow, false, _cursor, 0, 0, [], e.Message);
            Record(run);
            return run;
        }
        finally { _lock.Release(); }
    }

    private void Record(SyncRun run)
    {
        lock (_history)
        {
            _history.Insert(0, run);
            if (_history.Count > 50) _history.RemoveAt(_history.Count - 1);
        }
    }
}

public sealed class SyncWorker(SyncService sync, IConfiguration config) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var every = TimeSpan.FromMinutes(config.GetValue("Erp:SyncMinutes", 5));
        using var timer = new PeriodicTimer(every);
        do { await sync.RunAsync(stoppingToken); }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
