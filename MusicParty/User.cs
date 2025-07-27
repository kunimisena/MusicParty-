using System.Text.Json.Serialization;

namespace MusicParty;

/// <summary>
/// 代表用户的核心档案 (Profile)。
/// 它存储用户的永久或半永久信息，由 UserManager 管理。
/// </summary>
public record User
{
    /// <summary>
    /// 用户的唯一ID。
    /// </summary>
    public string Id { get; init; }

    /// <summary>
    /// 用户的昵称。
    /// </summary>
    public string Name { get; init; }

    /// <summary>
    /// 用户绑定的外部音乐服务账号。
    /// </summary>
    public Dictionary<string, string> MusicApiServiceBindings { get; init; }

    /// <summary>
    /// [核心修改] 用户最后一次被看到在线的时间。
    /// 用于清理长期未登录的“冷档案”。
    /// </summary>
    public DateTime LastSeen { get; set; }

    // [核心修改] 移除 LastHeartbeat 属性，因为它属于短暂的会话(Session)信息。

    [JsonConstructor]
    public User(string id, string name, Dictionary<string, string> musicApiServiceBindings, DateTime lastSeen)
    {
        Id = id;
        Name = name;
        MusicApiServiceBindings = musicApiServiceBindings;
        LastSeen = lastSeen;
    }
    
    // 为方便创建新用户提供一个简化的构造函数
    public User(string id, string name)
    {
        Id = id;
        Name = name;
        MusicApiServiceBindings = new Dictionary<string, string>();
        LastSeen = DateTime.UtcNow;
    }
}
