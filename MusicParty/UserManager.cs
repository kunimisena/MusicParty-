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
        // 只有当用户档案已经由前端显式初始化后，才允许绑定外部服务。
        // 这可以阻止纯后端的探测脚本绕过前端创建持久档案。
        if (!_users.TryGetValue(id, out var oldUser))
        {
            throw new InvalidOperationException($"Cannot bind service for user {id} because the profile has not been initialized.");
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
        // 只有档案已经建立时才刷新 LastSeen；否则忽略请求，交由前端初始化流程处理。
        if (!_users.TryGetValue(id, out var oldUser))
        {
            _logger.LogDebug("忽略对用户 {UserId} 的 LastSeen 更新请求：档案尚未初始化。", id);
            return;
        }

        if (DateTime.UtcNow - oldUser.LastSeen > TimeSpan.FromHours(1))
        {
            var updatedUser = oldUser with { LastSeen = DateTime.UtcNow };
            if (_users.TryUpdate(id, updatedUser, oldUser))
            {
                _ = SaveUsersToFileAsync();
            }
        }
    }

    public void TouchUserLastSeen(string id)
    {
        if (!_users.TryGetValue(id, out var oldUser))
        {
            _logger.LogDebug("忽略对用户 {UserId} 的 TouchLastSeen 请求：档案尚未初始化。", id);
            return;
        }

        var updatedUser = oldUser with { LastSeen = DateTime.UtcNow };
        if (_users.TryUpdate(id, updatedUser, oldUser))
        {
            _ = SaveUsersToFileAsync();
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
