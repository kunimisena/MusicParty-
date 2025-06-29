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

        if (string.IsNullOrEmpty(id))
        {
            // 如果用户完全没有ID（新访客），则创建一个全新的ID并登录
            var newId = Guid.NewGuid().ToString()[..8];
            await _userManager.LoginAsync(newId);
        }
        else
        {
            // 如果用户有ID（来自Cookie），但服务器内存中没有记录（通常是服务重启导致）
            if (_userManager.FindUserById(id) is null)
            {
                // [核心修改] 不再注销和创建新ID，而是用旧ID直接在内存中“恢复”这个用户
                _userManager.CreateUser(id, id);
            }
        }

        await _next(context);
    }
}

public static class PreprocessMiddlewareExtension
{
    public static IApplicationBuilder UsePreprocess(this IApplicationBuilder builder) =>
        builder.UseMiddleware<PreprocessMiddleware>();
}
