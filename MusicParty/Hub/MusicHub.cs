using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MusicParty.MusicApi;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Diagnostics;
using System.Threading;
using System.Linq;
using MusicParty.Utils;

namespace MusicParty.Hub;

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
    
    private static readonly ConcurrentDictionary<string, UserSession> _sessions = new();
    private static readonly TimeSpan _heartbeatTimeout = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan _cleanupInterval = TimeSpan.FromMinutes(1);

    private readonly UserManager _userManager; 
    private readonly MusicBroadcaster _musicBroadcaster;
    private readonly IEnumerable<IMusicApi> _musicApis;
    private readonly ILogger<MusicHub> _logger;
    private static Timer? _cleanupTimer; 

    private static readonly string _chatHistoryFilePath = "chat_history.txt";
    private static readonly object _fileLock = new object();
    private static bool _historyLoaded = false;
    private static readonly LinkedList<ChatMessage> _messageQueue = new();

    private const int ReservationMaxRooms = 20;
    private const int ReservationMaxOwnedRooms = 2;
    private const int ReservationMaxDurationMinutes = 120;
    private static readonly object _reservationLock = new();
    private static readonly List<ReservationRoom> _reservations = new();
    private static UserManager? _reservationUserManager;

    private enum ReservationStatus
    {
        Upcoming,
        Ongoing,
        Ended
    }

    private record ReservationParticipant(string UserId, string UserName, DateTime JoinedAtUtc);

    private class ReservationRoom
    {
        public string Id { get; } = Guid.NewGuid().ToString("N");
        public string Title { get; set; } = string.Empty;
        public string Detail { get; set; } = string.Empty;
        public string HostId { get; set; } = string.Empty;
        public string HostName { get; set; } = string.Empty;
        public DateTime StartTimeUtc { get; set; }
        public int DurationMinutes { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public List<ReservationParticipant> Participants { get; } = new();

        public DateTime EndTimeUtc => StartTimeUtc.AddMinutes(DurationMinutes);

        public ReservationStatus GetStatus(DateTime nowUtc)
        {
            if (nowUtc < StartTimeUtc)
            {
                return ReservationStatus.Upcoming;
            }

            if (nowUtc <= EndTimeUtc)
            {
                return ReservationStatus.Ongoing;
            }

            return ReservationStatus.Ended;
        }
    }

    public MusicHub(UserManager userManager, MusicBroadcaster musicBroadcaster, IEnumerable<IMusicApi> musicApis, ILogger<MusicHub> logger, IHubContext<MusicHub> hubContext)
    {
        _userManager = userManager;
        _musicBroadcaster = musicBroadcaster;
        _musicApis = musicApis;
        _logger = logger;

        Interlocked.CompareExchange(ref _reservationUserManager, userManager, null);

        LoadChatHistoryFromFile();
        Interlocked.CompareExchange(ref _cleanupTimer, new Timer(CleanupInactiveSessions, hubContext, _cleanupInterval, _cleanupInterval), null);
    }
    
    public static bool HasActiveSessions()
    {
        if (_sessions.IsEmpty) return false;
        return _sessions.Values.Any(s => DateTime.UtcNow - s.LastHeartbeat < _heartbeatTimeout);
    }

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User!.Identity!.Name!;
        var session = new UserSession(userId, DateTime.UtcNow);

        _sessions[userId] = session;
        
        _userManager.UpdateUserLastSeen(userId);

        await OnlineUserLogin(userId);

        if (_musicBroadcaster.NowPlaying is not null)
        {
            var (music, _, enqueuerName, _, _) = _musicBroadcaster.NowPlaying.Value;
            await Clients.Caller.SendAsync("SetNowPlaying", music, enqueuerName, (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
        }

        await Clients.Caller.SendAsync("ReservationSnapshot", BuildReservationSnapshot(_userManager));

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
            await OnlineUserLogout(userId);
        }

        _userManager.TouchUserLastSeen(userId);

        if (RemoveUserFromReservations(userId))
        {
            await Clients.All.SendAsync("ReservationSnapshot", BuildReservationSnapshot(_userManager));
        }

        await base.OnDisconnectedAsync(exception);
    }

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
        // --- [最终版核心修改] ---
        // 修复了同步按钮在歌曲播放完毕后失效的致命BUG
        if (_musicBroadcaster.NowPlaying is null)
        {
            // 如果服务器当前没有歌曲在播放，不能再保持沉默。
            // 必须明确告知客户端“停止播放”，以便客户端UI能被纠正到正确的状态。
            await Clients.Caller.SendAsync("StopPlayback");
        }
        else
        {
            // 如果有歌曲在播放，则按原逻辑发送同步信息。
            var (music, _, enqueuerName, _, _) = _musicBroadcaster.NowPlaying.Value;
            await Clients.Caller.SendAsync("SetNowPlaying", music, enqueuerName,
                (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
        }
    }

    public IEnumerable<object> GetMusicQueue()
    {
        return _musicBroadcaster.GetQueue().Select(x =>
            new { x.ActionId, x.Music, x.EnqueuerName }).ToList();
    }
    
    public List<ChatMessage> GetChatHistory() => _messageQueue.ToList();

    public IEnumerable<object> GetPlayHistory()
    {
        return _musicBroadcaster.GetPlayHistory().Select(x =>
            new { x.Music, x.ApiName, x.EnqueuerName, x.Timestamp });
    }

    public async Task CreateReservation(string title, string detail, DateTime startTimeUtc, int durationMinutes)
    {
        var userId = Context.User!.Identity!.Name!;
        var hostName = _userManager.FindUserById(userId)?.Name ?? "未知用户";
        var nowUtc = DateTime.UtcNow;

        if (string.IsNullOrWhiteSpace(title))
        {
            throw new HubException("预约标题不能为空。");
        }

        if (durationMinutes <= 0 || durationMinutes > ReservationMaxDurationMinutes)
        {
            throw new HubException($"预约时长需在 1 至 {ReservationMaxDurationMinutes} 分钟之间。");
        }

        startTimeUtc = DateTime.SpecifyKind(startTimeUtc, DateTimeKind.Utc);

        if (startTimeUtc < nowUtc.AddMinutes(10))
        {
            throw new HubException("开始时间至少需要晚于当前时间 10 分钟。");
        }

        lock (_reservationLock)
        {
            TrimExceededReservationsUnsafe(nowUtc);

            var activeCount = _reservations.Count(room => room.GetStatus(nowUtc) != ReservationStatus.Ended);
            if (activeCount >= ReservationMaxRooms)
            {
                throw new HubException("当前预约数量已达上限，请稍后再试。");
            }

            var ownedCount = _reservations.Count(room => room.HostId == userId && room.GetStatus(nowUtc) != ReservationStatus.Ended);
            if (ownedCount >= ReservationMaxOwnedRooms)
            {
                throw new HubException($"您已拥有 {ReservationMaxOwnedRooms} 个预约，无法再创建新的预约。");
            }

            var room = new ReservationRoom
            {
                Title = title.Trim(),
                Detail = string.IsNullOrWhiteSpace(detail) ? string.Empty : detail.Trim(),
                HostId = userId,
                HostName = hostName,
                StartTimeUtc = startTimeUtc,
                DurationMinutes = durationMinutes,
                CreatedAtUtc = nowUtc
            };

            room.Participants.Add(new ReservationParticipant(userId, hostName, nowUtc));
            _reservations.Add(room);

            TrimExceededReservationsUnsafe(nowUtc);
        }

        await Clients.All.SendAsync("ReservationSnapshot", BuildReservationSnapshot(_userManager));
    }

    public async Task JoinReservation(string reservationId)
    {
        var userId = Context.User!.Identity!.Name!;
        var userName = _userManager.FindUserById(userId)?.Name ?? "未知用户";
        var nowUtc = DateTime.UtcNow;
        var hasJoined = false;

        lock (_reservationLock)
        {
            var room = _reservations.FirstOrDefault(r => r.Id == reservationId);
            if (room is null)
            {
                throw new HubException("预约不存在或已被删除。");
            }

            if (room.GetStatus(nowUtc) == ReservationStatus.Ended)
            {
                throw new HubException("该预约已结束。");
            }

            if (room.Participants.Any(p => p.UserId == userId))
            {
                return;
            }

            room.Participants.Add(new ReservationParticipant(userId, userName, nowUtc));
            hasJoined = true;
        }

        if (hasJoined)
        {
            await Clients.All.SendAsync("ReservationSnapshot", BuildReservationSnapshot(_userManager));
        }
    }

    public async Task LeaveReservation(string reservationId)
    {
        var userId = Context.User!.Identity!.Name!;
        if (RemoveUserFromReservations(userId, reservationId))
        {
            await Clients.All.SendAsync("ReservationSnapshot", BuildReservationSnapshot(_userManager));
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
    
    public async Task<string> GeneratePlaylistFromHistory(string userCookie, string startTime, string endTime)
    {
        var history = _musicBroadcaster.GetPlayHistory();
        var result = await PlaylistGenerator.CreateNeteasePlaylistAsync(history, userCookie, startTime, endTime);
        return result;
    }

    public Task AdminRestartServer()
    {
        _logger.LogWarning("Admin user {UserId} triggered a server restart.", Context.UserIdentifier);
        
        string scriptPath = Path.Combine(AppContext.BaseDirectory, "#test.bat");

        if (File.Exists(scriptPath))
        {
            Process.Start("cmd.exe", $"/c start \"Restarting Server\" \"{scriptPath}\"");
        }
        else
        {
            _logger.LogError("Restart script not found at {Path}", scriptPath);
            throw new HubException("服务器重启失败: 未在预期位置找到 #test.bat 脚本。");
        }

        return Task.CompletedTask;
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
        if (UpdateReservationUserName(id, newUserName))
        {
            await Clients.All.SendAsync("ReservationSnapshot", BuildReservationSnapshot(_userManager));
        }
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
                if (RemoveUserFromReservations(userId) && _reservationUserManager is not null)
                {
                    var snapshot = BuildReservationSnapshot(_reservationUserManager);
                    hubContext.Clients.All.SendAsync("ReservationSnapshot", snapshot);
                }
            }
        }
    }

    private static void TrimExceededReservationsUnsafe(DateTime nowUtc)
    {
        var emptyRooms = _reservations.Where(room => room.Participants.Count == 0).ToList();
        foreach (var room in emptyRooms)
        {
            _reservations.Remove(room);
        }

        if (_reservations.Count <= ReservationMaxRooms) return;

        var endedRooms = _reservations
            .Where(room => room.GetStatus(nowUtc) == ReservationStatus.Ended)
            .OrderBy(room => room.EndTimeUtc)
            .ToList();

        foreach (var room in endedRooms)
        {
            if (_reservations.Count <= ReservationMaxRooms) break;
            _reservations.Remove(room);
        }
    }

    private static bool RemoveUserFromReservations(string userId, string? reservationId = null)
    {
        var changed = false;
        lock (_reservationLock)
        {
            var nowUtc = DateTime.UtcNow;
            var targetRooms = reservationId is null
                ? _reservations.ToList()
                : _reservations.Where(room => room.Id == reservationId).ToList();

            foreach (var room in targetRooms)
            {
                var participantIndex = room.Participants.FindIndex(p => p.UserId == userId);
                if (participantIndex < 0) continue;

                room.Participants.RemoveAt(participantIndex);
                changed = true;

                if (room.HostId == userId)
                {
                    if (room.Participants.Count > 0)
                    {
                        var nextHost = room.Participants.OrderBy(p => p.JoinedAtUtc).First();
                        room.HostId = nextHost.UserId;
                        room.HostName = nextHost.UserName;
                    }
                    else
                    {
                        _reservations.Remove(room);
                        if (reservationId is not null) break;
                        continue;
                    }
                }
                else if (room.Participants.Count == 0)
                {
                    _reservations.Remove(room);
                    if (reservationId is not null) break;
                    continue;
                }

                if (reservationId is not null)
                {
                    break;
                }
            }

            TrimExceededReservationsUnsafe(nowUtc);
        }

        return changed;
    }

    private static bool UpdateReservationUserName(string userId, string newName)
    {
        var updated = false;
        lock (_reservationLock)
        {
            foreach (var room in _reservations)
            {
                if (room.HostId == userId && room.HostName != newName)
                {
                    room.HostName = newName;
                    updated = true;
                }

                for (var i = 0; i < room.Participants.Count; i++)
                {
                    if (room.Participants[i].UserId == userId && room.Participants[i].UserName != newName)
                    {
                        room.Participants[i] = room.Participants[i] with { UserName = newName };
                        updated = true;
                    }
                }
            }
        }

        return updated;
    }

    private static object BuildReservationSnapshot(UserManager userManager)
    {
        var nowUtc = DateTime.UtcNow;
        List<object> rooms;

        lock (_reservationLock)
        {
            TrimExceededReservationsUnsafe(nowUtc);

            rooms = _reservations
                .OrderBy(room => room.GetStatus(nowUtc) switch
                {
                    ReservationStatus.Ongoing => 0,
                    ReservationStatus.Upcoming => 1,
                    _ => 2
                })
                .ThenBy(room => room.StartTimeUtc)
                .ThenBy(room => room.CreatedAtUtc)
                .Select(room => (object)new
                {
                    id = room.Id,
                    title = room.Title,
                    detail = room.Detail,
                    host = new { id = room.HostId, name = room.HostName },
                    participants = room.Participants
                        .OrderBy(p => p.JoinedAtUtc)
                        .Select(p => new { id = p.UserId, name = p.UserName, joinedAtUtc = p.JoinedAtUtc })
                        .ToList(),
                    startTimeUtc = room.StartTimeUtc,
                    durationMinutes = room.DurationMinutes,
                    status = room.GetStatus(nowUtc).ToString(),
                    createdAtUtc = room.CreatedAtUtc
                })
                .ToList();
        }

        var recentVisitors = userManager
            .GetUsersLastSeenWithin(TimeSpan.FromHours(24))
            .Select(user => new { id = user.Id, name = user.Name, lastSeenUtc = user.LastSeen })
            .ToList();

        return new
        {
            rooms,
            config = new
            {
                maxRooms = ReservationMaxRooms,
                maxOwnedRooms = ReservationMaxOwnedRooms,
                maxDurationMinutes = ReservationMaxDurationMinutes
            },
            recentVisitors
        };
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

