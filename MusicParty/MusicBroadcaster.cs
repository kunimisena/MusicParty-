using Microsoft.AspNetCore.SignalR;
using MusicParty.Hub;
using MusicParty.MusicApi;
using System.Text.Json;

namespace MusicParty;

/// <summary>
/// "决策者": 系统的后台核心，负责管理播放队列和AutoDJ逻辑。
/// </summary>
public class MusicBroadcaster
{
    // --- 核心状态属性 ---
    public (PlayableMusic music, string enqueuerId, string enqueuerName, string apiName, bool IsReplay)? NowPlaying { get; private set; }
    public DateTime NowPlayingStartedTime { get; private set; }
    private ToppableQueue<MusicOrderAction> MusicQueue { get; } = new();

    // --- 依赖注入 ---
    private readonly IHubContext<MusicHub> _context;
    private readonly UserManager _userManager; // "户籍处"的引用，主要用于获取用户昵称
    private readonly IEnumerable<IMusicApi> _apis;
    private readonly ILogger<MusicBroadcaster> _logger;

    // --- AutoDJ 相关 ---
    public static bool IsAutoDjManuallyDisabled { get; set; } = true;
    private const string RobotEnqueuerId = "auto-dj-robot";
    private const string RobotEnqueuerName = "自动点歌机器人";
    private readonly Random _random = new();
    private enum AutoDjMode { Inactive, Active }
    private AutoDjMode _currentAutoDjMode = AutoDjMode.Inactive;
    private DateTime _lastUserActivityTime = DateTime.Now;
    private readonly TimeSpan _userActivityTimeout = TimeSpan.FromSeconds(5);

    // --- 播放历史相关 ---
    public record PlayHistoryEntry(Music Music, string ApiName, string EnqueuerId, string EnqueuerName, DateTime Timestamp);
    private const string _playHistoryPath = "play_history.json";
    private const int _maxPlayHistoryCount = 500;
    private readonly LinkedList<PlayHistoryEntry> _playHistory = new();

    public MusicBroadcaster(IHubContext<MusicHub> context, UserManager userManager, IEnumerable<IMusicApi> apis, ILogger<MusicBroadcaster> logger)
    {
        _context = context;
        _userManager = userManager;
        _apis = apis;
        _logger = logger;
        
        LoadPlayHistory();
        Task.Run(Loop);
    }

    private async Task Loop()
    {
        while (true)
        {
            if (!MusicHub.HasActiveSessions())
            {
                if (_currentAutoDjMode == AutoDjMode.Active)
                {
                    _currentAutoDjMode = AutoDjMode.Inactive;
                }
                
                if (!IsAutoDjManuallyDisabled)
                {
                    IsAutoDjManuallyDisabled = true;
                    await _context.Clients.All.SendAsync("AutoDjStatusChanged", true);
                }
            }
            else
            {
                bool isUserActivityPresent = (NowPlaying?.enqueuerId != null && NowPlaying.Value.enqueuerId != RobotEnqueuerId) || 
                                             MusicQueue.Any(song => song.EnqueuerId != RobotEnqueuerId);

                if (isUserActivityPresent)
                {
                    _lastUserActivityTime = DateTime.Now;
                    if (_currentAutoDjMode == AutoDjMode.Active)
                    {
                        _currentAutoDjMode = AutoDjMode.Inactive;
                    }
                }
                else
                {
                    if (DateTime.Now - _lastUserActivityTime > _userActivityTimeout && _currentAutoDjMode == AutoDjMode.Inactive)
                    {
                        _currentAutoDjMode = AutoDjMode.Active;
                    }
                }
            }
            
            if (_currentAutoDjMode == AutoDjMode.Active && !IsAutoDjManuallyDisabled && NowPlaying is null && !MusicQueue.Any())
            {
                await EnqueueRandomSongFromHistoryAsync();
            }

            if (NowPlaying is null)
            {
                if (MusicQueue.TryDequeue(out var musicOrder))
                {
                    await MusicDequeued();
                    await PlayMusicOrder(musicOrder);
                }
            }
            else
            {
                if ((DateTime.Now - NowPlayingStartedTime).TotalMilliseconds >= NowPlaying.Value.music.Length)
                {
                    // --- [修改] 开始 ---
                    // 在歌曲播放结束后，检查这首歌是否是需要代理的Bilibili歌曲
                    if (NowPlaying.Value.music.NeedProxy)
                    {
                        // 如果是，则主动通知代理程序清理其状态
                        MusicProxyMiddleware.StopAndClearProxyState();
                    }
                    // --- [修改] 结束 ---

                    await AddToHistoryAndSaveAsync(NowPlaying.Value);
                    NowPlaying = null;
                    
                    if (!MusicQueue.Any())
                    {
                        await StopPlayback();
                    }
                }
            }

            await Task.Delay(1000);
        }
    }

