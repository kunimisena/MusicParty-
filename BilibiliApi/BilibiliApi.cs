using System.Text.Json;
using System.Text.Json.Nodes;

namespace MusicParty.MusicApi.Bilibili;

public class BilibiliApi : IMusicApi
{
    private readonly string _sessdata;
    private readonly string _phoneNo;
    private readonly HttpClient _http = new();
    public string ServiceName => "Bilibili";

    public BilibiliApi(string sessdata, string phoneNo)
    {
        _sessdata = sessdata;
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
            QRCodeLogin().Wait();
        }

        Console.WriteLine("Login success!");
    }

    public static string BilibiliApiGlobalCookieStorage { get; private set; } = "";

    private async Task SESSDATALogin(string sessdata)
    {
        if (!await CheckSESSDATAAsync(sessdata))
            throw new LoginException($"Login failed, check your SESSDATA.");
        
        // 原有代码：手动添加 Cookie 到 HttpClient
        _http.DefaultRequestHeaders.Add("Cookie", $"SESSDATA={sessdata}");
        var resp2 = await _http.GetAsync("https://www.bilibili.com");
        var cookies = resp2.Headers.GetValues("Set-Cookie");
        _http.DefaultRequestHeaders.Add("Cookie", cookies);

        // 新增代码：将拼接后的 Cookie 保存到全局变量
        // 格式示例：SESSDATA=xxxx; sid=xxxx; other_cookie=xxxx
        BilibiliApiGlobalCookieStorage = $"SESSDATA={sessdata}; " + string.Join("; ", cookies);
    }

    private async Task<bool> CheckSESSDATAAsync(string sessdata)
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.Add("Cookie", $"SESSDATA={sessdata}");
        var resp = await http.GetStringAsync("https://api.bilibili.com/x/web-interface/nav");
        var j = JsonNode.Parse(resp)!;
        return j["code"]!.GetValue<int>() == 0;
    }

    private async Task QRCodeLogin()
    {
        throw new NotImplementedException();
    }

    public async Task<bool> TrySetCredentialAsync(string cred)
    {
        if (!await CheckSESSDATAAsync(cred))
            return false;
        _http.DefaultRequestHeaders.Remove("Cookie");
        _http.DefaultRequestHeaders.Add("Cookie", $"SESSDATA={cred}");
        var resp = await _http.GetAsync("https://www.bilibili.com");
        var cookies = resp.Headers.GetValues("Set-Cookie");
        _http.DefaultRequestHeaders.Add("Cookie", cookies);
        return true;
    }

    public async Task<Music> GetMusicByIdAsync(string id)
    {
        // 解析输入（支持 BV1xxx@2 格式）
        string bvid;
        int p = 1; // 默认第1P
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
    
        // 调用 Bilibili API
        var resp = await _http.GetStringAsync($"https://api.bilibili.com/x/web-interface/view?bvid={bvid}");
        var j = JsonSerializer.Deserialize<BVQueryJson.RootObject>(resp);
        if (j is null || j.code != 0 || j.data is null)
            throw new Exception($"无法获取音乐信息，响应: {resp}");
    
        // 获取正确的 CID（处理分P逻辑）
        long targetCid;
        if (p == 1)
        {
            // 使用默认的 data.cid（兼容旧输入）
            targetCid = j.data.cid;
        }
        else
        {
            // 检查分P是否存在
            if (j.data.pages == null || j.data.pages.Count < p - 1)
                throw new Exception($"分P号 {p} 超出范围（最大 {j.data.pages?.Count ?? 0}）");
            
            // 注意：pages 数组索引从0开始，用户输入从1开始
            targetCid = j.data.pages[p - 1].cid;
        }
    
        // 构造 Music 对象
        return new Music($"{bvid},{targetCid}", j.data.title, new[] { j.data.owner.name });
    }

    public async Task<IEnumerable<Music>> SearchMusicByNameAsync(string name)
    {
        throw new NotImplementedException();
    }

    public async Task<PlayableMusic> GetPlayableMusicAsync(Music music)
    {
        var ids = music.Id.Split(',');
        var resp = await _http.GetStringAsync(
            $"https://api.bilibili.com/x/player/playurl?bvid={ids[0]}&cid={ids[1]}&fnval=16");
        var j = JsonSerializer.Deserialize<PlayUrlJson.RootObject>(resp);
        if (j is null || j.code != 0 || j.data is null)
            throw new Exception($"Unable to get playable music, message: {resp}");
        
        var maxAllowedDuration = 1200; // 最大允许时长（秒）
        
        if (j.data.dash.duration > maxAllowedDuration)
        {
            throw new Exception($"音频时长过长（{j.data.dash.duration} 秒），超过限制 {maxAllowedDuration} 秒");
        }

        // 获取原始 CDN URL
        var originalUrl = j.data.dash.audio.OrderBy(x => x.id).First().baseUrl;     //j.data.dash.audio.OrderByDescending(x => x.id).First().baseUrl改为最差音质

        // 强制替换为华为云 CDN 节点
        var uri = new Uri(originalUrl);
        var newUrl = new UriBuilder(uri)
        {
            Host = "upos-sz-mirrorhw.bilivideo.com" // 关键修改：替换域名
        }.Uri.ToString();

        return new PlayableMusic(music)
        {
            Url = $"/musicproxy?timestamp={DateTimeOffset.Now.ToUnixTimeSeconds()}",
            Length = j.data.dash.duration * 1000,
            NeedProxy = true,
            TargetUrl = newUrl, // 使用修改后的 URL
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
        return j.data.result.Select(x => new MusicServiceUser(x.mid.ToString(), x.uname));
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
            public string uname { get; init; }
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
        // 对应整个 JSON 响应
        public record RootObject(
            long code,
            Data? data
        );
    
        // 对应 data 对象（新增 pages 字段）
        public record Data(
            string bvid,
            string title,
            Owner owner,
            long cid,        // 注意：这是默认的 CID（对应第1P）
            List<Page> pages // 新增分P列表
        );
    
        // 对应 data.owner 对象
        public record Owner(
            string name
        );
    
        // 新增分P对象定义（字段名与 JSON 完全一致）
        public record Page(
            long cid,   // 分P的 CID
            int page,   // 分P号（用户看到的1,2,3...）
            string part // 分P标题
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
            public Dash dash { get; set; }
        }

        public class Dash
        {
            public long duration { get; set; }
            public Audio[] audio { get; set; }
        }

        public class Audio
        {
            public long id { get; set; }
            public string baseUrl { get; set; }
        }
    }

    #endregion
}
