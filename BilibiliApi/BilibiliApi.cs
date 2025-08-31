using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace MusicParty.MusicApi.Bilibili;

public class BilibiliApi : IMusicApi
{
    // 修正 CS0191: 移除了 'readonly' 关键字，允许在运行时更新此字段
    private string _sessdata;
    private readonly string _phoneNo;
    private readonly HttpClient _http = new();
    public string ServiceName => "Bilibili";

    public BilibiliApi(string sessdata, string phoneNo)
    {
        // 这是我们在第3步中添加的逻辑，现在它可以正常工作了
        if (File.Exists("bilibili_sessdata.txt"))
        {
            _sessdata = File.ReadAllText("bilibili_sessdata.txt").Trim();
        }
        else
        {
            _sessdata = sessdata;
        }
        _phoneNo = phoneNo;
    }

    public void Login()
    {
        Console.WriteLine("You are going to login your Bilibili Account...");
        if (!string.IsNullOrEmpty(_sessdata))
        {
            SESSDATALogin(_sessdata).Wait();
        }
        else
        {
            if (string.IsNullOrEmpty(_phoneNo))
                throw new LoginException(
                    "You must set SESSDATA or phone number of your bilibili account in appsettings.json.");
            // 修正 CS1998: 因为 QRCodeLogin 是同步的，所以直接调用
            QRCodeLogin();
        }

        Console.WriteLine("Login success!");
    }

    public static string BilibiliApiGlobalCookieStorage { get; private set; } = "";

    private async Task SESSDATALogin(string sessdata)
    {
        if (!await CheckSESSDATAAsync(sessdata))
            throw new LoginException($"Login failed, check your SESSDATA.");
        
        _http.DefaultRequestHeaders.Remove("Cookie"); // 先移除旧的，防止重复
        _http.DefaultRequestHeaders.Add("Cookie", $"SESSDATA={sessdata}");
        
        // 修正: 使用 TryGetValues 使代码更健壮
        var resp2 = await _http.GetAsync("https://www.bilibili.com");
        if (resp2.Headers.TryGetValues("Set-Cookie", out var cookies))
        {
            _http.DefaultRequestHeaders.Add("Cookie", cookies);
            BilibiliApiGlobalCookieStorage = $"SESSDATA={sessdata}; " + string.Join("; ", cookies);
        }
        else
        {
            BilibiliApiGlobalCookieStorage = $"SESSDATA={sessdata}";
        }
    }

    private async Task<bool> CheckSESSDATAAsync(string sessdata)
    {
        var http = new HttpClient();
        // 修正: 添加一个标准的浏览器 User-Agent 头。
        // Bilibili的API可能会拒绝没有此头的请求。
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36");
        http.DefaultRequestHeaders.Add("Cookie", $"SESSDATA={sessdata}");
        var resp = await http.GetStringAsync("https://api.bilibili.com/x/web-interface/nav");
        var j = JsonNode.Parse(resp)!;
        return j["code"]!.GetValue<int>() == 0;
    }

    // 修正 CS1998: 将方法签名从 'async Task' 改为 'void'，因为它不包含任何 'await' 操作
    private void QRCodeLogin()
    {
        throw new NotImplementedException();
    }

    public async Task<bool> TrySetCredentialAsync(string cred)
    {
        if (string.IsNullOrEmpty(cred) || !await CheckSESSDATAAsync(cred))
            return false;
        
        // 更新Http客户端的Cookie
        _http.DefaultRequestHeaders.Remove("Cookie");
        _http.DefaultRequestHeaders.Add("Cookie", $"SESSDATA={cred}");

        // 修正: 使用 TryGetValues 使代码更健壮
        var resp = await _http.GetAsync("https://www.bilibili.com");
        if (resp.Headers.TryGetValues("Set-Cookie", out var cookies))
        {
            _http.DefaultRequestHeaders.Add("Cookie", cookies);
            // 更新用于代理的全局Cookie
            BilibiliApiGlobalCookieStorage = $"SESSDATA={cred}; " + string.Join("; ", cookies);
        }
        else
        {
            BilibiliApiGlobalCookieStorage = $"SESSDATA={cred}";
        }

        // 将新的有效凭据写入文件以实现持久化
        await File.WriteAllTextAsync("bilibili_sessdata.txt", cred);
        _sessdata = cred; // 因为 'readonly' 已被移除，所以这行代码现在是合法的

        return true;
    }

