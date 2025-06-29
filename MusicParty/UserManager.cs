using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;

namespace MusicParty;

public class UserManager
{
    private readonly IHttpContextAccessor _accessor;
    private readonly List<User> _users = new();

    public UserManager(IHttpContextAccessor accessor)
    {
        _accessor = accessor;
    }

    public bool HasOnlineUsers()
    {
        return _users.Any();
    }

    // --- 新增方法 开始 ---
    /// <summary>
    /// 当用户断开连接时，从用户列表中移除该用户。
    /// 这个方法将由 MusicHub 在用户断开时调用。
    /// </summary>
    /// <param name="id">要移除的用户的ID。</param>
    public void RemoveUser(string id)
    {
        // 使用 RemoveAll 以确保移除所有匹配项，并处理可能的并发问题。
        _users.RemoveAll(x => x.Id == id);
    }
    // --- 新增方法 结束 ---

    private void CreateUser(string id, string name)
    {
        _users.Add(new User(id, name, new()));
    }

    public async Task LoginAsync(string id)
    {
        var claims = new List<Claim>()
        {
            new(ClaimTypes.Name, id)
        };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "any"));
        await _accessor.HttpContext!.SignInAsync("Cookies", user, new AuthenticationProperties()
        {
            ExpiresUtc = DateTimeOffset.MaxValue
        });
        CreateUser(id, id);
    }

    public async Task LogoutAsync(string id)
    {
        await _accessor.HttpContext!.SignOutAsync("Cookies");
        // 调用我们自己的移除方法以保持逻辑统一
        RemoveUser(id);
    }

    public User? FindUserById(string id)
    {
        return _users.Find(x => x.Id == id);
    }

    public void RenameUserById(string id, string newName)
    {
        var user = FindUserById(id);
        if (user is null) throw new ArgumentException($"No user whose id is {id}.", nameof(id));
        _users.Remove(user);
        _users.Add(user with { Name = newName });
    }

    public void BindMusicApiService(string id, string apiName, string identifier)
    {
        var user = FindUserById(id);
        if (user is null) throw new ArgumentException($"No user whose id is {id}.", nameof(id));
        if (user.MusicApiServiceBindings.ContainsKey(apiName))
            user.MusicApiServiceBindings[apiName] = identifier;
        else
            user.MusicApiServiceBindings.Add(apiName, identifier);
    }
}
