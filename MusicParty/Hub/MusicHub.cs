using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MusicParty.MusicApi;

namespace MusicParty.Hub;

[Authorize]
public class MusicHub : Microsoft.AspNetCore.SignalR.Hub
{
    private static HashSet<string> OnlineUsers { get; } = new();
    private static List<string> DuplicatedConnectionIds { get; } = new();
    private readonly IEnumerable<IMusicApi> _musicApis;
    private readonly MusicBroadcaster _musicBroadcaster;
    private readonly UserManager _userManager;
    private readonly ILogger<MusicHub> _logger;
    private static readonly LinkedList<(string name, string content, long timestamp)> _messageQueue = new();

    public List<(string name, string content, long timestamp)> GetChatHistory()
    {
        return _messageQueue.ToList();
    }

    public MusicHub(IEnumerable<IMusicApi> musicApis, MusicBroadcaster musicBroadcaster,
        UserManager userManager,
        ILogger<MusicHub> logger)
    {
        _musicApis = musicApis;
        _musicBroadcaster = musicBroadcaster;
        _userManager = userManager;
        _logger = logger;
    }

    public override async Task OnConnectedAsync()
    {
        if (OnlineUsers.Contains(Context.User!.Identity!.Name!)) // don't allow login twice
        {
            DuplicatedConnectionIds.Add(Context.ConnectionId);
            await Clients.Caller.SendAsync("Abort", "You have already logged in.");
            Context.Abort();
            return;
        }

        OnlineUsers.Add(Context.User.Identity.Name!);
        await OnlineUserLogin(Clients.Others, Context.User.Identity.Name!);
        foreach (var msg in _messageQueue.OrderByDescending(m => m.timestamp))
        {
            await Clients.Caller.SendAsync("NewChat", msg.name, msg.content, msg.timestamp);
        }

        if (_musicBroadcaster.NowPlaying is not null)
        {
            var (music, enqueuerId) = _musicBroadcaster.NowPlaying.Value;
            await SetNowPlaying(Clients.Caller, music, _userManager.FindUserById(enqueuerId)!.Name,
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

        OnlineUsers.Remove(Context.User!.Identity!.Name!);
        await OnlineUserLogout(Context.User.Identity.Name!);
    }

    #region Remote invokable

    public async Task EnqueueMusic(string id, string apiName)
    {
        if (!_musicApis.TryGetMusicApi(apiName, out var ma))
            throw new HubException($"Unknown api provider {apiName}.");
        try
        {
            var music = await ma!.GetMusicByIdAsync(id);
            await _musicBroadcaster.EnqueueMusic(music, apiName, Context.User!.Identity!.Name!);
        }
        catch (Exception ex)
        {
            throw new HubException($"Failed to enqueue music, id: {id}", ex);
        }
    }

    public async Task RequestSetNowPlaying()
    {
        if (_musicBroadcaster.NowPlaying is null) return;
        var (music, enqueuerId) = _musicBroadcaster.NowPlaying.Value;
        await SetNowPlaying(Clients.Caller, music, _userManager.FindUserById(enqueuerId)!.Name,
            (int)(DateTime.Now - _musicBroadcaster.NowPlayingStartedTime).TotalSeconds);
    }

    public record MusicEnqueueOrder(string ActionId, Music Music, string EnqueuerName);

    public IEnumerable<MusicEnqueueOrder> GetMusicQueue()
    {
        return _musicBroadcaster.GetQueue().Select(x =>
            new MusicEnqueueOrder(x.ActionId, x.Music, _userManager.FindUserById(x.EnqueuerId)!.Name)).ToList();
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
        return OnlineUsers.Select(x => new User(x, _userManager.FindUserById(x)!.Name)).ToList();
    }

    public async Task ChatSay(string content)
    {
        var name = _userManager.FindUserById(Context.User!.Identity!.Name!)!.Name;
        
        var newMsg = (name: name, content: content, timestamp: DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        
        _messageQueue.AddFirst(newMsg);
        
        while (_messageQueue.Count > 30) 
        {
            _messageQueue.RemoveLast();
        }
        
        await Clients.All.SendAsync(nameof(NewChat), newMsg.name, newMsg.content, newMsg.timestamp);
    }

    #endregion

    private async Task SetNowPlaying(IClientProxy target, PlayableMusic music, string enqueuerName, int playedTime)
    {
        await target.SendAsync(nameof(SetNowPlaying), music, enqueuerName, playedTime);
    }

    private async Task OnlineUserLogin(IClientProxy target, string id)
    {
        await target.SendAsync(nameof(OnlineUserLogin), id, _userManager.FindUserById(id)!.Name);
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
