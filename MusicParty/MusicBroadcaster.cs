using Microsoft.AspNetCore.SignalR;
using MusicParty.Hub;
using MusicParty.MusicApi;
using System.Text.Json;

namespace MusicParty;

public class MusicBroadcaster
{
    public (PlayableMusic music, string enqueuerId, string enqueuerName, string apiName, bool IsReplay)? NowPlaying { get; private set; }
    private ToppableQueue<MusicOrderAction> MusicQueue { get; } = new();
    public DateTime NowPlayingStartedTime { get; private set; }
    private readonly IEnumerable<IMusicApi> _apis;
    private readonly IHubContext<MusicHub> _context;
    private readonly UserManager _userManager;
    private readonly ILogger<MusicBroadcaster> _logger;

    // [新增] 机器人手动控制开关
    public static bool IsAutoDjManuallyDisabled { get; set; } = false;

    private const string RobotEnqueuerId = "auto-dj-robot";
    private const string RobotEnqueuerName = "自动点歌机器人";
    private const string _autoplaylistPath = "autoplaylist.json";
    private List<AutoplaylistItem> _autoplaylist = new();
    private readonly Random _random = new();
    private record AutoplaylistItem(string Id, string ApiName);

    private enum AutoDjMode { Inactive, Active }
    private AutoDjMode _currentAutoDjMode = AutoDjMode.Inactive;
    private DateTime _lastUserActivityTime = DateTime.Now;
    private readonly TimeSpan _userActivityTimeout = TimeSpan.FromMinutes(1); // 恢复为2分钟
    
    // [新增] 用于控制大扫除频率的变量
    private DateTime _lastSweepTime = DateTime.UtcNow;
    private readonly TimeSpan _sweepInterval = TimeSpan.FromMinutes(1); // 每分钟进行一次大扫除

    public record PlayHistoryEntry(Music Music, string ApiName, string EnqueuerId, string EnqueuerName, DateTime Timestamp);
    private const string _playHistoryPath = "play_history.json";
    private const int _maxPlayHistoryCount = 100;
    private readonly LinkedList<PlayHistoryEntry> _playHistory = new();
    private static readonly object _fileLock = new();

    public MusicBroadcaster(IEnumerable<IMusicApi> apis, IHubContext<MusicHub> context, UserManager userManager,
        ILogger<MusicBroadcaster> logger)
    {
        _apis = apis;
        _context = context;
        _userManager = userManager;
        _logger = logger;
        
        LoadAutoplaylist();
        LoadPlayHistory();
        Task.Run(Loop);
    }
    
