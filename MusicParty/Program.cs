using AspNetCore.Proxy;
using Microsoft.AspNetCore.Authentication.Cookies;
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
builder.Services.AddSingleton<IEnumerable<IMusicApi>>(musicApiList);
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<UserManager>();

// [核心修改] 显式配置身份验证Cookie，以实现最强持久化
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(CookieAuthenticationDefaults.AuthenticationScheme, options =>
    {
        // 明确设置过期时间为365天，不再依赖框架默认值
        options.ExpireTimeSpan = TimeSpan.FromDays(365);
        // 启用滑动过期，活跃用户将永不过期
        options.SlidingExpiration = true;
        
        // 明确将Cookie路径设为根目录，确保全站所有请求都携带此Cookie
        options.Cookie.Path = "/";
        // 明确设置SameSite为Lax，这是同源HTTP环境下的最佳实践
        options.Cookie.SameSite = SameSiteMode.Lax;
        // 明确将Cookie标记为对网站核心功能至关重要，以尽可能避免被浏览器策略性地忽略
        options.Cookie.IsEssential = true;
        // 明确安全策略与请求一致，这是在HTTP环境下运行的必要条件
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    });

builder.Services.AddProxies();
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

app.UsePreprocess();

app.UseEndpoints(endpoints =>
{
    endpoints.MapControllers();
    endpoints.MapHub<MusicHub>("/music");
});

app.UseMusicProxy();

// Proxy the front end server.
app.RunHttpProxy(builder.Configuration["FrontEndUrl"]);

app.Run();
