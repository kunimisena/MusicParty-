using System.Text.Json.Nodes;
using MusicParty.MusicApi; 
using System.Collections.Generic;
using System.Linq;

namespace MusicParty.MusicApi.QQMusic;

public class QQMusicApi : IMusicApi
{
    private readonly string _url;
    private readonly HttpClient _http = new();
    private volatile bool _isLoggedIn = false;

    public QQMusicApi(string url, string cookie)
    {
        _url = url;
        Console.WriteLine("QQ Music API is initializing...");
        
        Task.Run(async () =>
        {
            await LoginAsync(cookie);
            if (_isLoggedIn)
            {
                Console.WriteLine("Initial QQ Music cookie is valid. Login success.");
            }
            else
            {
                Console.WriteLine("WARN: Initial QQ Music cookie is invalid or expired. The service will run in a limited mode until a valid cookie is provided via API.");
            }
        });
    }

    private async Task LoginAsync(string cookie)
    {
        if (string.IsNullOrEmpty(cookie))
        {
            _isLoggedIn = false;
            return;
        }
        
        if (!await CheckCookieAsync(cookie))
        {
            _isLoggedIn = false;
            return;
        }
        
        _http.DefaultRequestHeaders.Remove("Cookie");
        _http.DefaultRequestHeaders.Add("Cookie", cookie);
        _isLoggedIn = true;
    }

    private async Task<bool> CheckCookieAsync(string cookie)
    {
        try
        {
            var http = new HttpClient();
            http.DefaultRequestHeaders.Add("Cookie", cookie);
            var resp = await http.GetStringAsync($"{_url}/recommend/daily");
            var j = JsonNode.Parse(resp)!;
            return j["result"]!.GetValue<int>() != 301;
        }
        catch
        {
            return false;
        }
    }

    public string ServiceName => "QQMusic";

    public async Task<bool> TrySetCredentialAsync(string cred)
    {
        if (await CheckCookieAsync(cred))
        {
            _http.DefaultRequestHeaders.Remove("Cookie");
            _http.DefaultRequestHeaders.Add("Cookie", cred);
            _isLoggedIn = true;
            return true;
        }
        
        _isLoggedIn = false;
        return false;
    }

    public async Task<Music> GetMusicByIdAsync(string id)
    {
        var ids = id.Split(',');
        var resp = await _http.GetStringAsync(_url + $"/song?songmid={ids[0]}");
        var j = JsonNode.Parse(resp)!;
        if (j["result"]!.GetValue<int>() != 100)
            throw new Exception($"Unable to get music, message: {resp}");
        var name = j["data"]!["track_info"]!["name"]!.GetValue<string>();
        var artists = j["data"]!["track_info"]!["singer"]!.AsArray()
            .Select(x => x!["name"]!.GetValue<string>()).ToArray();
        return new Music(id, name, artists);
    }

    public Task<IEnumerable<Music>> SearchMusicByNameAsync(string name)
    {
        throw new NotImplementedException();
    }

    public async Task<PlayableMusic> GetPlayableMusicAsync(Music music)
    {
        var ids = music.Id.Split(',');
        var resp1 = await _http.GetStringAsync(_url + $"/song?songmid={ids[0]}");
        var j1 = JsonNode.Parse(resp1)!;
        if (j1["result"]!.GetValue<int>() != 100)
            throw new Exception($"Unable to get playable music, message: {resp1}");
        var length = j1["data"]!["track_info"]!["interval"]!.GetValue<int>() * 1000;
        string url;
        var resp2 = await _http.GetStringAsync(_url + $"/song/url?id={ids[0]}&mediaId={ids[1]}&type=320");
        var j2 = JsonNode.Parse(resp2)!;
        if (j2["result"]!.GetValue<int>() != 100 || string.IsNullOrEmpty(j2["data"]!.GetValue<string>()))
        {
            var resp3 = await _http.GetStringAsync(_url +
                                                   $"/song/url?id={ids[0]}&mediaId={ids[1]}");
            var j3 = JsonNode.Parse(resp3)!;
            if (j3["result"]!.GetValue<int>() != 100 || string.IsNullOrEmpty(j3["data"]!.GetValue<string>()))
                throw new Exception($"Unable to get playable music, message: {resp2}");
            url = j3["data"]!.GetValue<string>();
        }
        else
            url = j2["data"]!.GetValue<string>();

        return new PlayableMusic(music) { Url = url.Replace("http", "https"), Length = length };
    }

