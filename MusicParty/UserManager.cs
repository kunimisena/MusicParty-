using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using System.Collections.Generic; // [新增] 为 List<User> FindAll 添加引用
using System.Linq; // [新增] 为 .ToList() 添加引用

namespace MusicParty;

public class UserManager
{
    private readonly IHttpContextAccessor _accessor;
    private readonly List<User> _users = new();
    
    // [新增] 定义用户超时时间，例如2分钟
    private static readonly TimeSpan UserTimeout = TimeSpan.FromMinutes(2);

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
    
    public void CreateUser(string id, string name)
    {
        if (FindUserById(id) is null)
        {
            _users.Add(new User(id, name, new()));
        }
    }

    // [新增] 公开方法，用于接收心跳并更新用户的最后活动时间
    public void UpdateUserHeartbeat(string id)
    {
        var user = FindUserById(id);
        if (user is not null)
        {
            user.LastHeartbeat = DateTime.UtcNow;
        }
    }

    // [新增] 核心方法：清理所有心跳超时的非活动用户（“幽灵”）
    // 返回被清理的用户ID列表，以便广播通知
    public List<string> ClearInactiveUsers()
    {
        var inactiveUserIds = _users
            .Where(u => DateTime.UtcNow - u.LastHeartbeat > UserTimeout)
            .Select(u => u.Id)
            .ToList();

        if (inactiveUserIds.Any())
        {
            _users.RemoveAll(u => inactiveUserIds.Contains(u.Id));
        }

        return inactiveUserIds;
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
        var bindings = user.MusicApiServiceBindings;
        var lastHeartbeat = user.LastHeartbeat; // 保留最后心跳时间

        _users.Remove(user);
        
        // [修改] 创建新用户记录时，保留其绑定信息和最后心跳时间
        var newUser = new User(id, newName, bindings)
        {
            LastHeartbeat = lastHeartbeat
        };
        _users.Add(newUser);
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
