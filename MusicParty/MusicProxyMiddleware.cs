namespace MusicParty;

public class MusicProxyMiddleware
{
    private static readonly HttpClient _http = new();
    private static CancellationTokenSource _tokenSource = new();
    private static long _currentLength;
    private static byte[]? _currentBuf;
    private static long _read;
    private static string? _currentMimeType;
    private readonly RequestDelegate _next;

    public MusicProxyMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    // --- [新增方法] ---
    /// <summary>
    /// 公开的静态方法，用于从外部强制停止并清理代理状态。
    /// 这是解决移动端断线重连后状态不同步的关键。
    /// </summary>
    public static void StopAndClearProxyState()
    {
        // 1. 发出取消信号，停止正在进行的下载任务
        if (!_tokenSource.IsCancellationRequested)
        {
            _tokenSource.Cancel();
        }

        // 2. 将所有状态变量重置为初始值
        _currentLength = 0;
        _read = 0;
        _currentBuf = null;
        _currentMimeType = null;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/musicproxy"))
        {
            await _next(context);
            return;
        }

        // 如果代理已被清理或未启动，则直接放行，避免客户端卡在等待状态
        if (_currentLength == 0 || _currentBuf is null)
        {
            context.Response.StatusCode = 404; // 返回一个明确的错误，告知客户端资源已不可用
            await context.Response.WriteAsync("Proxy session has ended or is invalid.");
            return;
        }

        if (_currentMimeType is not null)
            context.Response.ContentType = _currentMimeType;

        long start = 0;
        long end = _currentLength - 1;
        long contentLength = _currentLength;
        if (context.Request.Headers.Range.Any())
        {
            var ranges = context.Request.Headers.Range.First()[6..].Split('-');
            if (ranges.Any())
            {
                start = Convert.ToInt64(ranges[0]);
                if (!string.IsNullOrEmpty(ranges[1]))
                    end = Convert.ToInt64(ranges[1]);
            }

            contentLength = end - start + 1;
            if (contentLength > _currentLength || contentLength <= 0)
            {
                context.Response.StatusCode = 416;
                return;
            }

            context.Response.ContentLength = contentLength;
            context.Response.Headers.ContentRange = $"bytes {start}-{end}/{_currentLength}";
            context.Response.StatusCode = 206;
        }

        var i = start;
        while (i < contentLength + start)
        {
            if (_tokenSource.IsCancellationRequested)
            {
                context.Abort();
                return;
            }

            while (i >= _read)
                await Task.Delay(10);
            var canRead = contentLength + start - i;
            if ((int)(_read - i) > canRead)
            {
                await context.Response.Body.WriteAsync(_currentBuf, (int)i, (int)canRead);
                break;
            }

            await context.Response.Body.WriteAsync(_currentBuf, (int)i, (int)(_read - i));
            i = _read;
        }

        await context.Response.CompleteAsync();
    }

    public static async Task StartProxyAsync(MusicProxyRequest req)
    {
        // 停止并清理上一个代理任务
        _tokenSource.Cancel();
        _tokenSource.Dispose();
        _tokenSource = new CancellationTokenSource();

        _currentMimeType = req.MimeType;

        var message = new HttpRequestMessage(HttpMethod.Get, req.Url);
        message.Headers.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

        if (req.Referer is not null)
        {
            message.Headers.Referrer = new Uri(req.Referer);
        }
        else
        {
            message.Headers.Referrer = new Uri("https://www.bilibili.com");
        }

        message.Headers.Add("Origin", "https://www.bilibili.com");

        var cookies = MusicParty.MusicApi.Bilibili.BilibiliApi.BilibiliApiGlobalCookieStorage;
        if (!string.IsNullOrEmpty(cookies))
        {
            message.Headers.Add("Cookie", cookies);
        }

        message.Headers.Host = new Uri(req.Url).Host;

        var resp = await _http.SendAsync(message);
        _currentLength = long.Parse(resp.Content.Headers.GetValues("Content-Length").First());
        _currentBuf = new byte[_currentLength];
        _read = 0;
        _ = Task.Run(async () =>
        {
            var stream = await resp.Content.ReadAsStreamAsync();
            var buf = new byte[1024];
            int read;
            while ((read = await stream.ReadAsync(buf.AsMemory(0, 1024), _tokenSource.Token)) > 0)
            {
                WriteBuffer(buf, read, _currentBuf, _read);
                _read += read;
            }

            await stream.DisposeAsync();
        });
    }

    private static void WriteBuffer(byte[] buf, long length, byte[] dest, long offset)
    {
        Array.Copy(buf, 0, dest, offset, length);
    }
}

public record MusicProxyRequest(string Url, string MimeType, string? Referer, string? UserAgent);

public static class MusicProxyMiddlewareExtension
{
    public static IApplicationBuilder UseMusicProxy(this IApplicationBuilder builder) =>
        builder.UseMiddleware<MusicProxyMiddleware>();
}
