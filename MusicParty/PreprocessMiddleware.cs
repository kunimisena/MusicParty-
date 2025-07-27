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
        var id = context.User.Identity?.Name;

        // [核心修改] 核心逻辑简化: 只有当用户完全没有身份时，才创建新身份。
        // 如果用户已有ID (来自Cookie)，我们完全信任UserManager已在启动时加载了其档案。
        // 移除了之前会导致数据被错误覆盖的 "else" 逻辑块，从根本上杜绝了风险。
        if (string.IsNullOrEmpty(id))
        {
            // 如果用户完全没有ID（新访客），则创建一个全新的ID并登录
            var newId = Guid.NewGuid().ToString()[..8];
            await _userManager.LoginAsync(newId);
        }

        await _next(context);
    }
}

public static class PreprocessMiddlewareExtension
{
    public static IApplicationBuilder UsePreprocess(this IApplicationBuilder builder) =>
        builder.UseMiddleware<PreprocessMiddleware>();
}
