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

    public void RemoveUser(string id)
    {
        _users.RemoveAll(x => x.Id == id);
    }

    // [修改] 将 CreateUser 方法改为 public，以便其他地方可以安全地调用
    public void CreateUser(string id, string name)
    {
        // [新增] 在创建用户前，先检查用户是否已存在，防止重复添加。
        // 这样即使有多个并发请求，也只有一个会成功添加用户。
        if (FindUserById(id) is null)
        {
            _users.Add(new User(id, name, new()));
        }
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
