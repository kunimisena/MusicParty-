using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using QRCoder;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using ZXing.ImageSharp;
using System;
using System.Net;

namespace MusicParty.MusicApi.NeteaseCloudMusic;

public class NeteaseCloudMusicApi : IMusicApi
{
    private readonly HttpClient _http = new HttpClient(new HttpClientHandler() { UseCookies = false });
    private readonly string _url;
    private readonly string _phoneNo;
    private readonly string _cookie;

    private readonly string _password;

    public NeteaseCloudMusicApi(string url, string phoneNo, string cookie, string password)
    {
        _url = url;
        _phoneNo = phoneNo;
        _cookie = cookie;
        _password = password;
    }

    public string ServiceName => "NeteaseCloudMusic";

    public void Login()
    {
        Console.WriteLine("You are going to login your Netease Cloud Music Account...");

        if (File.Exists("cookie.txt"))
        {
            Console.WriteLine("You have logged in before, if you want to login again, please delete cookie.txt.");
            _http.DefaultRequestHeaders.Add("Cookie", File.ReadAllText("cookie.txt"));
        }
        else
        {
            string cookie;
            try
            {
                if (!string.IsNullOrEmpty(_cookie))
                {
                    cookie = _cookie;
                    if (!CheckCookieAsync(_cookie).Result)
                        throw new LoginException("Login failed, check your cookie.");
                }
                else
                {
                    if (string.IsNullOrEmpty(_phoneNo) || string.IsNullOrEmpty(_password))
                    {
                        throw new LoginException(
                            "The phone number or password of your Netease Cloud Music Account is null, please set it in appsettings.json");
                    }
                    cookie = PhoneNumberLogin(_phoneNo,_password);
                    _http.DefaultRequestHeaders.Add("Cookie", cookie);
                }
            }
            catch (Exception ex)
            {
                throw new LoginException("Login failed.", ex);
            }

            File.WriteAllText("cookie.txt", cookie);
        }

        Console.WriteLine("Login success!");
    }

    private string GetCookieEncoded()
    {
        string cookie;
        cookie = File.ReadAllText("cookie.txt");
        cookie = WebUtility.UrlEncode(cookie);
        return cookie;
    }

    private async Task<bool> CheckCookieAsync(string cookie)
    {
        var http = new HttpClient();
        http.DefaultRequestHeaders.Add("Cookie", cookie);
        var resp = await http.GetStringAsync($"{_url}/user/account?timestamp={GetTimestamp()}");
        var j = JsonNode.Parse(resp)!;
        return j["profile"].Deserialize<object>() is not null;
    }

    private string PhoneNumberLogin(string phoneNo,string password)
    {
        var rst = _http.GetStringAsync(_url + $"/login/cellphone?phone={phoneNo}&password={password}").Result;
        var cookie = JsonNode.Parse(rst)!["cookie"]!.GetValue<string>();
        return cookie;
    }
    private IEnumerable<string> QRCodeLogin(string url)
    {
        var keyJson = _http.GetStringAsync(url + $"/login/qr/key?timestamp={GetTimestamp()}").Result;
        var key = JsonNode.Parse(keyJson)!["data"]!["unikey"]!.GetValue<string>();
        var qr = _http.GetStringAsync(url + $"/login/qr/create?key={key}&qrimg=true").Result;
        var qrimg = JsonNode.Parse(qr)!["data"]!["qrimg"]!.GetValue<string>();
        Console.WriteLine("Scan your QR code:");
        PrintQRCode(qrimg);
        while (true)
        {
            Task.Delay(3000).Wait();
            var req = _http.GetAsync(url + $"/login/qr/check?key={key}&timestamp={GetTimestamp()}").Result;
            var code = JsonNode.Parse(req.Content.ReadAsStringAsync().Result)!["code"]!.GetValue<int>();
            if (code == 800)
                throw new Exception("Timeout.");
            if (code == 803)
            {
                return req.Headers.GetValues("Set-Cookie");
            }
        }
    }

    private void PrintQRCode(string base64)
    {
        var bytes = Convert.FromBase64String(base64[22..]);
        var reader = new BarcodeReader<Rgba32>();
        var result = reader.Decode(Image.Load<Rgba32>(bytes));
        var g = new QRCodeGenerator();
        var qrdata = g.CreateQrCode(result.Text, QRCodeGenerator.ECCLevel.L);
        var qrcode = new AsciiQRCode(qrdata);
        var graph = qrcode.GetGraphic(1, "A", "B", false);
        foreach (var c in graph)
        {
            Console.BackgroundColor = ConsoleColor.White;
            if (c == '\n') Console.WriteLine();
            if (c == 'A')
            {
                Console.BackgroundColor = ConsoleColor.Black;
                Console.Write("  ");
            }

            if (c == 'B')
            {
                Console.BackgroundColor = ConsoleColor.Gray;
                Console.Write("  ");
            }
        }

        Console.ResetColor();

        Console.WriteLine();
        Console.WriteLine(base64);
    }

    private string GetTimestamp() => DateTimeOffset.Now.ToUnixTimeSeconds().ToString();

    public async Task<PlayableMusic> GetPlayableMusicAsync(Music music)
    {
        var resp = await _http.GetStringAsync(_url + $"/song/url?id={music.Id}");
        var j = JsonNode.Parse(resp)!;
        if ((int)j["code"]! != 200)
            throw new Exception($"Unable to get playable music, message: {resp}");
        var url = (string)j["data"]![0]!["url"]!;
        var length = (long)j["data"]![0]!["time"]!;
        return new PlayableMusic(music) { Url = url.Replace("http", "https"), Length = length };
    }

