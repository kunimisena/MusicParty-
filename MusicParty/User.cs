namespace MusicParty;

// [修改] 将 positional record 改为 nominal record，以增加 LastHeartbeat 属性
public record User
{
    public string Id { get; init; }
    public string Name { get; init; }
    public Dictionary<string, string> MusicApiServiceBindings { get; init; }
    
    // [新增] 用于记录用户最后心跳时间的属性，设为 public set 以便更新
    public DateTime LastHeartbeat { get; set; }

    // [新增] 构造函数，因为不再是 positional record
    public User(string id, string name, Dictionary<string, string> musicApiServiceBindings)
    {
        Id = id;
        Name = name;
        MusicApiServiceBindings = musicApiServiceBindings;
        LastHeartbeat = DateTime.UtcNow; // 用户被创建时，记下初始心跳时间
    }
}
