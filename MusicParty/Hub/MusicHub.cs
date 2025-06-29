using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MusicParty.MusicApi;
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
                    var recentMessages = allMessages.TakeLast(30);
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
        if (OnlineUsers.Contains(Context.User!.Identity!.Name!))
        {
            DuplicatedConnectionIds.Add(Context.ConnectionId);
            await Clients.Caller.SendAsync("Abort", "您已在别处登录。");
            Context.Abort();
            return;
        }

        OnlineUsers.Add(Context.User.Identity.Name!);
        await OnlineUserLogin(Clients.Others, Context.User.Identity.Name!);
        
        if (_musicBroadcaster.NowPlaying is not null) {
            var (music, enqueuerId, _, isReplay) = _musicBroadcaster.NowPlaying.Value;
            await SetNowPlaying(Clients.Caller, music, GetEnqueuerName(enqueuerId),
                (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (DuplicatedConnectionIds.Contains(Context.ConnectionId))
        {
            DuplicatedConnectionIds.Remove(Context.ConnectionId);
            return;
        }

        var userId = Context.User?.Identity?.Name;
        if (!string.IsNullOrEmpty(userId))
        {
            OnlineUsers.Remove(userId);
            _userManager.RemoveUser(userId);
            await OnlineUserLogout(userId);
        }
    }

    #region Remote invokable
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

    public async Task ReplayMusic(string musicId, string apiName, string originalEnqueuerId)
    {
        if (!_musicApis.TryGetMusicApi(apiName, out var ma))
            throw new HubException($"Unknown api provider {apiName}.");
        
        var originalEnqueuer = _userManager.FindUserById(originalEnqueuerId);
        if (originalEnqueuer == null && originalEnqueuerId != RobotEnqueuerId)
        {
            _logger.LogWarning("Replay attempt with an unknown original enqueuer ID: {originalEnqueuerId}", originalEnqueuerId);
            throw new HubException("Invalid original enqueuer.");
        }

        try
        {
            var music = await ma!.GetMusicByIdAsync(musicId);
            await _musicBroadcaster.EnqueueMusic(music, apiName, originalEnqueuerId, isReplay: true);
        }
        catch (Exception ex)
        {
            throw new HubException($"Failed to replay music, id: {musicId}", ex);
        }
    }

    public async Task RequestSetNowPlaying()
    {
        if (_musicBroadcaster.NowPlaying is null) return;
        var (music, enqueuerId, _, isReplay) = _musicBroadcaster.NowPlaying.Value;
        
        await SetNowPlaying(Clients.Caller, music, GetEnqueuerName(enqueuerId),
            (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
    }

    public IEnumerable<PlayHistoryEntry> GetPlayHistory()
    {
        return _musicBroadcaster.GetPlayHistory();
    }

    public record MusicEnqueueOrder(string ActionId, Music Music, string EnqueuerName);

    public IEnumerable<MusicEnqueueOrder> GetMusicQueue()
    {
        // [错误修复] 调用 MusicBroadcaster 的公共 GetQueue() 方法
        return _musicBroadcaster.GetQueue().Select(x =>
            new MusicEnqueueOrder(x.ActionId, x.Music, GetEnqueuerName(x.EnqueuerId))).ToList();
    }

    public async Task NextSong()
    {
        await _musicBroadcaster.NextSong(Context.User!.Identity!.Name!);
    }

    public async Task TopSong(string actionId)
    {
        await _musicBroadcaster.TopSong(actionId, Context.User!.Identity!.Name!);
    }

    public async Task Rename(string newName)
    {
        _userManager.RenameUserById(Context.User!.Identity!.Name!, newName);
        await OnlineUserRename(Context.User.Identity.Name!);
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
        
        while (_messageQueue.Count > 100) 
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
