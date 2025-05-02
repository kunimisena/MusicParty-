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

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/musicproxy"))
        {
            await _next(context);
            return;
        }

        if (_currentLength == 0)
        {
            await _next(context);
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
                await context.Response.Body.WriteAsync(_currentBuf!, (int)i, (int)canRead);
                break;
            }

            await context.Response.Body.WriteAsync(_currentBuf!, (int)i, (int)(_read - i));
            i = _read;
        }

        await context.Response.CompleteAsync();
    }

    public static async Task StartProxyAsync(MusicProxyRequest req)
    {
        _tokenSource.Cancel();
        _tokenSource.Dispose();
        _tokenSource = new CancellationTokenSource();

        _currentMimeType = req.MimeType;

        var message = new HttpRequestMessage(HttpMethod.Get, req.Url);
        // 强制覆盖 User-Agent（使用更真实的浏览器标识）
        message.Headers.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

        // 强制覆盖 Referer（必须精确到具体视频页，如 https://www.bilibili.com/video/BV1xxx）
        if (req.Referer is not null)
        {
            message.Headers.Referrer = new Uri(req.Referer);
        }
        else
        {
            // 如果 Referer 未传递，设置默认值（需结合 BVID）
            message.Headers.Referrer = new Uri("https://www.bilibili.com");
        }

        // 添加 Origin 头（必须）
        message.Headers.Add("Origin", "https://www.bilibili.com");

        // 传递 Cookies（关键！）
        // 从全局 HttpClient 中获取 Cookie 并附加到本次请求
        var cookies = _http.DefaultRequestHeaders.GetValues("Cookie").FirstOrDefault();
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
            while ((read = await stream.ReadAsync(buf.AsMemory(0, 1024))) > 0
                   && !_tokenSource.IsCancellationRequested)
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
