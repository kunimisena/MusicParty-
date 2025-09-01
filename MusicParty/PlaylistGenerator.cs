using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace MusicParty.Utils
{
    /// <summary>
    /// 独立的歌单生成器，负责处理从播放历史到创建网易云歌单的完整逻辑。
    /// </summary>
    public static class PlaylistGenerator
    {
        // [可调整] 这里是专用于歌单生成的、无状态的网易云API服务器地址。
        // 请确保您已启动一个监听在此端口的 NeteaseCloudMusicApi 实例。
        private const string NeteaseApiUrl = "http://localhost:2336";

        /// <summary>
        /// 创建一个新的 HttpClient 实例用于本次操作。
        /// </summary>
        private static HttpClient CreateClient() => new();

        /// <summary>
        /// 核心方法，根据指定的历史记录和用户Cookie创建歌单。
        /// </summary>
        public static async Task<string> CreateNeteasePlaylistAsync(
            IEnumerable<MusicBroadcaster.PlayHistoryEntry> allHistory,
            string userCookie,
            string startTimeUtc8,
            string endTimeUtc8)
        {
            if (string.IsNullOrWhiteSpace(userCookie))
            {
                return "错误：Cookie 不能为空。";
            }

            try
            {
                var client = CreateClient();

                // --- 1. [修正] 使用 Cookie 登录/验证状态，这严格遵循了您的新思路和Python脚本的模式 ---
                var loginStatusUrl = $"{NeteaseApiUrl}/login/status?timestamp={DateTimeOffset.Now.ToUnixTimeMilliseconds()}";
                var requestMessage = new HttpRequestMessage(HttpMethod.Get, loginStatusUrl);
                requestMessage.Headers.Add("Cookie", userCookie); // 将Cookie添加到请求头中

                var loginResponse = await client.SendAsync(requestMessage);
                var loginJson = JsonNode.Parse(await loginResponse.Content.ReadAsStringAsync());

                if (loginJson["data"]?["code"]?.GetValue<int>() != 200 || loginJson["data"]?["profile"] == null)
                {
                    return "错误：提供的Cookie无效或已过期，无法验证登录状态。";
                }

                // --- 2. 时区处理与数据筛选 ---
                var startTime = DateTime.Parse(startTimeUtc8).AddHours(-8);
                var endTime = DateTime.Parse(endTimeUtc8).AddHours(-8);

                var neteaseSongIds = allHistory
                    .Where(entry =>
                    {
                        return entry.Timestamp >= startTime && entry.Timestamp <= endTime &&
                               entry.ApiName == "NeteaseCloudMusic" &&
                               !entry.Music.Id.Contains("duration");
                    })
                    .Select(entry => entry.Music.Id)
                    .Distinct()
                    .ToList();
                
                if (!neteaseSongIds.Any())
                {
                    return "提示：在指定的时间范围内没有找到符合条件的网易云音乐播放记录。";
                }

                // --- 3. 自动生成歌单名称 ---
                var playlistName = $"一起听歌网站{DateTime.Now:MM/dd} {Guid.NewGuid().ToString("N")[..4]}";

                // --- 4. 创建歌单 ---
                var createUrl = $"{NeteaseApiUrl}/playlist/create?name={WebUtility.UrlEncode(playlistName)}&timestamp={DateTimeOffset.Now.ToUnixTimeMilliseconds()}";
                requestMessage = new HttpRequestMessage(HttpMethod.Get, createUrl);
                requestMessage.Headers.Add("Cookie", userCookie); // 同样使用请求头传递Cookie
                
                var createResponse = await client.SendAsync(requestMessage);
                if (!createResponse.IsSuccessStatusCode)
                {
                    return $"错误：创建歌单失败。API服务器返回状态码: {createResponse.StatusCode}";
                }
                var createJson = JsonNode.Parse(await createResponse.Content.ReadAsStringAsync());
                if (createJson["code"]?.GetValue<int>() != 200)
                {
                    return $"错误：创建歌单失败。API返回信息: {createJson["msg"] ?? createJson.ToString()}";
                }
                var playlistId = createJson["id"]?.GetValue<long>().ToString();
                if (string.IsNullOrEmpty(playlistId))
                {
                    return "错误：创建歌单后未能获取到歌单ID。";
                }

                // --- 5. 批量添加歌曲 ---
                const int batchSize = 100; // 每次添加100首
                for (int i = 0; i < neteaseSongIds.Count; i += batchSize)
                {
                    var batch = neteaseSongIds.Skip(i).Take(batchSize);
                    var tracks = string.Join(",", batch);
                    var addUrl = $"{NeteaseApiUrl}/playlist/tracks?op=add&pid={playlistId}&tracks={tracks}&timestamp={DateTimeOffset.Now.ToUnixTimeMilliseconds()}";
                    
                    requestMessage = new HttpRequestMessage(HttpMethod.Get, addUrl);
                    requestMessage.Headers.Add("Cookie", userCookie); // 每次请求都带上Cookie头
                    
                    var addResponse = await client.SendAsync(requestMessage);
                    var addJson = JsonNode.Parse(await addResponse.Content.ReadAsStringAsync());
                    if (addJson["status"]?.GetValue<int>() != 200 && addJson["body"]?["code"]?.GetValue<int>() != 200)
                    {
                        return $"成功创建歌单 (ID: {playlistId})，但添加部分歌曲时出错。请检查歌单内容。错误详情: {addJson.ToString()}";
                    }
                    await Task.Delay(500); //短暂延时以避免请求过于频繁
                }

                return $"成功创建歌单 '{playlistName}' (ID: {playlistId})，并已添加 {neteaseSongIds.Count} 首歌曲。";
            }
            catch (Exception ex)
            {
                return $"错误：在执行过程中发生意外。详情: {ex.Message}";
            }
        }
    }
}

