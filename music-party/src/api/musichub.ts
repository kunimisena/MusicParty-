import * as sr from "@microsoft/signalr";

export interface HistoryMusic {
  id: string;
  name: string;
  artists: string[];
}

export interface PlayHistoryEntry {
  music: HistoryMusic;
  apiName: string;
  enqueuerId: string;
  enqueuerName: string;
  timestamp: string;
}

export class Connection {
  private _conn: sr.HubConnection;
  constructor(
    url: string,
    setNowPlaying: (
      music: Music,
      enqueuerName: string,
      playedTime: number
    ) => void,
    musicEnqueued: (
      actionId: string,
      music: Music,
      enqueuerName: string
    ) => void,
    musicDequeued: () => void,
    musicTopped: (actionId: string, operatorName: string) => void,
    musicCut: (operatorName: string, music: Music) => void,
    onlineUserLogin: (id: string, name: string) => void,
    onlineUserLogout: (id: string) => void,
    onlineUserRename: (id: string, newName: string) => void, 
    newChat: (name: string, content: string, timestamp: number) => void,
    globalMessage: (content: string) => void,
    autoDjStatusChanged: (isDisabled: boolean) => void,
    abort: (msg: string) => void,
    onReconnected: () => Promise<void>,
    // [新增] 播放器同步：处理播放结束事件的回调
    stopPlayback: () => void,
    // [新增] 播放历史动态更新：处理新历史条目事件的回调
    newPlayHistoryEntry: (entry: PlayHistoryEntry) => void
  ) {
    this._conn = new sr.HubConnectionBuilder()
      .withUrl(url)
      .withAutomaticReconnect() 
      .build();
    this._conn.on("SetNowPlaying", setNowPlaying);
    this._conn.on("MusicEnqueued", musicEnqueued);
    this._conn.on("MusicDequeued", musicDequeued);
    this._conn.on("MusicTopped", musicTopped);
    this._conn.on("MusicCut", musicCut);
    this._conn.on("OnlineUserLogin", onlineUserLogin);
    this._conn.on("OnlineUserLogout", onlineUserLogout);
    this._conn.on("OnlineUserRename", onlineUserRename);
    this._conn.on("NewChat", newChat);
    this._conn.on("GlobalMessage", globalMessage);
    this._conn.on("AutoDjStatusChanged", autoDjStatusChanged);
    this._conn.on("Abort", abort);
    
    // [新增] 注册新的事件监听器
    this._conn.on("StopPlayback", stopPlayback);
    this._conn.on("NewPlayHistoryEntry", newPlayHistoryEntry);

    this._conn.onreconnected(async () => {
        console.log("Connection re-established. Triggering sync logic.");
        await onReconnected();
    });
  }
  public async start(): Promise<any> {
    if (this._conn.state === sr.HubConnectionState.Disconnected) {
      await this._conn.start();
    }
  }
  public async enqueueMusic(id: string, apiName: string): Promise<void> {
    await this._conn.invoke("EnqueueMusic", id, apiName);
  }
  public async heartbeat(): Promise<void> {
    await this._conn.invoke("Heartbeat");
  }
  public async replayMusic(music: HistoryMusic, apiName: string): Promise<void> {
    await this._conn.invoke("ReplayMusic", music, apiName);
  }
  
  public async requestSetNowPlaying(): Promise<void> {
    await this._conn.invoke("RequestSetNowPlaying");
  }
  public async getMusicQueue(): Promise<MusicOrderAction[]> {
    return await this._conn.invoke("GetMusicQueue");
  }
  public async nextSong(): Promise<void> {
    await this._conn.invoke("NextSong");
  }
  public async topSong(actionId: string): Promise<void> {
    await this._conn.invoke("TopSong", actionId);
  }
  public async rename(newName: string): Promise<{ id: string; name: string }> {
    return await this._conn.invoke("Rename", newName);
  }
  public async getOnlineUsers(): Promise<{ id: string; name: string }[]> {
    return await this._conn.invoke("GetOnlineUsers");
  }
  public async chatSay(content: string): Promise<void> {
    await this._conn.invoke("ChatSay", content.trim());
  }
  public async getChatHistory(): Promise<Array<{
        name: string;
        content: string;
        timestamp: number;
    }>> {
      return await this._conn.invoke("GetChatHistory");
  }
  
  public async getPlayHistory(): Promise<PlayHistoryEntry[]> {
    return await this._conn.invoke("GetPlayHistory");
  }

  public async disableAutoDj(): Promise<void> {
    await this._conn.invoke("DisableAutoDj");
  }

  public async enableAutoDj(): Promise<void> {
    await this._conn.invoke("EnableAutoDj");
  }

  public async getAutoDjStatus(): Promise<boolean> {
    return await this._conn.invoke("GetAutoDjStatus");
  }

  public async adminRestartServer(): Promise<void> {
    await this._conn.invoke("AdminRestartServer");
  }
}
export interface Music {
  url: string;
  name: string;
  artists: string[];
}

export interface MusicOrderAction {
  actionId: string;
  music: Music;
  enqueuerName: string;
}

