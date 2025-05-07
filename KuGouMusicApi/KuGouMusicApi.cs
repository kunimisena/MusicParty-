using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using System;
using System.Net;
using System.IO; // 确保引入了 File 操作相关的命名空间
using System.Threading.Tasks; // 确保引入了 Task 相关的命名空间
using System.Linq; // 需要 System.Linq 来使用 Select
using System; // 确保引入了 Exception 的命名空间
using System.Linq; // 需要 System.Linq 来使用 Select 和 Any
using System; // 确保引入了 Exception 的命名空间
using System.Collections.Generic; // 需要 IEnumerable
using System.Threading.Tasks; // 需要 Task
using System.Linq; // 需要 System.Linq 来使用 Select 和 Any
using System; // 确保引入了 Exception 的命名空间
using System.Collections.Generic; // 需要 IEnumerable
using System.Threading.Tasks; // 需要 Task

namespace MusicParty.MusicApi.KuGouMusic;

public class KuGouMusicApi : IMusicApi
{
    private readonly HttpClient _http = new HttpClient(new HttpClientHandler() { UseCookies = false });
    private readonly string _url;
    private readonly string _phoneNo;
    private string _token;


    public KuGouMusicApi(string url, string phoneNo, string token)
    {
        _url = url;
        _phoneNo = phoneNo;
        _token = token;
    }