    public Task<IEnumerable<MusicServiceUser>> SearchUserAsync(string keyword)
    {
        throw new NotImplementedException();
    }

    public async Task<IEnumerable<PlayList>> GetUserPlayListAsync(string userIdentifier)
    {
        if (!_isLoggedIn)
        {
            throw new LoginException("QQ Music service is not logged in. The cookie might be expired or invalid.");
        }
        
        // --- 开始修改 ---
        var combinedPlaylists = new List<PlayList>();

        // 1. 获取用户创建的歌单
        var resp1 = await _http.GetStringAsync(_url + $"/user/songlist?id={userIdentifier}");
        var j1 = JsonNode.Parse(resp1)!;

        if (j1["result"]!.GetValue<int>() == 301)
        {
            _isLoggedIn = false;
            throw new LoginException("QQ Music cookie has expired. Please contact the administrator to update it.");
        }

        if (j1["result"]!.GetValue<int>() == 100)
        {
            // [修改] 安全地访问 "data" 和 "list"
            if (j1["data"]?["list"] is JsonArray createdPlaylistsArray)
            {
                var playlists1 = createdPlaylistsArray
                    .Select(x => new PlayList(
                        x!["tid"]!.GetValue<long>().ToString(),
                        x!["diss_name"]!.GetValue<string>()))
                    .Where(x => x.Id != "0");
                combinedPlaylists.AddRange(playlists1);
            }
        }
        else
        {
            // 如果第一个请求就失败了，可以选择记录日志或直接抛出异常
            throw new Exception($"Unable to get user playlist, message: {resp1}");
        }

        // 2. 获取用户收藏的歌单
        var resp2 = await _http.GetStringAsync(_url + $"/user/collect/songlist?id={userIdentifier}");
        var j2 = JsonNode.Parse(resp2)!;
        if (j2["result"]!.GetValue<int>() == 100)
        {
            // [修改] 安全地访问 "data" 和 "list"
            if (j2["data"]?["list"] is JsonArray collectedPlaylistsArray)
            {
                var playlists2 = collectedPlaylistsArray
                    .Select(x => new PlayList(
                        x!["dissid"]!.GetValue<long>().ToString(),
                        x!["dissname"]!.GetValue<string>()));
                combinedPlaylists.AddRange(playlists2);
            }
        }
        // 对于第二个请求的失败，我们选择不抛出异常，只记录日志，因为第一个请求可能已经成功。
        else
        {
             // 可以添加日志记录
             // _logger.LogWarning("Failed to get user collected playlists. Response: {response}", resp2);
        }

        return combinedPlaylists;
        // --- 结束修改 ---
    }

    public async Task<IEnumerable<Music>> GetMusicsByPlaylistAsync(string id, int offset = 0)
    {
        var resp = await _http.GetStringAsync(_url + $"/songlist?id={id}");
        var j = JsonNode.Parse(resp)!;
        if (j["result"]!.GetValue<int>() != 100)
            throw new Exception($"Unable to get playlist musics, message: {resp}");
        var musics = j["data"]!["songlist"]!.AsArray()
            .Select(x =>
            {
                var artists = x!["singer"]!.AsArray().Select(y => y!["name"]!.GetValue<string>()).ToArray();
                return new Music(x["songmid"]!.GetValue<string>() + ',' + x["strMediaMid"]!.GetValue<string>(),
                    x["songorig"]!.GetValue<string>(), artists);
            });
        return musics.Skip(offset).Take(10);
    }
}