    public async Task<bool> TrySetCredentialAsync(string cred)
    {
        if (!await CheckCookieAsync(cred))
            return false;
        _http.DefaultRequestHeaders.Remove("Cookie");
        _http.DefaultRequestHeaders.Add("Cookie", cred);
        await File.WriteAllTextAsync("cookie.txt", cred);
        return true;
    }

public async Task<Music> GetMusicByIdAsync(string idInput) // 将参数名改为 idInput 以区分处理后的 id
    {
        const string pidPrefix = "pid=";

        if (idInput != null && idInput.StartsWith(pidPrefix))
        {
            // 如果是 pid 开头形式
            string programId = idInput.Substring(pidPrefix.Length); // 去掉 "pid=" 字符串，保留后面的id内容

            // 用 /dj/program/detail?id= 来请求访问结果
            // 注意：DJ节目详情通常不需要 cookie，但如果您的 API 代理需要，则添加
            // var requestUrl = $"{_url}/dj/program/detail?id={programId}&cookie={GetCookieEncoded()}"; 
            var requestUrl = $"{_url}/dj/program/detail?id={programId}&cookie={GetCookieEncoded()}";
            
            var resp = await _http.GetStringAsync(requestUrl);
            var j = JsonNode.Parse(resp)!;

            // 检查API调用是否成功
            if (j["code"]?.GetValue<int>() != 200 || j["program"] == null)
            {
                throw new Exception($"无法获取DJ节目详情 (pid={programId})，消息: {resp}");
            }

            // 提取 "mainTrackId" 来得到 music 对象的 id
            var mainTrackIdNode = j["program"]!["mainTrackId"];
            if (mainTrackIdNode == null)
            {
                throw new Exception($"DJ节目 (pid={programId}) 响应中未找到 'mainTrackId'。响应: {resp}");
            }
            string musicId = mainTrackIdNode.GetValue<long>().ToString(); // mainTrackId 通常是 long 类型

            // 提取 program": { "mainSong": {"name": ": 中的内容作为music对象的name
            var songNameNode = j["program"]!["mainSong"]?["name"];
            string name;
            if (songNameNode == null)
            {
                name = "未知歌曲";
            }
            else
            {
                name = songNameNode.GetValue<string>();
            }
            // 提取 "artists": [ { "name": 中的内容作为music对象的ar
            var artistsNode = j["program"]!["mainSong"]?["artists"]?.AsArray();
            string[] ar;
            if (artistsNode != null && artistsNode.Count > 0)
            {
                ar = artistsNode.Select(x => x!["name"]!.GetValue<string>()).ToArray();
            }
            else
            {
                // 如果没有艺术家信息，可以提供一个默认值或者抛出异常，根据需求
                ar = new string[] { "未知艺术家" }; 
                // 或者: throw new Exception($"DJ节目 (pid={programId}) 响应中未找到 'program.mainSong.artists'。响应: {resp}");
            }
            
            // 返回 music 对象 (使用从 mainTrackId 获取的 musicId)
            return new Music(musicId, name, ar);
        }
        else //直接是id形式，下面不变！不变！不变！
        {
            var resp = await _http.GetStringAsync(_url + $"/song/detail?ids={idInput}&cookie={GetCookieEncoded()}");
            var j = JsonNode.Parse(resp)!;
            if (j["code"]?.GetValue<int>() != 200 || j["songs"]?.AsArray().Count == 0)
                throw new Exception($"无法获取音乐 (id={idInput})，消息: {resp}");
            
            var name = j["songs"]![0]!["name"]!.GetValue<string>();
            var ar = j["songs"]![0]!["ar"]!.AsArray().Select(x => x!["name"]!.GetValue<string>()).ToArray();
            return new Music(idInput, name, ar); // 对于普通歌曲，输入的idInput就是歌曲ID
        }
    }

    public Task<IEnumerable<Music>> SearchMusicByNameAsync(string name)
    {
        throw new NotImplementedException();
    }

    public async Task<IEnumerable<MusicServiceUser>> SearchUserAsync(string keyword)
    {
        var resp = await _http.GetStringAsync(_url + $"/search?type=1002&keywords={keyword}&cookie={GetCookieEncoded()}");
        var j = JsonNode.Parse(resp)!;
        if ((int)j["code"]! != 200)
            throw new Exception($"Unable to search user, message: {resp}");

        return j["result"]!["userprofiles"]!.AsArray()
            .Select(x => new MusicServiceUser(x!["userId"]!.GetValue<long>().ToString(), (string)x["nickname"]!));
    }

    public async Task<IEnumerable<PlayList>> GetUserPlayListAsync(string userIdentifier)
    {
        var resp = await _http.GetStringAsync(_url + $"/user/playlist?uid={userIdentifier}&cookie={GetCookieEncoded()}");
        var j = JsonNode.Parse(resp)!;
        if ((int)j["code"]! != 200)
            throw new Exception($"Unable to get user playlist, message: ${resp}");

        return from b in j["playlist"]!.AsArray()
            let id = b["id"].GetValue<long>().ToString()
            let name = (string)b["name"]
            select new PlayList(id, name);
    }

    public async Task<IEnumerable<Music>> GetMusicsByPlaylistAsync(string id, int offset = 0)
    {
        var resp = await _http.GetStringAsync(_url + $"/playlist/track/all?id={id}&limit=10&offset={offset}&cookie={GetCookieEncoded()}");
        var j = JsonNode.Parse(resp)!;
        if ((int)j["code"]! != 200)
            throw new Exception($"Unable to get playlist musics, message: {resp}");

        return from b in j["songs"]!.AsArray()
            let id2 = b["id"].GetValue<long>().ToString()
            let name = (string)b["name"]
            let artists = b["ar"].AsArray().Select(y => (string)y["name"]).ToArray()
            select new Music(id2, name, artists);
    }
}