    private void LoadAutoplaylist()
    {
        try
        {
            if (File.Exists(_autoplaylistPath))
            {
                var jsonString = File.ReadAllText(_autoplaylistPath);
                var playlist = JsonSerializer.Deserialize<List<AutoplaylistItem>>(jsonString);
                if (playlist != null && playlist.Any())
                {
                    _autoplaylist = playlist;
                    _logger.LogInformation("成功加载自动播放列表，共 {Count} 首歌曲。", _autoplaylist.Count);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "加载自动播放列表失败。");
        }
    }

    private void LoadPlayHistory()
    {
        try
        {
            if (File.Exists(_playHistoryPath))
            {
                var jsonString = File.ReadAllText(_playHistoryPath);
                var history = JsonSerializer.Deserialize<List<PlayHistoryEntry>>(jsonString);
                if (history != null)
                {
                    foreach (var item in history)
                    {
                        _playHistory.AddLast(item);
                    }
                    _logger.LogInformation("成功加载播放历史，共 {Count} 条记录。", _playHistory.Count);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "加载播放历史文件失败: {FilePath}", _playHistoryPath);
        }
    }

    private async Task SavePlayHistoryAsync()
    {
        try
        {
            var jsonString = JsonSerializer.Serialize(_playHistory, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(_playHistoryPath, jsonString);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "写入播放历史到文件失败: {FilePath}", _playHistoryPath);
        }
    }
    
    private async Task AddToHistoryAndSaveAsync((PlayableMusic music, string enqueuerId, string enqueuerName, string apiName, bool IsReplay) playedSong)
    {
        if (playedSong.IsReplay || playedSong.enqueuerId == RobotEnqueuerId)
        {
            return;
        }

        var entry = new PlayHistoryEntry(
            new Music(playedSong.music.Id, playedSong.music.Name, playedSong.music.Artists),
            playedSong.apiName,
            playedSong.enqueuerId,
            playedSong.enqueuerName,
            DateTime.UtcNow
        );

        _playHistory.AddFirst(entry);

        if (_playHistory.Count > _maxPlayHistoryCount)
        {
            _playHistory.RemoveLast();
        }

        await SavePlayHistoryAsync();
    }


    private async Task Loop()
    {
        while (true)
        {
            // [新增] 定时大扫除逻辑
            if (DateTime.UtcNow - _lastSweepTime > _sweepInterval)
            {
                var clearedUserIds = _userManager.ClearInactiveUsers();
                if (clearedUserIds.Any())
                {
                    _logger.LogInformation("清理了 {Count} 个掉线的用户。", clearedUserIds.Count);
                    foreach (var userId in clearedUserIds)
                    {
                        await _context.Clients.All.SendAsync("OnlineUserLogout", userId);
                    }
                }
                _lastSweepTime = DateTime.UtcNow;
            }

            // --- 原有的机器人逻辑 ---
            if (!_userManager.HasOnlineUsers())
            {
                if (_currentAutoDjMode == AutoDjMode.Active)
                {
                    _logger.LogInformation("所有用户已离开，自动DJ切换到 Inactive 状态。");
                    _currentAutoDjMode = AutoDjMode.Inactive;
                }
                // [修改] 无人时，自动重置手动禁用开关
                if (IsAutoDjManuallyDisabled)
                {
                    IsAutoDjManuallyDisabled = false;
                    _logger.LogInformation("所有用户已离开，自动点歌机器人已自动恢复为启用状态。");
                }
            }
            else
            {
                bool isUserActivityPresent = false;
                if (NowPlaying?.enqueuerId != null && NowPlaying.Value.enqueuerId != RobotEnqueuerId)
                {
                    isUserActivityPresent = true;
                }
                if (!isUserActivityPresent)
                {
                    if (MusicQueue.Any(song => song.EnqueuerId != RobotEnqueuerId))
                    {
                        isUserActivityPresent = true;
                    }
                }

                if (isUserActivityPresent)
                {
                    _lastUserActivityTime = DateTime.Now;
                    if (_currentAutoDjMode == AutoDjMode.Active)
                    {
                        _logger.LogInformation("检测到真人用户歌曲活动，自动DJ切换到 Inactive 状态。");
                        _currentAutoDjMode = AutoDjMode.Inactive;
                    }
                }
                else
                {
                    if (DateTime.Now - _lastUserActivityTime > _userActivityTimeout)
                    {
                        if (_currentAutoDjMode == AutoDjMode.Inactive)
                        {
                            _logger.LogInformation("真人用户无活动超时，自动DJ切换到 Active 状态。");
                            _currentAutoDjMode = AutoDjMode.Active;
                        }
                    }
                }
            }
            
            // --- 原有的播放逻辑 ---
            // [修改] 增加手动禁用判断
            if (_currentAutoDjMode == AutoDjMode.Active && !IsAutoDjManuallyDisabled)
            {
                if (NowPlaying is null && !MusicQueue.Any() && _autoplaylist.Any())
                {
                    _logger.LogInformation("自动DJ处于 Active 状态，且房间为空，执行点歌。");
                    await EnqueueRandomSongFromAutoplaylistAsync();
                }
            }

            if (NowPlaying is null)
            {
                if (MusicQueue.TryDequeue(out var musicOrder))
                {
                    await MusicDequeued();
                    if (!_apis.TryGetMusicApi(musicOrder.Service, out var ma))
                    {
                        _logger.LogError(new ArgumentException($"Unknown api provider {musicOrder.Service}",
                                nameof(musicOrder.Service)), "{MusicId} with {Api} play failed, skipping...",
                            musicOrder.Music.Id, musicOrder.Service);
                        continue;
                    }

                    for (var i = 0; ; i++)
                    {
                        try
                        {
                            var music = await ma!.GetPlayableMusicAsync(musicOrder.Music);
                            NowPlaying = (music, musicOrder.EnqueuerId, musicOrder.EnqueuerName, musicOrder.Service, musicOrder.IsReplay);
                            if (music.NeedProxy)
                            {
                                await MusicProxyMiddleware.StartProxyAsync(new MusicProxyRequest(music.TargetUrl!,
                                    "audio/mp4", music.Referer,
                                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36 Edg/109.0.1518.78"));
                            }

                            NowPlayingStartedTime = DateTime.Now;
                            await SetNowPlaying(NowPlaying.Value.music, musicOrder.EnqueuerName);
                            break;
                        }
                        catch (Exception ex)
                        {
                            if (i >= 2)
                            {
                                _logger.LogError(ex, "{MusicId} with {Api} play failed, skipping...",
                                    musicOrder.Music.Id, musicOrder.Service);
                                await GlobalMessage($"Failed to play {musicOrder.Music.Name}, skip to next music.");
                                break;
                            }
                        }
                    }
                }
            }
            else
            {
                if ((DateTime.Now - NowPlayingStartedTime).TotalMilliseconds >= NowPlaying.Value.music.Length)
                {
                    await AddToHistoryAndSaveAsync(NowPlaying.Value);
                    NowPlaying = null;
                }
            }

            await Task.Delay(1000);
        }
    }
    
    private async Task EnqueueRandomSongFromAutoplaylistAsync()
    {
        if (!_autoplaylist.Any()) return;
        var randomSongItem = _autoplaylist[_random.Next(_autoplaylist.Count)];
        try
        {
            if (!_apis.TryGetMusicApi(randomSongItem.ApiName, out var ma)) return;
            var music = await ma.GetMusicByIdAsync(randomSongItem.Id);
            await EnqueueMusic(music, randomSongItem.ApiName, RobotEnqueuerId, isReplay: false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "自动点歌失败，歌曲ID: {SongId}, API: {ApiName}", randomSongItem.Id, randomSongItem.ApiName);
        }
    }
    
    private string GetEnqueuerName(string enqueuerId)
    {
        if (enqueuerId == RobotEnqueuerId) return RobotEnqueuerName;
        return _userManager.FindUserById(enqueuerId)?.Name ?? "未知用户";
    }

    public IEnumerable<PlayHistoryEntry> GetPlayHistory() => _playHistory;

    public IEnumerable<MusicOrderAction> GetQueue() => MusicQueue;
    public async Task EnqueueMusic(Music music, string apiName, string enqueuerId, bool isReplay = false)
    {
        if (!isReplay && enqueuerId != RobotEnqueuerId)
        {
            _lastUserActivityTime = DateTime.Now;
        }

        var enqueuerName = GetEnqueuerName(enqueuerId);
        var action = new MusicOrderAction(Guid.NewGuid().ToString()[..8], music, apiName, enqueuerId, enqueuerName, isReplay);
        
        MusicQueue.Enqueue(action);
        await MusicEnqueued(action.ActionId, music, action.EnqueuerName);
    }

    public async Task NextSong(string operatorId)
    {
        if (NowPlaying is null) return;
        
        await AddToHistoryAndSaveAsync(NowPlaying.Value);
        await MusicCut(operatorId, NowPlaying.Value.music);
        NowPlaying = null;
    }

    public async Task TopSong(string actionId, string operatorId)
    {
        MusicQueue.TopItem(x => x.ActionId == actionId);
        await MusicTopped(actionId, _userManager.FindUserById(operatorId)!.Name);
    }

    private async Task SetNowPlaying(PlayableMusic music, string enqueuerName)
    {
        await _context.Clients.All.SendAsync(nameof(SetNowPlaying), music, enqueuerName, 0);
    }

    private async Task MusicEnqueued(string actionId, Music music, string enqueuerName)
    {
        await _context.Clients.All.SendAsync(nameof(MusicEnqueued), actionId, music, enqueuerName);
    }

    private async Task MusicDequeued()
    {
        await _context.Clients.All.SendAsync(nameof(MusicDequeued));
    }

    private async Task MusicTopped(string actionId, string operatorName)
    {
        await _context.Clients.All.SendAsync(nameof(MusicTopped), actionId, operatorName);
    }

    private async Task MusicCut(string operatorId, Music music)
    {
        await _context.Clients.All.SendAsync(nameof(MusicCut), _userManager.FindUserById(operatorId)!.Name, music);
    }

    private async Task GlobalMessage(string content)
    {
        await _context.Clients.All.SendAsync(nameof(GlobalMessage), content);
    }

    public record MusicOrderAction(string ActionId, Music Music, string Service, string EnqueuerId, string EnqueuerName, bool IsReplay = false);
    
    private class ToppableQueue<T> : LinkedList<T>
    {
        public void TopItem(Func<T, bool> pred)
        {
            if (Count < 2) return;
            var item = this.FirstOrDefault(pred);
            if (item is null) return;
            var node = Find(item)!;
            Remove(node);
            AddFirst(node);
        }

        public void Enqueue(T item)
        {
            AddLast(item);
        }

        public bool TryDequeue(out T? item)
        {
            if (Count == 0)
            {
                item = default;
                return false;
            }
            else
            {
                item = First!.Value;
                RemoveFirst();
                return true;
            }
        }
    }
}
