using System.Globalization;
using System.Text;

namespace Portal.Connectors.SapFiles;

/// <summary>Lector de CSV separado por punto y coma, con comillas dobles opcionales y cabecera por nombre.</summary>
public sealed class CsvTable
{
    public IReadOnlyList<string> Headers { get; }
    public IReadOnlyList<CsvRow> Rows { get; }

    private CsvTable(IReadOnlyList<string> headers, IReadOnlyList<CsvRow> rows) { Headers = headers; Rows = rows; }

    public static CsvTable Parse(string text, char separator = ';')
    {
        var records = ParseRecords(text.TrimStart('﻿'), separator).Where(r => r.Any(f => f.Length > 0)).ToList();
        if (records.Count == 0) return new CsvTable([], []);
        var headers = records[0].Select(h => h.Trim().ToUpperInvariant()).ToList();
        var index = headers.Select((h, i) => (h, i)).ToDictionary(x => x.h, x => x.i);
        var rows = records.Skip(1).Select((r, i) => new CsvRow(index, r, i + 2)).ToList();
        return new CsvTable(headers, rows);
    }

    private static IEnumerable<List<string>> ParseRecords(string text, char sep)
    {
        var field = new StringBuilder();
        var record = new List<string>();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else field.Append(c);
            }
            else if (c == '"' && field.Length == 0) quoted = true;
            else if (c == sep) { record.Add(field.ToString()); field.Clear(); }
            else if (c == '\n' || c == '\r')
            {
                if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                record.Add(field.ToString()); field.Clear();
                yield return record;
                record = [];
            }
            else field.Append(c);
        }
        if (field.Length > 0 || record.Count > 0) { record.Add(field.ToString()); yield return record; }
    }
}

public sealed class CsvRow(IReadOnlyDictionary<string, int> index, IReadOnlyList<string> fields, int line)
{
    public int Line => line;

    public bool Has(string column) => index.ContainsKey(column);

    public string? Get(string column)
    {
        if (!index.TryGetValue(column, out var i) || i >= fields.Count) return null;
        var v = fields[i].Trim();
        return v.Length == 0 ? null : v;
    }

    public string Required(string column) =>
        Get(column) ?? throw new FormatException($"Falta el valor de {column}");

    /// <summary>Acepta 1234.56 y el formato español 1.234,56 que SAP usa según la configuración del usuario.</summary>
    public decimal? Decimal(string column)
    {
        var v = Get(column);
        if (v is null) return null;
        var negative = v.EndsWith('-'); // SAP escribe el signo negativo al final
        v = v.TrimEnd('-');
        if (v.Contains(',')) v = v.Replace(".", "").Replace(',', '.');
        if (!decimal.TryParse(v, NumberStyles.Number, CultureInfo.InvariantCulture, out var d))
            throw new FormatException($"{column}: '{v}' no es un número");
        return negative ? -d : d;
    }

    public decimal RequiredDecimal(string column) => Decimal(column) ?? throw new FormatException($"Falta el valor de {column}");

    /// <summary>Fechas en formato interno de SAP (AAAAMMDD). 00000000 se trata como vacío.</summary>
    public DateOnly? Date(string column)
    {
        var v = Get(column);
        if (v is null || v.Trim('0').Length == 0) return null;
        if (DateOnly.TryParseExact(v, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
        if (DateOnly.TryParseExact(v, ["dd.MM.yyyy", "dd/MM/yyyy", "yyyy-MM-dd"], CultureInfo.InvariantCulture, DateTimeStyles.None, out d)) return d;
        throw new FormatException($"{column}: '{v}' no es una fecha AAAAMMDD");
    }

    public DateOnly RequiredDate(string column) => Date(column) ?? throw new FormatException($"Falta el valor de {column}");

    public bool Flag(string column) => Get(column)?.ToUpperInvariant() is "X" or "S" or "1" or "SI" or "SÍ";
}

/// <summary>Escritura de CSV en el mismo formato que se lee: punto y coma, punto decimal y fechas AAAAMMDD.</summary>
public static class Csv
{
    public static string Date(DateOnly d) => d.ToString("yyyyMMdd", CultureInfo.InvariantCulture);

    public static string Decimal(decimal d) => d.ToString("0.00####", CultureInfo.InvariantCulture);

    public static string Write(IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string?>> rows)
    {
        var sb = new StringBuilder();
        sb.Append(string.Join(';', headers)).Append("\r\n");
        foreach (var r in rows) sb.Append(string.Join(';', r.Select(Field))).Append("\r\n");
        return sb.ToString();
    }

    // Texto libre del usuario: los saltos de línea se cambian por espacios y se entrecomilla si lleva ; o comillas.
    private static string Field(string? v)
    {
        if (string.IsNullOrEmpty(v)) return "";
        v = v.Replace("\r\n", " ").Replace('\n', ' ').Replace('\r', ' ');
        return v.IndexOfAny([';', '"']) >= 0 || v != v.Trim() ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
    }
}
