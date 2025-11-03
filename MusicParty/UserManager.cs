using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Linq;

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
        var user = new ClaimsPrincipal(new ClaimsIdentity(claims, "Cookies")); 
        
        var authProperties = new AuthenticationProperties
        {
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.AddDays(365),
            AllowRefresh = true
        };

        await _accessor.HttpContext!.SignInAsync("Cookies", user, authProperties);

        // [分支1688修改] 登录时，如果用户档案不存在，则创建它。
        // 这是为了确保即使用户的cookie有效但档案丢失，也能在此处得到重建。
        if (!_users.ContainsKey(id))
        {
            CreateUser(id, id); // 使用ID作为默认名
        }
    }

    public void CreateUser(string id, string name)
    {
        if (_users.ContainsKey(id)) return;

        var newUser = new User(id, name);
        if (_users.TryAdd(id, newUser))
        {
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
        // [分支1688修改] 核心容错逻辑
        // 如果用户在内存中不存在（例如 users.json 被手动清理），则不再抛出异常，
        // 而是为这个来自有效Cookie的ID重新创建一个档案。
        if (!_users.TryGetValue(id, out var oldUser))
        {
            _logger.LogWarning("用户 {UserId} 在档案中不存在，将为其重建档案。", id);
            var newUser = new User(id, newName);
            if (_users.TryAdd(id, newUser))
            {
                await SaveUsersToFileAsync();
            }
        }
        else
        {
            // 如果用户存在，则正常更新。
            var updatedUser = oldUser with { Name = newName, LastSeen = DateTime.UtcNow };
            if (_users.TryUpdate(id, updatedUser, oldUser))
            {
                await SaveUsersToFileAsync();
            }
        }
    }

    public async Task BindMusicApiService(string id, string apiName, string identifier)
    {
        // [分支1688修改] 核心容错逻辑
        // 同样地，如果用户档案不存在，则为其创建新档案并直接添加绑定信息。
        if (!_users.TryGetValue(id, out var oldUser))
        {
            _logger.LogWarning("用户 {UserId} 在档案中不存在，将为其重建档案并绑定服务。", id);
            var newBindings = new Dictionary<string, string> { [apiName] = identifier };
            var newUser = new User(id, id) { MusicApiServiceBindings = newBindings }; // 默认名使用ID
            if (_users.TryAdd(id, newUser))
            {
                await SaveUsersToFileAsync();
            }
        }
        else
        {
            // 如果用户存在，则正常更新绑定。
            var newBindings = new Dictionary<string, string>(oldUser.MusicApiServiceBindings)
            {
                [apiName] = identifier
            };
            var updatedUser = oldUser with { MusicApiServiceBindings = newBindings, LastSeen = DateTime.UtcNow };
            if (_users.TryUpdate(id, updatedUser, oldUser))
            {
                await SaveUsersToFileAsync();
            }
        }
    }

    public void UpdateUserLastSeen(string id)
    {
        // [分支1688修改] 核心容错逻辑
        // 在更新最后上线时间时，如果发现用户档案不存在，也为其重建。
        if (_users.TryGetValue(id, out var oldUser))
        {
            if (DateTime.UtcNow - oldUser.LastSeen > TimeSpan.FromHours(1))
            {
                var updatedUser = oldUser with { LastSeen = DateTime.UtcNow };
                if (_users.TryUpdate(id, updatedUser, oldUser))
                {
                    _ = SaveUsersToFileAsync();
                }
            }
        }
        else
        {
            _logger.LogWarning("用户 {UserId} 在档案中不存在，将为其重建档案（来自UpdateUserLastSeen调用）。", id);
            CreateUser(id, id); // 使用CreateUser方法来创建并保存
        }
    }

    public void TouchUserLastSeen(string id)
    {
        if (_users.TryGetValue(id, out var oldUser))
        {
            var updatedUser = oldUser with { LastSeen = DateTime.UtcNow };
            if (_users.TryUpdate(id, updatedUser, oldUser))
            {
                _ = SaveUsersToFileAsync();
            }
        }
        else
        {
            _logger.LogWarning("用户 {UserId} 在档案中不存在，将为其重建档案（来自TouchUserLastSeen调用）。", id);
            CreateUser(id, id);
        }
    }

    public IReadOnlyList<User> GetUsersLastSeenWithin(TimeSpan window)
    {
        var threshold = DateTime.UtcNow - window;
        return _users.Values
            .Where(user => user.LastSeen >= threshold)
            .OrderByDescending(user => user.LastSeen)
            .ToList();
    }
}
