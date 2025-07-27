using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using System.Collections.Concurrent;
using System.Text.Json;

namespace MusicParty;

/// <summary>
/// "户籍处": 管理用户核心档案 (Profile) 的服务。
/// 负责档案的持久化存储和读取。
/// </summary>
public class UserManager
{
    private readonly IHttpContextAccessor _accessor;
    private readonly ILogger<UserManager> _logger;

    // "户籍库": 使用线程安全的字典在内存中存储所有用户档案。
    private readonly ConcurrentDictionary<string, User> _users = new();

    // 档案持久化相关设置
    private const string UsersFilePath = "users.json";
    private static readonly object _fileLock = new();
    private static readonly TimeSpan _inactiveProfileCleanupThreshold = TimeSpan.FromDays(180);

    public UserManager(IHttpContextAccessor accessor, ILogger<UserManager> logger)
    {
        _accessor = accessor;
        _logger = logger;

        // 服务器启动时，从文件加载所有用户档案。
        LoadUsersFromFile();
    }

    private void LoadUsersFromFile()
    {
        lock (_fileLock)
        {
            try
            {
                if (!File.Exists(UsersFilePath)) return;

                var json = File.ReadAllText(UsersFilePath);
                var usersFromFile = JsonSerializer.Deserialize<List<User>>(json);

                if (usersFromFile != null)
                {
                    foreach (var user in usersFromFile)
                    {
                        _users.TryAdd(user.Id, user);
                    }
                    _logger.LogInformation("成功从 {FilePath} 加载了 {Count} 个用户档案。", UsersFilePath, _users.Count);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "从 {FilePath} 加载用户档案失败。", UsersFilePath);
            }
        }
    }

    private async Task SaveUsersToFileAsync()
    {
        await Task.Run(() =>
        {
            lock (_fileLock)
            {
                try
                {
                    var activeUsers = _users.Values
                        .Where(u => DateTime.UtcNow - u.LastSeen < _inactiveProfileCleanupThreshold)
                        .ToList();

                    var json = JsonSerializer.Serialize(activeUsers, new JsonSerializerOptions { WriteIndented = true });
                    File.WriteAllText(UsersFilePath, json);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "写入用户档案到 {FilePath} 失败。", UsersFilePath);
                }
            }
        });
    }

    public async Task LoginAsync(string id)
    {
        var claims = new List<Claim> { new(ClaimTypes.Name, id) };
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "Cookies")); // Schema name should match
        
        // [最终修复] 在登录时明确指定Cookie是持久化的
        var authProperties = new AuthenticationProperties
        {
            // 明确告知认证系统，这是一个持久化登录，不是临时的会话。
            // 这是解决问题的最关键一行。
            IsPersistent = true,

            // 设置一个非常长的过期时间，与 Program.cs 中的配置保持一致
            ExpiresUtc = DateTimeOffset.UtcNow.AddDays(365),

            // 允许在身份验证票据过期前自动刷新
            AllowRefresh = true
        };

        await _accessor.HttpContext!.SignInAsync("Cookies", user, authProperties);

        // 如果是新用户，则创建档案并保存
        if (!_users.ContainsKey(id))
        {
            CreateUser(id, id);
        }
    }

    public void CreateUser(string id, string name)
    {
        if (_users.ContainsKey(id)) return;

        var newUser = new User(id, name);
        if (_users.TryAdd(id, newUser))
        {
            // 档案变更，立即异步保存到文件
            _ = SaveUsersToFileAsync();
        }
    }

    public User? FindUserById(string id)
    {
        _users.TryGetValue(id, out var user);
        return user;
    }

    public async Task RenameUserById(string id, string newName)
    {
        if (!_users.TryGetValue(id, out var oldUser))
        {
            throw new ArgumentException($"No user whose id is {id}.", nameof(id));
        }

        var newUser = oldUser with { Name = newName, LastSeen = DateTime.UtcNow };

        if (_users.TryUpdate(id, newUser, oldUser))
        {
            await SaveUsersToFileAsync();
        }
    }

    public async Task BindMusicApiService(string id, string apiName, string identifier)
    {
        if (!_users.TryGetValue(id, out var oldUser))
        {
            throw new ArgumentException($"No user whose id is {id}.", nameof(id));
        }

        var newBindings = new Dictionary<string, string>(oldUser.MusicApiServiceBindings);
        newBindings[apiName] = identifier;

        var newUser = oldUser with { MusicApiServiceBindings = newBindings, LastSeen = DateTime.UtcNow };

        if (_users.TryUpdate(id, newUser, oldUser))
        {
            await SaveUsersToFileAsync();
        }
    }
    
    public void UpdateUserLastSeen(string id)
    {
        if (_users.TryGetValue(id, out var oldUser))
        {
            if (DateTime.UtcNow - oldUser.LastSeen > TimeSpan.FromHours(1))
            {
                var newUser = oldUser with { LastSeen = DateTime.UtcNow };
                if (_users.TryUpdate(id, newUser, oldUser))
                {
                    _ = SaveUsersToFileAsync();
                }
            }
        }
    }
}
