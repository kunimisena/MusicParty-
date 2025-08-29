namespace MusicParty;

public class PreprocessMiddleware
{
    private readonly RequestDelegate _next;
    private readonly UserManager _userManager;

    public PreprocessMiddleware(RequestDelegate next, UserManager userManager)
    {
        _next = next;
        _userManager = userManager;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // 步骤 1: 优先尝试从认证Cookie中获取用户ID
        var id = context.User.Identity?.Name;

        // 步骤 2: 如果Cookie中没有ID（例如，移动端重连时丢失），则尝试从URL查询参数中获取
        // 这是为了解决移动端浏览器在后台重连时不发送Cookie的问题
        if (string.IsNullOrEmpty(id))
        {
            // C# `Request.Query` 的 key 是大小写不敏感的，这里用 "userId"
            if (context.Request.Query.TryGetValue("userId", out var userIdFromQuery))
            {
                id = userIdFromQuery;
            }
        }

        // 步骤 3: 如果Cookie和URL参数中都没有ID，那么这一定是一个全新的访客
        if (string.IsNullOrEmpty(id))
        {
            // 为全新访客生成一个ID并执行登录，这会通过Set-Cookie响应头为浏览器设置认证Cookie
            var newId = Guid.NewGuid().ToString()[..8];
            await _userManager.LoginAsync(newId);
        }
        // 步骤 4: 如果用户未经身份验证（即Cookie丢失），但我们通过URL参数成功找到了ID
        else if (!context.User.Identity.IsAuthenticated)
        {
            // 我们需要为他执行登录操作，以便重新签发并设置认证Cookie，从而修复客户端的状态
            await _userManager.LoginAsync(id);
        }

        // 继续处理请求管道
        await _next(context);
    }
}

public static class PreprocessMiddlewareExtension
{
    public static IApplicationBuilder UsePreprocess(this IApplicationBuilder builder) =>
        builder.UseMiddleware<PreprocessMiddleware>();
}