    private async Task PlayMusicOrder(MusicOrderAction musicOrder)
    {
        if (!_apis.TryGetMusicApi(musicOrder.Service, out var ma))
        {
            _logger.LogError("Unknown api provider {Api} for music {MusicId}, skipping...", musicOrder.Service, musicOrder.Music.Id);
            return;
        }

        for (var i = 0; i < 3; i++) // Retry up to 3 times
        {
            try
            {
                var music = await ma!.GetPlayableMusicAsync(musicOrder.Music);
                NowPlaying = (music, musicOrder.EnqueuerId, musicOrder.EnqueuerName, musicOrder.Service, musicOrder.IsReplay);
                if (music.NeedProxy)
                {
                    await MusicProxyMiddleware.StartProxyAsync(new MusicProxyRequest(music.TargetUrl!, "audio/mp4", music.Referer, null));
                }

                NowPlayingStartedTime = DateTime.Now;
                await SetNowPlaying(NowPlaying.Value.music, musicOrder.EnqueuerName);
                return; // Success
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Attempt {Attempt} to play {MusicId} with {Api} failed.", i + 1, musicOrder.Music.Id, musicOrder.Service);
            }
        }
        
        _logger.LogError("All attempts to play {MusicId} failed, skipping.", musicOrder.Music.Id);
        await GlobalMessage($"播放歌曲 {musicOrder.Music.Name} 失败，已跳过。");
    }

    private async Task EnqueueRandomSongFromHistoryAsync()
    {
        if (!_playHistory.Any()) return;
        try
        {
            var randomHistoryEntry = _playHistory.ElementAt(_random.Next(_playHistory.Count));
            await EnqueueMusic(randomHistoryEntry.Music, randomHistoryEntry.ApiName, RobotEnqueuerId, isReplay: false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "自动点歌失败：从播放历史随机点歌时发生错误。");
        }
    }
    
    public async Task EnqueueMusic(Music music, string apiName, string enqueuerId, bool isReplay = false)
    {
        var enqueuerName = GetEnqueuerName(enqueuerId);
        var action = new MusicOrderAction(Guid.NewGuid().ToString()[..8], music, apiName, enqueuerId, enqueuerName, isReplay);
        
        MusicQueue.Enqueue(action);
        await MusicEnqueued(action.ActionId, music, action.EnqueuerName);
    }

    public async Task NextSong(string operatorId)
    {
        if (NowPlaying is null) return;
        
        // --- [修改] 开始 ---
        // 在用户手动切歌时，同样检查被切掉的这首歌是否是Bilibili歌曲
        if (NowPlaying.Value.music.NeedProxy)
        {
            // 如果是，则立即清理代理状态，为下一首歌做准备
            MusicProxyMiddleware.StopAndClearProxyState();
        }
        // --- [修改] 结束 ---

        await AddToHistoryAndSaveAsync(NowPlaying.Value);
        await MusicCut(operatorId, NowPlaying.Value.music);
        NowPlaying = null;

        if (!MusicQueue.Any())
        {
            await StopPlayback();
        }
    }

    public async Task TopSong(string actionId, string operatorId)
    {
        MusicQueue.TopItem(x => x.ActionId == actionId);
        var operatorName = GetEnqueuerName(operatorId);
        await MusicTopped(actionId, operatorName);
    }