    public async Task<Music> GetMusicByIdAsync(string idInput)
    {
        // ====================== START: 新增 URL 兼容逻辑 ======================
        string id = idInput;
        
        var musicRegex = new Regex("BV([^/&#?]+)(?:.*?p=(\\d+))?");

        var musicMatch = musicRegex.Match(idInput);
        
        if (musicMatch.Success)
        {
            id = musicMatch.Groups[1].Value;
            if (musicMatch.Groups.Count > 2 && !string.IsNullOrEmpty(musicMatch.Groups[2].Value))
            {
                id += $"@{musicMatch.Groups[2].Value}";
            }
        }
        // ====================== END: 新增 URL 兼容逻辑 ======================
        
        string bvid;
        int p = 1;
        if (id.Contains('@'))
        {
            var parts = id.Split('@');
            bvid = parts[0];
            if (!int.TryParse(parts[1], out p) || p < 1)
                throw new Exception($"无效的分P号: {parts[1]}");
        }
        else
        {
            bvid = id;
        }
    
        var resp = await _http.GetStringAsync($"https://api.bilibili.com/x/web-interface/view?bvid={bvid}");
        var j = JsonSerializer.Deserialize<BVQueryJson.RootObject>(resp);
        if (j is null || j.code != 0 || j.data is null)
            throw new Exception($"无法获取音乐信息，响应: {resp}");
    
        long targetCid;
        if (p == 1)
        {
            targetCid = j.data.cid;
        }
        else
        {
            if (j.data.pages == null || j.data.pages.Count < p - 1)
                throw new Exception($"分P号 {p} 超出范围（最大 {j.data.pages?.Count ?? 0}）");
            
            targetCid = j.data.pages[p - 1].cid;
        }
    
        return new Music($"{bvid},{targetCid}", j.data.title, new[] { j.data.owner.name });
    }

    // 修正 CS1998: 移除了 async 关键字
    public Task<IEnumerable<Music>> SearchMusicByNameAsync(string name)
    {
        throw new NotImplementedException();
    }

    public async Task<PlayableMusic> GetPlayableMusicAsync(Music music)
    {
        var ids = music.Id.Split(',');
        var resp = await _http.GetStringAsync(
            $"https://api.bilibili.com/x/player/playurl?bvid={ids[0]}&cid={ids[1]}&fnval=16");
        var j = JsonSerializer.Deserialize<PlayUrlJson.RootObject>(resp);
        if (j is null || j.code != 0 || j.data?.dash?.audio is null)
            throw new Exception($"Unable to get playable music, message: {resp}");
        
        var maxAllowedDuration = 1200;
        
        if (j.data.dash.duration > maxAllowedDuration)
        {
            throw new Exception($"音频时长过长（{j.data.dash.duration} 秒），超过限制 {maxAllowedDuration} 秒");
        }
        
        var originalUrl = j.data.dash.audio.OrderBy(x => x.id).First().baseUrl;

        if(string.IsNullOrEmpty(originalUrl))
            throw new Exception($"Unable to get playable music, message: {resp}");

        var uri = new Uri(originalUrl);
        var newUrl = new UriBuilder(uri)
        {
            Host = "upos-sz-mirrorhw.bilivideo.com"
        }.Uri.ToString();
        return new PlayableMusic(music)
        {
            Url = $"/musicproxy?timestamp={DateTimeOffset.Now.ToUnixTimeSeconds()}",
            Length = j.data.dash.duration * 1000,
            NeedProxy = true,
            TargetUrl = newUrl,
            Referer = "https://www.bilibili.com",
        };
    }

