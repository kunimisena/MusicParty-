using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MusicParty.MusicApi;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MusicParty.Hub;

/// <summary>
/// "海关": 管理用户的实时在线会话 (Session)。
/// 负责处理连接、断开、心跳，并提供准确的在线用户视图。
/// </summary>
[Authorize]
public class MusicHub : Microsoft.AspNetCore.SignalR.Hub
{
    // --- 内部记录与静态成员 ---
    public record UserSession(string UserId, DateTime LastHeartbeat);
    public class ChatMessage
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = "";
        [JsonPropertyName("content")]
        public string Content { get; set; } = "";
        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }
    }
    
    // "实时会话名单": 存储所有当前连接的用户会话。
    private static readonly ConcurrentDictionary<string, UserSession> _sessions = new();
    private static readonly TimeSpan _heartbeatTimeout = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan _cleanupInterval = TimeSpan.FromMinutes(1);

    private readonly UserManager _userManager; // "户籍处"的引用
    private readonly MusicBroadcaster _musicBroadcaster;
    private readonly IEnumerable<IMusicApi> _musicApis;
    private readonly ILogger<MusicHub> _logger;
    private static Timer? _cleanupTimer; // "巡逻队"定时器

    private static readonly string _chatHistoryFilePath = "chat_history.txt";
    private static readonly object _fileLock = new object();
    private static bool _historyLoaded = false;
    private static readonly LinkedList<ChatMessage> _messageQueue = new();

    public MusicHub(UserManager userManager, MusicBroadcaster musicBroadcaster, IEnumerable<IMusicApi> musicApis, ILogger<MusicHub> logger, IHubContext<MusicHub> hubContext)
    {
        _userManager = userManager;
        _musicBroadcaster = musicBroadcaster;
        _musicApis = musicApis;
        _logger = logger;

        LoadChatHistoryFromFile();
        Interlocked.CompareExchange(ref _cleanupTimer, new Timer(CleanupInactiveSessions, hubContext, _cleanupInterval, _cleanupInterval), null);
    }
    
    // --- 静态方法，供系统其他部分查询实时状态 ---
    
    /// <summary>
    /// 供 MusicBroadcaster 查询是否存在活跃用户会话。
    /// </summary>
    public static bool HasActiveSessions()
    {
        if (_sessions.IsEmpty) return false;
        return _sessions.Values.Any(s => DateTime.UtcNow - s.LastHeartbeat < _heartbeatTimeout);
    }

    // --- SignalR 生命周期事件 ---

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User!.Identity!.Name!;
        var session = new UserSession(userId, DateTime.UtcNow);

        _sessions[userId] = session;
        //_logger.LogInformation("User connected. Session created for {UserId}.", userId);
        
        _userManager.UpdateUserLastSeen(userId);

        await OnlineUserLogin(userId);

        if (_musicBroadcaster.NowPlaying is not null)
        {
            var (music, _, enqueuerName, _, _) = _musicBroadcaster.NowPlaying.Value;
            await Clients.Caller.SendAsync("SetNowPlaying", music, enqueuerName, (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(userId))
        {
            await base.OnDisconnectedAsync(exception);
            return;
        }

        if (_sessions.TryRemove(userId, out _))
        {
            //_logger.LogInformation("User disconnected. Session removed for {UserId}.", userId);
            await OnlineUserLogout(userId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    // --- 客户端可调用方法 (RPC) ---

    #region RPC Methods
    
    public void Heartbeat()
    {
        var userId = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(userId)) return;

        if (_sessions.TryGetValue(userId, out var session))
        {
            _sessions[userId] = session with { LastHeartbeat = DateTime.UtcNow };
        }
    }

    public IEnumerable<object> GetOnlineUsers()
    {
        var onlineUserIds = _sessions.Keys;
        return onlineUserIds
            .Select(id => _userManager.FindUserById(id))
            .Where(user => user != null)
            .Select(user => new { user!.Id, user.Name })
            .ToList();
    }

    public async Task ChatSay(string content)
    {
        var userId = Context.User!.Identity!.Name!;
        var user = _userManager.FindUserById(userId);
        var name = user?.Name ?? "未知用户";

        var newMsg = new ChatMessage
        {
            Name = name,
            Content = content.Trim(),
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
        };

        _messageQueue.AddFirst(newMsg);
        while (_messageQueue.Count > 200)
        {
            _messageQueue.RemoveLast();
        }
        await AppendChatHistoryToFileAsync(newMsg);
        
        await Clients.All.SendAsync("NewChat", newMsg.Name, newMsg.Content, newMsg.Timestamp);
    }
    
    public async Task<object> Rename(string newName)
    {
        var userId = Context.User!.Identity!.Name!;
        await _userManager.RenameUserById(userId, newName);
        
        var updatedUser = _userManager.FindUserById(userId)!;
        await OnlineUserRename(userId);
        return new { updatedUser.Id, updatedUser.Name };
    }

    public async Task EnqueueMusic(string id, string apiName)
    {
        if (!_musicApis.TryGetMusicApi(apiName, out var ma))
            throw new HubException($"Unknown api provider {apiName}.");
        var music = await ma!.GetMusicByIdAsync(id);
        await _musicBroadcaster.EnqueueMusic(music, apiName, Context.User!.Identity!.Name!);
    }
    
    // [修正] 补全缺失的 ReplayMusic 方法
    public async Task ReplayMusic(Music music, string apiName)
    {
        if (!_musicApis.TryGetMusicApi(apiName, out _))
            throw new HubException($"Unknown api provider {apiName}.");

        try
        {
            var currentUserId = Context.User!.Identity!.Name!;
            await _musicBroadcaster.EnqueueMusic(music, apiName, currentUserId, isReplay: true);
        }
        catch (Exception ex)
        {
            throw new HubException($"Failed to replay music, name: {music.Name}", ex);
        }
    }

    public async Task NextSong()
    {
        await _musicBroadcaster.NextSong(Context.User!.Identity!.Name!);
    }

    public async Task TopSong(string actionId)
    {
        await _musicBroadcaster.TopSong(actionId, Context.User!.Identity!.Name!);
    }
    
    public async Task RequestSetNowPlaying()
    {
        if (_musicBroadcaster.NowPlaying is null) return;
        var (music, _, enqueuerName, _, _) = _musicBroadcaster.NowPlaying.Value;
        
        await Clients.Caller.SendAsync("SetNowPlaying", music, enqueuerName,
            (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
    }

    public IEnumerable<object> GetMusicQueue()
    {
        return _musicBroadcaster.GetQueue().Select(x =>
            new { x.ActionId, x.Music, x.EnqueuerName }).ToList();
    }
    
    public List<ChatMessage> GetChatHistory() => _messageQueue.ToList();

    // [修正] 补全缺失的 GetPlayHistory 方法
    public IEnumerable<object> GetPlayHistory()
    {
        return _musicBroadcaster.GetPlayHistory().Select(x =>
            new { x.Music, x.ApiName, x.EnqueuerName, x.Timestamp });
    }

    // [修正] 补全缺失的 AutoDJ 相关方法
    public async Task DisableAutoDj()
    {
        MusicBroadcaster.IsAutoDjManuallyDisabled = true;
        await Clients.All.SendAsync("AutoDjStatusChanged", true);
    }

    public async Task EnableAutoDj()
    {
        MusicBroadcaster.IsAutoDjManuallyDisabled = false;
        await Clients.All.SendAsync("AutoDjStatusChanged", false);
    }

    public bool GetAutoDjStatus()
    {
        return MusicBroadcaster.IsAutoDjManuallyDisabled;
    }

    #endregion

    // --- 私有及辅助方法 ---

    private async Task OnlineUserLogin(string id)
    {
        var userName = _userManager.FindUserById(id)?.Name ?? "新用户";
        await _musicBroadcaster.BroadcastUserLoginAsync(id, userName);
    }

    private async Task OnlineUserLogout(string id)
    {
        await _musicBroadcaster.BroadcastUserLogoutAsync(id);
    }
    
    private async Task OnlineUserRename(string id)
    {
        var newUserName = _userManager.FindUserById(id)!.Name;
        await _musicBroadcaster.BroadcastUserRenameAsync(id, newUserName);
    }

    private void CleanupInactiveSessions(object? state)
    {
        var hubContext = state as IHubContext<MusicHub>;
        if (hubContext == null) return;

        var now = DateTime.UtcNow;
        var inactiveSessionIds = _sessions.Values
            .Where(s => now - s.LastHeartbeat > _heartbeatTimeout)
            .Select(s => s.UserId)
            .ToList();

        foreach (var userId in inactiveSessionIds)
        {
            if (_sessions.TryRemove(userId, out _))
            {
                _logger.LogInformation("Cleaned up inactive session for user {UserId}.", userId);
                hubContext.Clients.All.SendAsync("OnlineUserLogout", userId);
            }
        }
    }
    
    private void LoadChatHistoryFromFile()
    {
        lock (_fileLock)
        {
            if (_historyLoaded) return;
            try
            {
                if (File.Exists(_chatHistoryFilePath))
                {
                    var lines = File.ReadAllLines(_chatHistoryFilePath);
                    var allMessages = new List<ChatMessage>();
                    foreach (var line in lines)
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        try
                        {
                            var message = JsonSerializer.Deserialize<ChatMessage>(line);
                            if (message != null) allMessages.Add(message);
                        }
                        catch (JsonException ex)
                        {
                            _logger.LogWarning(ex, "解析聊天记录文件中的某一行时发生错误: {Line}", line);
                        }
                    }
                    var recentMessages = allMessages.TakeLast(200);
                    _messageQueue.Clear();
                    foreach (var message in recentMessages)
                    {
                        _messageQueue.AddFirst(message);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "加载聊天记录文件失败: {FilePath}", _chatHistoryFilePath);
            }
            finally
            {
                _historyLoaded = true;
            }
        }
    }

    private async Task AppendChatHistoryToFileAsync(ChatMessage message)
    {
        try
        {
            var jsonString = JsonSerializer.Serialize(message);
            await File.AppendAllTextAsync(_chatHistoryFilePath, jsonString + Environment.NewLine);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "写入聊天记录到文件失败: {FilePath}", _chatHistoryFilePath);
        }
    }
}
