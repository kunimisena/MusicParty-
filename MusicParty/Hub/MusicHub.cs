using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MusicParty.MusicApi;
using System.Collections.Concurrent; // [新增] 为 ConcurrentDictionary 添加引用
using System.Text.Json;
using System.Text.Json.Serialization;
using static MusicParty.MusicBroadcaster;

namespace MusicParty.Hub;

[Authorize]
public class MusicHub : Microsoft.AspNetCore.SignalR.Hub
{
    public class ChatMessage
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = "";
        [JsonPropertyName("content")]
        public string Content { get; set; } = "";
        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }
    }

    // [新增] 用于安全地管理待删除任务的字典
    private static readonly ConcurrentDictionary<string, CancellationTokenSource> _pendingDisconnects = new();

    private static HashSet<string> OnlineUsers { get; } = new();
    private static List<string> DuplicatedConnectionIds { get; } = new();
    private readonly IEnumerable<IMusicApi> _musicApis;
    private readonly MusicBroadcaster _musicBroadcaster;
    private readonly UserManager _userManager;
    private readonly ILogger<MusicHub> _logger;
    private static readonly string _chatHistoryFilePath = "chat_history.txt";
    private static readonly object _fileLock = new object();
    private static bool _historyLoaded = false;
    private const string RobotEnqueuerId = "auto-dj-robot";
    private const string RobotEnqueuerName = "自动点歌机器人";
    private static readonly LinkedList<ChatMessage> _messageQueue = new();

    public List<ChatMessage> GetChatHistory() => _messageQueue.ToList();

    public MusicHub(IEnumerable<IMusicApi> musicApis, MusicBroadcaster musicBroadcaster,
        UserManager userManager, ILogger<MusicHub> logger)
    {
        _musicApis = musicApis;
        _musicBroadcaster = musicBroadcaster;
        _userManager = userManager;
        _logger = logger;
        LoadChatHistoryFromFile();
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
                    foreach (var message in recentMessages.Reverse())
                    {
                        _messageQueue.AddLast(message);
                    }
                    _logger.LogInformation("成功从 {FilePath} 加载了 {Count} 条聊天记录。", _chatHistoryFilePath, _messageQueue.Count);
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
            lock (_fileLock) 
            {
                 File.AppendAllText(_chatHistoryFilePath, jsonString + Environment.NewLine);
            }
            await Task.CompletedTask;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "写入聊天记录到文件失败: {FilePath}", _chatHistoryFilePath);
        }
    }

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User!.Identity!.Name!;

        // [修改] 如果该用户存在待删除任务，则立即取消它，防止用户因刷新页面被误删
        if (_pendingDisconnects.TryRemove(userId, out var cts))
        {
            cts.Cancel();
            _logger.LogInformation("User {UserId} reconnected, cancelling pending disconnect.", userId);
        }

        if (OnlineUsers.Contains(userId))
        {
            DuplicatedConnectionIds.Add(Context.ConnectionId);
            await Clients.Caller.SendAsync("Abort", "您已在别处登录。");
            Context.Abort();
            return;
        }

        OnlineUsers.Add(userId);
        _userManager.UpdateUserHeartbeat(userId);
        await OnlineUserLogin(Clients.Others, userId);
        
        if (_musicBroadcaster.NowPlaying is not null) {
            var (music, _, enqueuerName, _, _) = _musicBroadcaster.NowPlaying.Value;
            await SetNowPlaying(Clients.Caller, music, enqueuerName,
                (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
        }
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        if (DuplicatedConnectionIds.Contains(Context.ConnectionId))
        {
            DuplicatedConnectionIds.Remove(Context.ConnectionId);
            return Task.CompletedTask;
        }

        var userId = Context.User?.Identity?.Name;
        if (string.IsNullOrEmpty(userId))
        {
            return Task.CompletedTask;
        }

        // [修改] 启动一个可取消的、5秒后执行的延迟删除任务
        var cts = new CancellationTokenSource();
        _pendingDisconnects[userId] = cts;

        Task.Run(async () =>
        {
            try
            {
                // 等待5秒，这个等待可以被新连接的 OnConnectedAsync 方法取消
                await Task.Delay(TimeSpan.FromSeconds(5), cts.Token);

                // 如果5秒后任务没有被取消，说明用户真的离开了，执行清理
                _logger.LogInformation("User {UserId} did not reconnect in 5s. Proceeding with cleanup.", userId);
                
                // 注意：这里不再需要 _userManager.RemoveUser(userId)
                // 因为用户的移除现在完全由 MusicBroadcaster 中的心跳大扫除机制负责，
                // 这里的 OnlineUsers.Remove 是为了让 GetOnlineUsers() 能即时反映正确的人数。
                OnlineUsers.Remove(userId); 
                
                await OnlineUserLogout(userId);
            }
            catch (OperationCanceledException)
            {
                // 任务被取消，说明用户已经重连，在日志中记录一下即可
                _logger.LogInformation("Cleanup for user {UserId} was cancelled due to reconnection.", userId);
            }
            finally
            {
                // 无论任务是完成还是被取消，都从字典中移除记录并释放资源
                _pendingDisconnects.TryRemove(userId, out _);
                cts.Dispose();
            }
        });

        return Task.CompletedTask;
    }

    #region Remote invokable
    
    public void Heartbeat()
    {
        var userId = Context.User?.Identity?.Name;
        if (!string.IsNullOrEmpty(userId))
        {
            _userManager.UpdateUserHeartbeat(userId);
        }
    }

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

    public async Task EnqueueMusic(string id, string apiName)
    {
        if (!_musicApis.TryGetMusicApi(apiName, out var ma))
            throw new HubException($"Unknown api provider {apiName}.");
        try
        {
            var music = await ma!.GetMusicByIdAsync(id);
            await _musicBroadcaster.EnqueueMusic(music, apiName, Context.User!.Identity!.Name!, isReplay: false);
        }
        catch (Exception ex)
        {
            throw new HubException($"Failed to enqueue music, id: {id}", ex);
        }
    }
    
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

    public async Task RequestSetNowPlaying()
    {
        if (_musicBroadcaster.NowPlaying is null) return;
        var (music, _, enqueuerName, _, _) = _musicBroadcaster.NowPlaying.Value;
        
        await SetNowPlaying(Clients.Caller, music, enqueuerName,
            (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
    }

    public IEnumerable<PlayHistoryEntry> GetPlayHistory()
    {
        return _musicBroadcaster.GetPlayHistory();
    }

    public record MusicEnqueueOrder(string ActionId, Music Music, string EnqueuerName);

    public IEnumerable<MusicEnqueueOrder> GetMusicQueue()
    {
        return _musicBroadcaster.GetQueue().Select(x =>
            new MusicEnqueueOrder(x.ActionId, x.Music, x.EnqueuerName)).ToList();
    }

    public async Task NextSong()
    {
        await _musicBroadcaster.NextSong(Context.User!.Identity!.Name!);
    }

    public async Task TopSong(string actionId)
    {
        await _musicBroadcaster.TopSong(actionId, Context.User!.Identity!.Name!);
    }

    public async Task<User> Rename(string newName)
    {
        var userId = Context.User!.Identity!.Name!;
        _userManager.RenameUserById(userId, newName);
        await OnlineUserRename(userId);
        
        var updatedUser = _userManager.FindUserById(userId)!;
        return new User(updatedUser.Id, updatedUser.Name);
    }

    public record User(string Id, string Name);

    public IEnumerable<User> GetOnlineUsers()
    {
        return OnlineUsers.Select(id => _userManager.FindUserById(id))
                          .Where(user => user != null)
                          .Select(user => new User(user!.Id, user.Name))
                          .ToList();
    }

    public async Task ChatSay(string content)
    {
        var name = _userManager.FindUserById(Context.User!.Identity!.Name!)!.Name;
        
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
        
        await Clients.All.SendAsync(nameof(NewChat), newMsg.Name, newMsg.Content, newMsg.Timestamp);
    }
    #endregion

    private string GetEnqueuerName(string enqueuerId)
    {
        if (enqueuerId == RobotEnqueuerId)
        {
            return RobotEnqueuerName;
        }
        return _userManager.FindUserById(enqueuerId)?.Name ?? "未知用户";
    }

    private async Task SetNowPlaying(IClientProxy target, PlayableMusic music, string enqueuerName, int playedTime)
    {
        await target.SendAsync(nameof(SetNowPlaying), music, enqueuerName, playedTime);
    }

    private async Task OnlineUserLogin(IClientProxy target, string id)
    {
        await target.SendAsync(nameof(OnlineUserLogin), id, _userManager.FindUserById(id)?.Name ?? "新用户");
    }

    private async Task OnlineUserLogout(string id)
    {
        await Clients.All.SendAsync(nameof(OnlineUserLogout), id);
    }

    private async Task OnlineUserRename(string id)
    {
        await Clients.All.SendAsync(nameof(OnlineUserRename), id, _userManager.FindUserById(id)!.Name);
    }
    
    private async Task NewChat(IClientProxy target, string name, string content, long timestamp)
    {
        await target.SendAsync(nameof(NewChat), name, content.Trim(), timestamp);
    }
}