    public IEnumerable<MusicOrderAction> GetQueue() => MusicQueue;
    public IEnumerable<PlayHistoryEntry> GetPlayHistory() => _playHistory;

    // --- 音乐相关广播方法 ---
    private async Task SetNowPlaying(PlayableMusic music, string enqueuerName) => await _context.Clients.All.SendAsync("SetNowPlaying", music, enqueuerName, 0);
    private async Task MusicEnqueued(string actionId, Music music, string enqueuerName) => await _context.Clients.All.SendAsync("MusicEnqueued", actionId, music, enqueuerName);
    private async Task MusicDequeued() => await _context.Clients.All.SendAsync("MusicDequeued");
    private async Task MusicTopped(string actionId, string operatorName) => await _context.Clients.All.SendAsync("MusicTopped", actionId, operatorName);
    private async Task MusicCut(string operatorId, Music music) => await _context.Clients.All.SendAsync("MusicCut", GetEnqueuerName(operatorId), music);
    private async Task GlobalMessage(string content) => await _context.Clients.All.SendAsync("GlobalMessage", content);
    private async Task StopPlayback() => await _context.Clients.All.SendAsync("StopPlayback");
    private async Task NewPlayHistoryEntry(PlayHistoryEntry entry) => await _context.Clients.All.SendAsync("NewPlayHistoryEntry", entry);

    // --- [新增] 用户状态广播方法 ---
    public async Task BroadcastUserLoginAsync(string id, string name)
    {
        await _context.Clients.All.SendAsync("OnlineUserLogin", id, name);
    }

    public async Task BroadcastUserLogoutAsync(string id)
    {
        await _context.Clients.All.SendAsync("OnlineUserLogout", id);
    }

    public async Task BroadcastUserRenameAsync(string id, string newName)
    {
        await _context.Clients.All.SendAsync("OnlineUserRename", id, newName);
    }

    // --- 内部辅助方法 ---
    private string GetEnqueuerName(string enqueuerId)
    {
        if (enqueuerId == RobotEnqueuerId) return RobotEnqueuerName;
        return _userManager.FindUserById(enqueuerId)?.Name ?? "未知用户";
    }

    private void LoadPlayHistory()
    {
        try
        {
            if (!File.Exists(_playHistoryPath)) return;
            var jsonString = File.ReadAllText(_playHistoryPath);
            var history = JsonSerializer.Deserialize<List<PlayHistoryEntry>>(jsonString);
            if (history != null)
            {
                foreach (var item in history) _playHistory.AddLast(item);
                _logger.LogInformation("成功加载播放历史，共 {Count} 条记录。", _playHistory.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "加载播放历史文件失败: {FilePath}", _playHistoryPath);
        }
    }

    private async Task AddToHistoryAndSaveAsync((PlayableMusic music, string enqueuerId, string enqueuerName, string apiName, bool IsReplay) playedSong)
    {
        if (playedSong.IsReplay || playedSong.enqueuerId == RobotEnqueuerId) return;

        var entry = new PlayHistoryEntry(
            new Music(playedSong.music.Id, playedSong.music.Name, playedSong.music.Artists),
            playedSong.apiName, playedSong.enqueuerId, playedSong.enqueuerName, DateTime.UtcNow);

        _playHistory.AddFirst(entry);
        
        await NewPlayHistoryEntry(entry);

        if (_playHistory.Count > _maxPlayHistoryCount) _playHistory.RemoveLast();
        await SavePlayHistoryAsync();
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

    public record MusicOrderAction(string ActionId, Music Music, string Service, string EnqueuerId, string EnqueuerName, bool IsReplay = false);
    private class ToppableQueue<T> : LinkedList<T>
    {
        public void TopItem(Func<T, bool> pred)
        {
            if (Count < 2) return;
            var node = this.FirstOrDefault(pred);
            if (node is null) return;
            Remove(node);
            AddFirst(node);
        }
        public void Enqueue(T item) => AddLast(item);
        public bool TryDequeue(out T? item)
        {
            if (Count == 0) { item = default; return false; }
            item = First!.Value;
            RemoveFirst();
            return true;
        }
    }
}
