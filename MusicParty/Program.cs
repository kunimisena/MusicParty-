using AspNetCore.Proxy;
using MusicParty;
using MusicParty.Hub;
using MusicParty.MusicApi;
using MusicParty.MusicApi.Bilibili;
using MusicParty.MusicApi.KuGouMusic;
using MusicParty.MusicApi.NeteaseCloudMusic;
using MusicParty.MusicApi.QQMusic;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

// 控制器和SignalR的JSON命名策略配置，保持camelCase，这是很好的实践。
builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddSignalR().AddJsonProtocol(options =>
{
    options.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});


// Add music api
var musicApiList = new List<IMusicApi>();
if (bool.Parse(builder.Configuration["MusicApi:NeteaseCloudMusic:Enabled"]))
{
    var api = new NeteaseCloudMusicApi(
        builder.Configuration["MusicApi:NeteaseCloudMusic:ApiServerUrl"],
        builder.Configuration["MusicApi:NeteaseCloudMusic:PhoneNo"],
        builder.Configuration["MusicApi:NeteaseCloudMusic:Cookie"],
        builder.Configuration["MusicApi:NeteaseCloudMusic:Password"]
    );
    api.Login();
    musicApiList.Add(api);
}
// ... (其他音乐API的加载逻辑保持不变)
if (bool.Parse(builder.Configuration["MusicApi:QQMusic:Enabled"]))
{
    var api = new QQMusicApi(
        builder.Configuration["MusicApi:QQMusic:ApiServerUrl"],
        builder.Configuration["MusicApi:QQMusic:Cookie"]
    );
    musicApiList.Add(api);
}

if (bool.Parse(builder.Configuration["MusicApi:Bilibili:Enabled"]))
{
    var api = new BilibiliApi(
        builder.Configuration["MusicApi:Bilibili:SESSDATA"],
        builder.Configuration["MusicApi:Bilibili:PhoneNo"]
    );
    api.Login();
    musicApiList.Add(api);
}
if (bool.Parse(builder.Configuration["MusicApi:KuGouMusic:Enabled"]))
{
    var api = new KuGouMusicApi(
        builder.Configuration["MusicApi:KuGouMusic:ApiServerUrl"],
        builder.Configuration["MusicApi:KuGouMusic:PhoneNo"],
        builder.Configuration["MusicApi:KuGouMusic:Token"]
    );
    api.KuGouLogin();
    musicApiList.Add(api);
}

if (musicApiList.Count == 0)
    throw new Exception("Cannot start without any music api service.");

// --- 核心服务依赖注入 ---
// 以下的单例注册(Singleton)对于我们的新架构是完全正确的。

// 注册所有音乐API服务
builder.Services.AddSingleton<IEnumerable<IMusicApi>>(musicApiList);
// 注册HttpContext访问器，UserManager需要用它来处理登录
builder.Services.AddHttpContextAccessor();

// [设计哲学体现] 注册 "户籍处" (UserManager) 为单例。
// ASP.NET Core的DI容器会自动为它注入所需的 ILogger<UserManager>。
builder.Services.AddSingleton<UserManager>();

// 注册身份验证服务
builder.Services.AddAuthentication("Cookies").AddCookie("Cookies");
// 注册代理服务
builder.Services.AddProxies();

// [设计哲学体现] 注册 "决策者" (MusicBroadcaster) 为单例。
// DI容器会自动为它注入所需的 IHubContext<MusicHub>, UserManager, ILogger 等。
builder.Services.AddSingleton<MusicBroadcaster>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseRouting();

app.UseAuthentication();
app.UseAuthorization();

// 使用自定义的预处理中间件，它负责确保每个用户都有身份(Cookie)
app.UsePreprocess();

app.UseEndpoints(endpoints =>
{
    endpoints.MapControllers();
    // [设计哲学体现] 映射 "海关" (MusicHub) 的终结点。
    // 所有注入到MusicHub的依赖（如UserManager, MusicBroadcaster, IHubContext等）都会由DI容器在这里正确处理。
    endpoints.MapHub<MusicHub>("/music");
});

app.UseMusicProxy();

// Proxy the front end server.
app.RunHttpProxy(builder.Configuration["FrontEndUrl"]);

app.Run();
