using BrowserProxy;

var syncRoot = new object();
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
using var pageLoader = new PageLoader();
app.MapGet("/load", LoadUrlAsync);
app.MapGet("/task", GetUrlToLoad);
app.MapPost("/result", SetResultAsync);
app.Run();

async Task<IResult> LoadUrlAsync(string? url = null, string? waitSelector = null, string? clickSelector = null)
{
    if (url == null)
    {
        return Results.Content("Use url parameter to load page");
    }
    try
    {
        var result = await pageLoader.LoadUrlAsync(url, waitSelector, clickSelector);
        Print(url + " - OK", ConsoleColor.DarkGray);
        return Results.Content(result, "text/html; charset=utf-8");
    }
    catch (TimeoutException e)
    {
        Print(url + " - ERROR: " + e.Message, ConsoleColor.Red);
        return Results.Problem("Timeout", "", 408);
    }
    catch (OverflowException e)
    {
        Print(url + " - ERROR: " + e.Message, ConsoleColor.Red);
        return Results.Problem("Too many requests", "", 429);
    }
    catch (Exception e)
    {
        Print(url + " - ERROR: " + e.Message, ConsoleColor.Red);
        return Results.Problem("Internal error", "", 500);
    }
}

IResult GetUrlToLoad()
{
    var urlToLoad = pageLoader.GetUrlToLoad();
    var result = urlToLoad != null
        ? Results.Json(urlToLoad)
        : Results.NoContent();
    return result;
}

async Task<IResult> SetResultAsync(string url, Stream stream)
{
    using var streamReader = new StreamReader(stream);
    var result = await streamReader.ReadToEndAsync();
    pageLoader.TrySetResult(url, result);
    return Results.Accepted();
}

void Print(string message, ConsoleColor color)
{
    lock (syncRoot)
    {
        var originalColor = Console.ForegroundColor;
        Console.ForegroundColor = color;
        Console.WriteLine(message);
        Console.ForegroundColor = originalColor;   
    }
}