    public string ServiceName => "KuGouMusic";

public void KuGouLogin()
{
    Console.WriteLine("You are going to login your KuGou Music Account...");

    if (File.Exists("token.txt"))
    {
        Console.WriteLine("You have logged in before, if you want to login again, please delete token.txt.");
        // 解决问题 A1: 加载文件中的token到类成员并直接返回，表示登录成功
        this._token = File.ReadAllText("token.txt").Trim(); // 第一行增加的代码
        return;                                             // 第二行增加的代码
    }
    else
    {
        string token; // 局部变量，用于最终写入文件
        try
        {
            // 尝试使用配置中提供的 this._token (类成员，构造函数传入)
            if (!string.IsNullOrEmpty(this._token)) 
            {
                // 假设 CheckTokenAsync 使用 /user/detail 
                if (!CheckTokenAsync(this._token).Result) 
                {
                    // 配置中的token无效，抛出异常，符合“错误就异常”
                    throw new LoginException("Login failed, check your token from configuration.");
                }
                // 如果配置中的token有效，将其赋值给局部变量token，以便后续写入文件
                token = this._token; 
                // this._token (类成员) 本身已经是这个有效值了，无需再次赋值
            }
            else // 配置中没有token，进行交互式手机验证码登录
            {
                // 确保 _phoneNo (来自配置，通过构造函数赋值给 this._phoneNo) 有值
                if (string.IsNullOrEmpty(_phoneNo))
                {
                    throw new LoginException(
                        "The phone number of your KuGou Music Account is null or empty. " +
                        "Please set it in appsettings.json to enable interactive login.");
                }

                // --- 开始内联手机验证码登录流程 ---
                // 1. 发送验证码
                Console.WriteLine($"Sending captcha to phone number: {this._phoneNo}...");
                var captchaSentUrl = $"{this._url}/captcha/sent?mobile={this._phoneNo}&timestamp={GetTimestamp()}";
                var captchaRespJson = this._http.GetStringAsync(captchaSentUrl).Result; 
                var captchaJsonNode = System.Text.Json.Nodes.JsonNode.Parse(captchaRespJson)!;

                if (captchaJsonNode["status"]?.GetValue<int>() != 1 || captchaJsonNode["error_code"]?.GetValue<int>() != 0)
                {
                    string errorMessage = captchaJsonNode["data"]?.GetValue<string>() ?? $"Failed to send captcha. API response: {captchaRespJson}";
                    if (captchaJsonNode["data"] is System.Text.Json.Nodes.JsonObject) 
                    {
                        errorMessage = $"Failed to send captcha. Status: {captchaJsonNode["status"]?.GetValue<int>()}, ErrorCode: {captchaJsonNode["error_code"]?.GetValue<int>()}. API response: {captchaRespJson}";
                    }
                    throw new LoginException(errorMessage);
                }
                Console.WriteLine("Captcha sent successfully. Please check your phone.");

                // 2. 等待用户输入验证码
                Console.Write("Please enter the captcha you received: ");
                string? userEnteredCaptcha = Console.ReadLine()?.Trim(); 

                if (string.IsNullOrWhiteSpace(userEnteredCaptcha))
                {
                    throw new LoginException("Captcha cannot be empty.");
                }

                // 3. 使用手机号和验证码登录
                Console.WriteLine("Attempting to login with phone number and captcha...");
                var loginUrl = $"{this._url}/login/cellphone?mobile={this._phoneNo}&code={userEnteredCaptcha}&timestamp={GetTimestamp()}";
                var loginRespJson = this._http.GetStringAsync(loginUrl).Result; 
                var loginJsonNode = System.Text.Json.Nodes.JsonNode.Parse(loginRespJson)!;

                if (loginJsonNode["status"]?.GetValue<int>() == 1 &&
                    loginJsonNode["error_code"]?.GetValue<int>() == 0 &&
                    loginJsonNode["data"]?["token"] != null)
                {
                    // 将获取到的token赋值给局部变量 token
                    token = loginJsonNode["data"]!["token"]!.GetValue<string>();
                    // 解决问题 A2: 同时更新类成员 this._token
                    this._token = token; // 第三行增加的代码 (总计第三行)
                }
                else
                {
                    string? apiMessage = loginJsonNode["data"]?.GetValue<string>();
                    string errorDetail;
                    if (!string.IsNullOrEmpty(apiMessage)) 
                    {
                        errorDetail = $"Login failed: {apiMessage} (ErrorCode: {loginJsonNode["error_code"]?.GetValue<int>()})";
                    }
                    else 
                    {
                        errorDetail = $"Status: {loginJsonNode["status"]?.GetValue<int>()}, ErrorCode: {loginJsonNode["error_code"]?.GetValue<int>()}";
                        string? topLevelMessage = loginJsonNode["message"]?.GetValue<string>();
                        if (!string.IsNullOrEmpty(topLevelMessage))
                        {
                            errorDetail += $", Message: {topLevelMessage}";
                        }
                    }
                    throw new LoginException($"Login with phone and captcha failed. {errorDetail}. API Response: {loginRespJson}");
                }
                // --- 结束内联手机验证码登录流程 ---
            }
        }
        catch (Exception ex) // 捕获所有 try 块内的异常
        {
            // 如果是已定义的LoginException，直接抛出；否则包装成LoginException再抛出
            if (ex is LoginException) throw; 
            throw new LoginException("Login failed during token processing or interactive login.", ex);
        }

        // 只有在 token 获取或验证成功后 (即没有抛出异常，且 token 变量已被赋值)
        // 才将 token 写入文件
        File.WriteAllText("token.txt", token);
    }

    // 如果代码执行到这里，意味着登录流程已成功（通过文件、配置或交互式登录）且未抛出异常
    Console.WriteLine("Login success!");
}

private string GettokenEncoded() 
{
    string token;
    // 从 "token.txt" 文件读取原始token字符串
    token = File.ReadAllText("token.txt").Trim(); // 使用 Trim() 移除可能存在的前后空白字符

    // 移除了 WebUtility.UrlEncode(token) 这一行，以返回原始token
    // token = WebUtility.UrlEncode(token); 

    return token; // 返回从文件读取的原始token
}


private async Task<bool> CheckTokenAsync(string token)
{
    // 通常建议复用类中已有的 _http 客户端实例（如果存在的话），
    // 但为了暂时保持你提供的代码结构，这里新建一个 HttpClient。
    var http = new HttpClient(); 
    string requestUrl;

    // 根据你的成功测试，使用 /user/detail 来验证 token。
    // 添加时间戳参数是为了尝试避免潜在的API缓存问题，尽管你测试时不带时间戳也成功了。
    requestUrl = $"{_url}/user/detail?token={token}&timestamp={GetTimestamp()}"; 

    try
    {
        var resp = await http.GetStringAsync(requestUrl);
        var j = JsonNode.Parse(resp)!;

        // 根据你对 /user/detail 接口的测试：
        // 有效 token 返回: {"data":{...用户详情...},"error_code":0,"status":1}
        // 我们期望 status: 1 和 error_code: 0 来表示 token 有效。
        // "data" 字段及其中的 "userid" 字段的存在进一步确认了有效性。

        if (j["status"] != null && j["status"]!.GetValue<int>() == 1 &&
            j["error_code"] != null && j["error_code"]!.GetValue<int>() == 0 &&
            j["data"] != null && j["data"].GetValue<JsonNode>() != null) // 确保 "data" 节点存在且其值不为 JSON null
        {
            // 对于 /user/detail 接口，"data" 对象本身就包含了用户信息。
            // 检查 "data" 中是否存在 "userid" 是判断用户对象是否有效的好方法。
            if (j["data"]!["userid"] != null) {
                // 如果使用 /user/detail 进行检查，它不太可能在其响应中返回一个新的 token。
                // /login/token 这样的登录接口如果也用于刷新 token，则更有可能返回新 token。
                // 因此，关于在这里更新 _token 的注释对于 /user/detail 来说关联性不大。
                return true;
            }
            // "data" 存在但缺少 "userid"，这对于有效的用户详情响应来说是预料之外的。
            Console.WriteLine("Token 检查 (/user/detail): Status 成功，但 data 中缺少 userid。");
            return false; 
        }
        // 如果 status 或 error_code 表明失败，可以取消下面这行注释来记录日志
        // Console.WriteLine($"Token 检查 (/user/detail) 失败: Status={j["status"]?.GetValue<int>()}, ErrorCode={j["error_code"]?.GetValue<int>()}");
        return false;
    }
    catch (HttpRequestException ex)
    {
        // 网络请求失败或其他HTTP相关的错误
        Console.WriteLine($"使用 /user/detail 检查 token 时出错: {ex.Message}");
        return false;
    }
    catch (JsonException ex)
    {
        // JSON 解析失败
        Console.WriteLine($"解析 /user/detail 响应时出错: {ex.Message}");
        return false;
    }
    catch (Exception ex) // 捕获其他可能的异常
    {
        Console.WriteLine($"使用 /user/detail 检查 token 时发生意外错误: {ex.Message}");
        return false;
    }
}


private string GetTimestamp() => DateTimeOffset.Now.ToUnixTimeSeconds().ToString();

public async Task<PlayableMusic> GetPlayableMusicAsync(Music music)
{
    // 构造酷狗API的请求URL
    // music.Id 对应酷狗API的 "hash" 参数
    // this._token 是类成员，存储了登录后获取的token
    // GetTimestamp() 是获取时间戳的辅助方法
    string requestUrl = $"{this._url}/song/url?hash={music.Id}&token={this._token}&timestamp={GetTimestamp()}";

    var resp = await _http.GetStringAsync(requestUrl);
    var j = JsonNode.Parse(resp)!;

    // 酷狗API的成功判断逻辑
    // 根据你的成功响应，status: 1 表示成功。
    // 失败时，status 可能为其他值，或者有 error_code。
    // 我们主要检查 status 是否为 1。
    if (j["status"]?.GetValue<int>() != 1)
    {
        // 尝试获取更详细的错误信息
        // 在你之前的失败例子中，status 为 2，且有 fail_process 字段
        string errorMessage = $"酷狗API错误: status={j["status"]?.GetValue<string>()}";
        if (j["error_code"] != null) // 如果有error_code，也加上
        {
            errorMessage += $", error_code={j["error_code"]?.GetValue<string>()}";
        }
        if (j["fail_process"] != null) // 如果有fail_process，也加上
        {
            errorMessage += $", fail_process={j["fail_process"]?.ToString()}";
        }
        // 尝试从 "data" 或 "message" 获取文本错误信息（尽管成功时不一定有这些）
        string dataError = j["data"]?.GetValue<string>();
        string messageError = j["message"]?.GetValue<string>();
        if (!string.IsNullOrEmpty(dataError)) errorMessage += $", data: {dataError}";
        if (!string.IsNullOrEmpty(messageError)) errorMessage += $", message: {messageError}";
        
        throw new Exception($"无法获取可播放音乐 '{music.Name}' (ID: {music.Id}). {errorMessage}. 原始响应: {resp}");
    }

    // 提取播放链接和时长
    // 根据你的成功JSON响应:
    // - 播放链接在顶层的 "url" 数组中
    // - 时长在顶层的 "timeLength" 字段，单位是秒

    JsonNode urlNode = j["url"];
    if (urlNode == null || urlNode.AsArray().Count == 0)
    {
        throw new Exception($"无法获取可播放音乐 '{music.Name}' (ID: {music.Id}). 响应中缺少 'url' 数组或数组为空。原始响应: {resp}");
    }
    // 获取 "url" 数组中的第一个链接
    string playableUrl = urlNode.AsArray()[0]?.GetValue<string>(); 

    if (string.IsNullOrEmpty(playableUrl))
    {
        throw new Exception($"无法获取可播放音乐 '{music.Name}' (ID: {music.Id}). 'url' 数组中的第一个链接为空。原始响应: {resp}");
    }

    // 获取时长 (秒)，并转换为毫秒
    long lengthInSeconds = j["timeLength"]?.GetValue<long>() ?? 0;
    long lengthInMilliseconds = lengthInSeconds * 1000;

    if (lengthInMilliseconds <= 0 && lengthInSeconds > 0) // 简单校验一下转换，避免时长为0但秒数大于0的情况
    {
         // 如果 lengthInSeconds > 0 但 lengthInMilliseconds 仍为0 (例如溢出，虽然不太可能)，
         // 这可能表示一个问题，但我们暂时按原样返回。
         // 或者，如果 lengthInSeconds 本身就是0，那么 lengthInMilliseconds 也是0，这是正常的。
    }
     else if (lengthInSeconds == 0 && j["timeLength"] == null) // 如果timeLength字段不存在
    {
        Console.WriteLine($"警告: 音乐 '{music.Name}' (ID: {music.Id}) 未能从API获取到时长信息 (timeLength字段缺失)。将使用默认时长0。");
        // 可以选择抛出异常，或者允许时长为0
        // throw new Exception($"无法获取可播放音乐 '{music.Name}' (ID: {music.Id}). 响应中缺少 'timeLength' 字段。原始响应: {resp}");
    }


    // 保留将 http 替换为 https 的逻辑，如果这是你的应用需要的
    return new PlayableMusic(music) { Url = playableUrl.Replace("http", "https"), Length = lengthInMilliseconds };
}


public async Task<bool> TrySetCredentialAsync(string cred)
{
    // 1. 验证传入的 token (cred) 是否有效
    // CheckTokenAsync (ID: check_token_async_v2) 会调用 /user/detail?token={cred}
    if (string.IsNullOrEmpty(cred) || !await CheckTokenAsync(cred))
    {
        // 如果 cred 为空或无效，则返回 false
        return false;
    }

    // 2. 如果 token 有效，更新类成员 this._token
    // 这是关键的改动，确保当前实例使用新的有效 token
    this._token = cred;

    // 3. 移除不正确的 DefaultRequestHeaders 修改
    // _http.DefaultRequestHeaders.Remove("token"); // 此行应删除
    // _http.DefaultRequestHeaders.Add("token", cred); // 此行应删除

    // 4. 将有效的 token 持久化到文件
    await File.WriteAllTextAsync("token.txt", cred);
    
    // 考虑：如果 CheckTokenAsync 成功，它实际上已经确认了 cred (token) 对应的 userid。
    // 如果其他地方需要 userid.txt 文件，这里也是一个更新 userid.txt 的时机。
    // 但 CheckTokenAsync 目前只返回 bool，不返回 userid。
    // 为了保持最小改动，我们暂时不在这里处理 userid.txt 的写入。

    return true; // 表示成功设置并持久化了新的有效 token
}


public async Task<Music> GetMusicByIdAsync(string id_hash) // 参数名明确为 id_hash
{
    if (string.IsNullOrWhiteSpace(id_hash))
    {
        throw new ArgumentException("歌曲Hash (id_hash) 不能为空。", nameof(id_hash));
    }

    // 判断输入是纯Hash还是搜索关键词
    // 酷狗Hash通常是32位，由大写字母和数字组成
    bool isLikelyHash = id_hash.Length == 32 && id_hash.All(c => char.IsUpper(c) || char.IsDigit(c));

    if (isLikelyHash)
    {
        // 输入符合Hash格式，直接调用 /song/url 获取歌曲信息
        string currentToken = GettokenEncoded(); // 获取当前token
        // 注意：调用 /song/url 获取歌曲信息时，token可能是必要的
        if (string.IsNullOrEmpty(currentToken))
        {
                Console.WriteLine($"警告: 调用 GetMusicByIdAsync (通过Hash: {id_hash}) 时Token为空，某些歌曲信息可能无法获取或受限。");
        }

        string requestUrl = $"{this._url}/song/url?hash={id_hash}&token={currentToken}&timestamp={GetTimestamp()}";
        string operationName = $"获取歌曲信息 (Hash: {id_hash})";
        string resp = "";
        try
        {
            resp = await _http.GetStringAsync(requestUrl); 
            var j = JsonNode.Parse(resp)!; 

            if (j["status"]?.GetValue<int>() != 1)
            {
                string errorDetails = $"酷狗API业务错误: status={j["status"]?.GetValue<string>()}, error_code={j["error_code"]?.GetValue<string>()}";
                throw new Exception($"{operationName}失败。{errorDetails}. 原始响应: {resp}");
            }

            string? songName = j["fileName"]?.GetValue<string>();
            string? language = j["trans_param"]?["language"]?.GetValue<string>();

            if (string.IsNullOrEmpty(songName)) songName = "未知歌曲";
            
            string[] artists = !string.IsNullOrEmpty(language) ? new string[] { language } : new string[] { "未知语言/歌手" };
            
            return new Music(id_hash, songName, artists);
        }
        catch (HttpRequestException ex)
        {
            throw new Exception($"{operationName}时发生网络请求错误: {ex.Message}. URL: {requestUrl}. 可能的原始响应: {resp}", ex);
        }
        catch (JsonException ex)
        {
            throw new Exception($"{operationName}时解析JSON响应失败: {ex.Message}. URL: {requestUrl}. 原始响应: {resp}", ex);
        }
    }
    else
    {
        // 输入不符合Hash格式，视为搜索关键词，调用 /search 获取第一个结果
        string keyword = id_hash; // 此时 id_hash 被当作 keyword
        string currentToken = GettokenEncoded();
        if (string.IsNullOrEmpty(currentToken))
                Console.WriteLine($"警告: 搜索歌曲 '{keyword}' 时Token为空，如果API需要认证可能会失败。");

        string requestUrl = $"{this._url}/search?keywords={Uri.EscapeDataString(keyword)}&token={currentToken}&timestamp={GetTimestamp()}";
        string operationName = $"通过关键词 '{keyword}' 搜索歌曲";
        string resp = "";
        try
        {
            resp = await _http.GetStringAsync(requestUrl);
            var j = JsonNode.Parse(resp)!;

            string? apiErrorMsg = j["error_msg"]?.GetValue<string>();
            if (j["status"]?.GetValue<int>() != 1 || (j["error_code"]?.GetValue<int>() ?? 0) != 0 || !string.IsNullOrEmpty(apiErrorMsg))
            {
                throw new Exception($"搜索歌曲 '{keyword}' 失败: {(string.IsNullOrEmpty(apiErrorMsg) ? $"status={j["status"]?.GetValue<string>()}, error_code={j["error_code"]?.GetValue<string>()}" : apiErrorMsg)}. 原始响应: {resp}");
            }
            
            JsonNode? listsNode = j["data"]?["lists"];
            // 修正CS1061: 先转换为JsonArray再调用.Any()
            JsonArray? listsArray = listsNode as JsonArray;
            if (listsArray == null || !listsArray.Any())
            {
                throw new Exception($"未能通过关键词 '{keyword}' 找到任何歌曲。原始响应: {resp}");
            }

            var firstSongNode = listsArray[0];
            if (firstSongNode == null) throw new Exception($"搜索结果中的第一首歌数据为空。关键词: '{keyword}'. 原始响应: {resp}");

            string? songHash = firstSongNode["FileHash"]?.GetValue<string>();
            string? songName = firstSongNode["OriSongName"]?.GetValue<string>() ?? firstSongNode["FileName"]?.GetValue<string>();
            
            if (string.IsNullOrEmpty(songHash)) throw new Exception($"未能从搜索结果中提取歌曲的FileHash。关键词: '{keyword}'. 原始响应: {resp}");
            if (string.IsNullOrEmpty(songName)) songName = "未知歌曲";

            string[] artists;
            JsonArray? singersNode = firstSongNode["Singers"] as JsonArray;
            if (singersNode != null && singersNode.Any())
            {
                artists = singersNode
                                .Select(s => s?["name"]?.GetValue<string>())
                                .Where(sName => !string.IsNullOrEmpty(sName))
                                .Select(sName => sName!) 
                                .ToArray();
                if (!artists.Any()) artists = new string[] { "未知歌手" };
            }
            else
            {
                string? singleSingerName = firstSongNode["SingerName"]?.GetValue<string>();
                artists = !string.IsNullOrEmpty(singleSingerName) ? new string[] { singleSingerName! } : new string[] { "未知歌手" };
            }
            return new Music(songHash, songName, artists);
        }
        catch (HttpRequestException ex)
        {
            throw new Exception($"{operationName}时发生网络请求错误: {ex.Message}. URL: {requestUrl}. 可能的原始响应: {resp}", ex);
        }
        catch (JsonException ex)
        {
            throw new Exception($"{operationName}时解析JSON响应失败: {ex.Message}. URL: {requestUrl}. 原始响应: {resp}", ex);
        }
    }
}

public Task<IEnumerable<Music>> SearchMusicByNameAsync(string name)
{
    throw new NotImplementedException();
}

public async Task<IEnumerable<MusicServiceUser>> SearchUserAsync(string keyword) // 参数 keyword 现在用于搜索歌单名称
{
    // 构造酷狗API的歌单搜索URL
    // type=special 表示搜索歌单
    string requestUrl = $"{this._url}/search?type=special&keywords={Uri.EscapeDataString(keyword)}&token={this._token}&timestamp={GetTimestamp()}";
    // 注意：对 keyword 使用 Uri.EscapeDataString() 进行URL编码，以处理特殊字符

    var resp = await _http.GetStringAsync(requestUrl);
    var j = JsonNode.Parse(resp)!;

    // 检查酷狗API的搜索响应状态
    // 根据你的JSON示例，成功时 status: 1, error_code: 0, error_msg: ""
    string errorMsgApi = j["error_msg"]?.GetValue<string>();
    if (j["status"]?.GetValue<int>() != 1 || j["error_code"]?.GetValue<int>() != 0 || !string.IsNullOrEmpty(errorMsgApi))
    {
        string detailedErrorMessage = !string.IsNullOrEmpty(errorMsgApi) ? errorMsgApi : 
                                      $"status={j["status"]?.GetValue<string>()}, error_code={j["error_code"]?.GetValue<string>()}";
        throw new Exception($"搜索歌单 '{keyword}' 失败 (酷狗API错误): {detailedErrorMessage}. 原始响应: {resp}");
    }

    JsonNode listsNode = j["data"]?["lists"];
    if (listsNode == null || !listsNode.AsArray().Any())
    {
        // 如果 "lists" 数组不存在或为空，则表示没有找到匹配的歌单
        Console.WriteLine($"未能通过关键词 '{keyword}' 找到任何歌单。");
        return Enumerable.Empty<MusicServiceUser>(); // 返回空列表
    }

    // 从 "lists" 数组中提取歌单信息，并映射到 MusicServiceUser 对象
    // MusicServiceUser.Id 将存储歌单的 gid
    // MusicServiceUser.Name 将存储歌单的 specialname
    try
    {
        return listsNode.AsArray()
            .Where(item => item != null && 
                           item["gid"] != null &&              // 确保 gid 存在
                           item["specialname"] != null)       // 确保 specialname 存在
            .Select(item => new MusicServiceUser(
                item!["gid"]!.GetValue<string>(),             // 歌单的 gid
                item!["specialname"]!.GetValue<string>()      // 歌单的名称
            ));
    }
    catch (Exception ex)
    {
        // 捕获在 Select 过程中可能发生的错误 (例如字段类型不匹配)
        throw new Exception($"解析歌单搜索结果时出错。关键词: '{keyword}'. 错误: {ex.Message}. 原始响应: {resp}", ex);
    }
}

public async Task<IEnumerable<PlayList>> GetUserPlayListAsync(string userIdentifier)
{
    // 根据你的意图：“酷狗版本这一步不用做，照抄就是了，因为已经有歌单名字和gid”
    // 这意味着此方法被调用时，userIdentifier 就是歌单的gid。
    // 我们不需要再调用API去获取歌单列表，因为我们已经有了一个特定的歌单ID。
    // ApiController 的 MyPlaylists 方法期望返回 IEnumerable<PlayList>。
    // 我们将构造一个只包含这个歌单的列表。
    // 歌单的名称在此方法内无法直接从gid获取，前端应从上一步(SearchUserAsync的结果)获取并显示。
    // 此处返回的PlayList对象的Name字段可以是一个占位符或gid本身。

    if (string.IsNullOrEmpty(userIdentifier))
    {
        // 第一行改动 (参数验证)
        throw new ArgumentException("歌单ID (userIdentifier) 不能为空。", nameof(userIdentifier));
    }
    
    // 第二行改动 (创建并返回列表)
    // 为了使方法异步，并符合“照抄”（即保持async Task签名），使用Task.FromResult
    // Name 设置为 userIdentifier (即gid) 作为占位符，前端应使用之前获取的真实歌单名。
    await Task.CompletedTask; // 确保方法是异步的，即使没有实际的await操作
    return new List<PlayList> { new PlayList(userIdentifier, $"歌单ID: {userIdentifier}") };
}

public async Task<IEnumerable<Music>> GetMusicsByPlaylistAsync(string playlistId, int offset = 0) 
{
    int limit = 10; 
    int page = (offset / limit) + 1; 

    string requestUrl = $"{this._url}/playlist/track/all?id={playlistId}&page={page}&pagesize={limit}&token={GettokenEncoded()}&timestamp={GetTimestamp()}";

    var resp = await _http.GetStringAsync(requestUrl);
    var j = JsonNode.Parse(resp)!;

    if (j["status"]?.GetValue<int>() != 1 || (j["error_code"]?.GetValue<int>() ?? 0) != 0)
    {
        string errorMessage = j["data"]?.GetValue<string>() ?? 
                                j["message"]?.GetValue<string>() ?? 
                                $"酷狗API错误: status={j["status"]?.GetValue<string>()}, error_code={j["error_code"]?.GetValue<string>()}";
        throw new Exception($"无法获取歌单 '{playlistId}' 中的歌曲。{errorMessage}. 原始响应: {resp}");
    }
    
    JsonNode? songsNode = j["data"]?["songs"];
    if (songsNode == null || !songsNode.AsArray().Any())
    {
        Console.WriteLine($"歌单 '{playlistId}' (请求的 page: {page}, pagesize: {limit}) 中没有歌曲，或者API响应中缺少歌曲信息。");
        return Enumerable.Empty<Music>(); 
    }

    try
    {
        return songsNode.AsArray()
            .Where(b => b != null && 
                        b["hash"] != null && 
                        b["name"] != null)   
            .Select(b =>
            {
                string songHash = b!["hash"]!.GetValue<string>(); 
                string songName = b!["name"]!.GetValue<string>(); 

                string[] artists;
                JsonNode? singerInfoNode = b!["singerinfo"] as JsonArray; 
                if (singerInfoNode != null && singerInfoNode.AsArray().Any())
                {
                    artists = singerInfoNode.AsArray()
                                        .Select(s => s?["name"]?.GetValue<string>() ?? "未知歌手") 
                                        .Where(sName => !string.IsNullOrEmpty(sName)) 
                                        .ToArray();
                }
                else
                {
                    artists = new string[] { "未知歌手" }; 
                }
                if (!artists.Any())
                {
                    artists = new string[] { "未知歌手" };
                }

                return new Music(songHash, songName, artists);
            });
    }
    catch (Exception ex)
    {
        throw new Exception($"解析歌单 '{playlistId}' 中的歌曲时出错。错误: {ex.Message}. 原始响应: {resp}", ex);
    }
}

}