    public async Task<IEnumerable<MusicServiceUser>> SearchUserAsync(string keyword)
    {
        var resp = await _http.GetStringAsync(
            $"https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword={keyword}");
        var j = JsonSerializer.Deserialize<SearchUserJson.RootObject>(resp);
        if (j is null || j.code != 0)
            throw new Exception($"Search user failed, message: {resp}");
        if (j.data?.result is null)
            return Array.Empty<MusicServiceUser>();
        return j.data.result.Select(x => new MusicServiceUser(x.mid.ToString(), x.uname ?? ""));
    }

    public async Task<IEnumerable<PlayList>> GetUserPlayListAsync(string userIdentifier)
    {
        var resp = await _http.GetStringAsync(
            $"https://api.bilibili.com/x/v3/fav/folder/created/list-all?type=2&up_mid={userIdentifier}");
        var j = JsonSerializer.Deserialize<UserFavsJson.RootObject>(resp);
        if (j is null || j.code != 0)
            throw new Exception($"Unable to get user playlist, message: ${resp}");
        if (j.data?.list is null)
            return Array.Empty<PlayList>();
        return j.data.list.Select(x => new PlayList(x.id.ToString(), x.title));
    }

    public async Task<IEnumerable<Music>> GetMusicsByPlaylistAsync(string id, int offset = 0)
    {
        var resp = await _http.GetStringAsync(
            $"https://api.bilibili.com/x/v3/fav/resource/list?platform=web&media_id={id}&ps=10&pn={offset / 10 + 1}");
        var j = JsonSerializer.Deserialize<FavDetailJson.RootObject>(resp);
        if (j is null || j.code != 0)
            throw new Exception($"Unable to get playlist musics, message: {resp}");
        if (j.data?.medias is null)
            return Array.Empty<Music>();
        return j.data.medias.Where(x => x.title != "已失效视频" && x.type == 2)
            .Select(x => new Music(x.bvid, x.title, new[] { x.upper.name }));
    }

    #region JsonClasses

    private class SearchUserJson
    {
        public class RootObject
        {
            public long code { get; init; }
            public Data? data { get; init; }
        }

        public class Data
        {
            public Result[]? result { get; init; }
        }

        public class Result
        {
            public long mid { get; init; }
            // 修正 CS8618: 将属性声明为可为 null
            public string? uname { get; init; }
        }
    }

    private class UserFavsJson
    {
        public record RootObject(
            long code,
            Data? data
        );

        public record Data(
            List[]? list
        );

        public record List(
            long id,
            string title
        );
    }

    private class FavDetailJson
    {
        public record RootObject(
            long code,
            Data? data
        );

        public record Data(
            Medias[]? medias
        );

        public record Medias(
            long type,
            string title,
            Upper1 upper,
            string bvid
        );

        public record Upper1(
            string name
        );
    }

    private class BVQueryJson
    {
        public record RootObject(
            long code,
            Data? data
        );
    
        public record Data(
            string bvid,
            string title,
            Owner owner,
            long cid,
            List<Page> pages
        );
    
        public record Owner(
            string name
        );
    
        public record Page(
            long cid,
            int page,
            string part
        );
    }

    private class PlayUrlJson
    {
        public class RootObject
        {
            public long code { get; set; }
            public Data? data { get; set; }
        }

        public class Data
        {
            // 修正 CS8618: 将属性声明为可为 null
            public Dash? dash { get; set; }
        }

        public class Dash
        {
            public long duration { get; set; }
            // 修正 CS8618: 将属性声明为可为 null
            public Audio[]? audio { get; set; }
        }



        public class Audio
        {
            public long id { get; set; }
            // 修正 CS8618: 将属性声明为可为 null
            public string? baseUrl { get; set; }
        }
    }

    #endregion
}

