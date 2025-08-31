import Head from 'next/head';
import React, { useEffect, useRef, useState, useCallback, useContext, memo } from 'react';
import { Connection, Music, MusicOrderAction, PlayHistoryEntry } from '../src/api/musichub';
import {
  Text, Button, Card, CardBody, CardHeader, Grid, GridItem, Heading, Input, ListItem,
  Tab, TabList, TabPanel, TabPanels, Tabs, useToast, Stack, Popover,
  PopoverBody, PopoverCloseButton, PopoverContent, PopoverFooter, PopoverHeader,
  PopoverTrigger, Portal, UnorderedList, Flex, RadioGroup, Radio, Box, Divider, Select, Textarea,
} from '@chakra-ui/react';
import { getMusicApis, setCredential } from '../src/api/api';
import { NeteaseBinder } from '../src/components/neteasebinder';
import { MyPlaylist } from '../src/components/myplaylist';
import { MusicSelector } from '../src/components/musicselector';
import { QQMusicBinder } from '../src/components/qqmusicbinder';
import { MusicQueue } from '../src/components/musicqueue';
import { BilibiliBinder } from '../src/components/bilibilibinder';
import { KuGouBinder } from '../src/components/kugoubinder';
import { PlayHistory } from '../src/components/playhistory';
import { ThemeContext, ThemeKey } from './_app';
import { MarqueeText } from '../src/components/MarqueeText';
import { MusicPlayerController } from '../src/components/MusicPlayerController';

interface NowPlayingDisplayProps {
  nowPlaying?: {
    music: Music;
    enqueuer: string;
  };
}

const NowPlayingDisplay = memo((props: NowPlayingDisplayProps) => {
  const { nowPlaying } = props;

  if (!nowPlaying) {
    return (
      <Box mb={4}>
        <Heading size="md">暂无歌曲正在播放</Heading>
      </Box>
    );
  }

  return (
    <Box mb={4}>
      <Grid
        templateAreas={{
          base: `"playing-text" "marquee" "enqueuer"`,
          md: `"playing-text playing-text" "marquee marquee" "enqueuer enqueuer"`,
        }}
        gridTemplateColumns="1fr"
        gap={1}
        alignItems="flex-start"
      >
        <GridItem area="playing-text" whiteSpace="nowrap">
          <Heading size="md">正在播放:</Heading>
        </GridItem>
        
        <GridItem area="marquee" overflow="hidden">
          <MarqueeText speed={30} startPauseInSeconds={6} endPauseInSeconds={3}>
            <Text as="span" fontWeight="bold" fontSize="lg">
              {`${nowPlaying.music.name} - ${nowPlaying.music.artists.join(' / ')}`}
            </Text>
          </MarqueeText>
        </GridItem>

        <GridItem area="enqueuer" whiteSpace="nowrap">
          <Text fontSize="sm" fontStyle="italic" color="text.2">
            {`由 ${nowPlaying.enqueuer} 点播`}
          </Text>
        </GridItem>
      </Grid>
    </Box>
  );
});
NowPlayingDisplay.displayName = 'NowPlayingDisplay';


type OnlineUser = { id: string; name: string };
type ChatMessage = { name: string; content: string; timestamp: number };

const COOKIE_USERNAME_KEY = 'chat_username_preference';
const LOCALSTORAGE_USERID_KEY = 'music_party_user_id';
const DEFAULT_USERNAME_ON_NO_COOKIE = "请设置用户名";

const getPersistentUserId = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LOCALSTORAGE_USERID_KEY);
};

const setPersistentUserId = (id: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCALSTORAGE_USERID_KEY, id);
};

const getCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
};

const setCookie = (name: string, value: string, days: number) => {
  if (typeof document === 'undefined') return;
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (encodeURIComponent(value) || "")  + expires + "; path=/";
};


const ChatMessageItem = React.memo(function ChatMessageItem({ msg }: { msg: ChatMessage }) {
    return (
      <ListItem p={2} borderRadius="md" wordBreak="break-word">
        <Text as="span" fontSize="xs" color="text.2" mr={2}>
          {new Date(msg.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </Text>
        <Text as="span" fontWeight="bold">{msg.name}:</Text>
        <Text as="span" ml={2} whiteSpace="pre-wrap" overflowWrap="break-word" display="inline-block" maxW="full">{msg.content}</Text>
      </ListItem>
    );
  });
  
const ChatSection = React.memo(function ChatSection({
    conn,
    chatContent,
  }: {
    conn: Connection | undefined;
    chatContent: ChatMessage[];
  }) {
    const [chatToSend, setChatToSend] = useState('');
  
    const handleSend = useCallback(async () => {
      if (chatToSend.trim() && conn) {
        await conn.chatSay(chatToSend);
        setChatToSend('');
      }
    }, [chatToSend, conn]);

    return (
      <Card>
        <CardHeader><Heading size="md">聊天</Heading></CardHeader>
        <CardBody>
          <Flex>
            <Input
              flex={1} value={chatToSend} onChange={(e) => setChatToSend(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder="说点什么..."
            />
            <Button ml={2} onClick={handleSend}>发送</Button>
          </Flex>
          <UnorderedList maxH="300px" overflowY="auto" pr={2} listStyleType="none" spacing={2} width="100%" mt={2}>
            {chatContent.map((s) => (
              <ChatMessageItem key={`msg-${s.timestamp}-${s.name}`} msg={s} />
            ))}
          </UnorderedList>
        </CardBody>
      </Card>
    );
});


// ==================================================================
// 第 3 步: 实现“统一更新凭据”功能
// ==================================================================
// 3.2: 创建一个独立的表单组件，用于更新凭据
const UpdateCredentialForm = () => {
  const [apiName, setApiName] = useState('NeteaseCloudMusic');
  const [newValue, setNewValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const t = useToast();

  const handleSubmit = async () => {
    if (!newValue.trim()) {
      t({ title: '错误', description: '凭据内容不能为空', status: 'error', isClosable: true, position: 'top' });
      return;
    }
    setIsSubmitting(true);
    try {
      await setCredential(apiName, newValue.trim());
      t({ title: '成功', description: `${apiName} 的凭据已成功更新。`, status: 'success', isClosable: true, position: 'top' });
      setNewValue('');
    } catch (e: any) {
      t({ title: '更新失败', description: e.message, status: 'error', isClosable: true, position: 'top' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Stack spacing={4} align="start">
      <Heading size="md">凭据管理</Heading>
      <Text fontSize="sm" color="text.2">
        在此更新各平台API的凭据（如 Cookie, SESSDATA 等）。更新成功后会自动保存，服务器重启后依然有效。
      </Text>
      <Select value={apiName} onChange={(e) => setApiName(e.target.value)} w="full">
        <option value="NeteaseCloudMusic">网易云 (Cookie)</option>
        <option value="QQMusic">QQ音乐 (Cookie)</option>
        <option value="Bilibili">Bilibili (SESSDATA)</option>
        {/* <option value="KuGouMusic">酷狗 (Token)</option> */}
      </Select>
      <Textarea 
        placeholder="在此处粘贴新的凭据内容"
        value={newValue}
        onChange={(e) => setNewValue(e.target.value)}
        w="full"
        minH="120px"
      />
      <Button onClick={handleSubmit} colorScheme="teal" isLoading={isSubmitting}>
        更新凭据
      </Button>
      <Text fontSize="xs" color="text.2" pt={2}>
        <b>关于酷狗:</b> 酷狗的凭据(Token)需要通过手机验证码在服务器后台首次运行时生成，无法在此处直接更新。如需更新，请联系网站部署者。
      </Text>
    </Stack>
  );
};
// ==================================================================


export default function Home() {
  const [src, setSrc] = useState('');
  const [playtime, setPlaytime] = useState(0);
  const [nowPlaying, setNowPlaying] = useState<{ music: Music; enqueuer: string; }>();
  const [queue, setQueue] = useState<MusicOrderAction[]>([]);
  const [userName, setUserName] = useState('');
  const [newName, setNewName] = useState('');
  
  const [onlineUsers, setOnlineUsers] = useState<Map<string, OnlineUser>>(new Map());

  const [chatContent, setChatContent] = useState<ChatMessage[]>([]); 
  const [isAutoDjDisabled, setIsAutoDjDisabled] = useState(false);
  const [isConnReady, setIsConnReady] = useState(false);
  const [apis, setApis] = useState<string[]>([]);
  const { themeKey, setThemeKey, themes } = useContext(ThemeContext);
  const t = useToast();

  const conn = useRef<Connection>();
  const isSyncing = useRef(false);
  
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  // ==================================================================
  // 第 1 步: 解锁管理员界面
  // ==================================================================
  // 1.1: 定义管理员密码 (请务必修改为一个更安全的密码)
  const ADMIN_PASSWORD = "admin"; // 警告: 这只是一个示例密码，建议您修改

  // 1.2: 添加一个 state 来控制管理员Tab的显示
  const [isAdmin, setIsAdmin] = useState(false);
  // ==================================================================

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && conn.current) {
        console.log('Tab is visible again, syncing player state.');
        conn.current.requestSetNowPlaying();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const onSetNowPlaying = useCallback((music: Music, enqueuerName: string, playedTime: number) => {
    setSrc(music.url);
    setNowPlaying({ music, enqueuer: enqueuerName });
    setPlaytime(playedTime);
  }, []);

  const onMusicEnqueued = useCallback((actionId: string, music: Music, enqueuerName: string) => {
    setQueue(q => [...q, { actionId, music, enqueuerName }]);
  }, []);

  const onMusicDequeued = useCallback(() => {
    setQueue(q => q.slice(1));
  }, []);

  const onMusicTopped = useCallback((actionId: string, operatorName: string) => {
    setQueue(q => {
      const target = q.find((x) => x.actionId === actionId);
      if (!target) return q;
      t({ title: '提示', description: `歌曲 "${target.music.name}-${target.music.artists}" 被 ${operatorName} 置顶了`, status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
      return [target, ...q.filter((x) => x.actionId !== actionId)];
    });
  }, [t]);
  
  const onMusicCut = useCallback((operatorName: string, _: Music) => {
    t({ title: '提示', description: `${operatorName} 切到了下一首歌`, status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
  }, [t]);

  const onOnlineUserLogin = useCallback((id: string, name: string) => {
    if (!isSyncing.current) setOnlineUsers(prev => new Map(prev).set(id, { id, name }));
  }, []);

  const onOnlineUserLogout = useCallback((id: string) => {
    if (!isSyncing.current) setOnlineUsers(prev => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
  }, []);

  const onOnlineUserRename = useCallback((id: string, newName: string) => {
    if (!isSyncing.current) setOnlineUsers(prev => {
      if (!prev.has(id)) return prev;
      return new Map(prev).set(id, { id, name: newName });
    });
  }, []);

  const onNewChat = useCallback((name: string, content: string, timestamp: number) => {
    setChatContent(prev => [{ name, content: content.trim(), timestamp: timestamp * 1000 }, ...prev.slice(0, 199)]);
  }, []);

  const onGlobalMessage = useCallback((content: string) => {
    console.log(content);
  }, []);

  const onAutoDjStatusChanged = useCallback((isDisabled: boolean) => {
    setIsAutoDjDisabled(isDisabled);
    t({ title: '提示', description: `自动点歌机器人已${isDisabled ? '禁用' : '启用'}`, status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
  }, [t]);

  const onAbort = useCallback((msg: string) => {
    console.error(msg);
    t({ title: '错误', description: msg, status: 'error', duration: 5000, isClosable: true, position: 'bottom' });
  }, [t]);

  const onStopPlayback = useCallback(() => {
    setSrc('');
    setNowPlaying(undefined);
  }, []);
  
  const onNewPlayHistoryEntry = useCallback((entry: PlayHistoryEntry) => {
    setPlayHistory(prev => [entry, ...prev]);
  }, []);

  const syncIdentityAndState = useCallback(async () => {
    if (!conn.current || isSyncing.current) return;
    isSyncing.current = true;
    try {
      const preferredName = getCookie(COOKIE_USERNAME_KEY) || DEFAULT_USERNAME_ON_NO_COOKIE;
      const userProfile = await conn.current.rename(preferredName);
      setPersistentUserId(userProfile.id);
      setUserName(userProfile.name);
      setCookie(COOKIE_USERNAME_KEY, userProfile.name, 365);
      const usersFromServer = await conn.current.getOnlineUsers();
      setOnlineUsers(new Map(usersFromServer.map(u => [u.id, u])));
      const queueData = await conn.current.getMusicQueue();
      setQueue(queueData);
      await conn.current.requestSetNowPlaying();
      const autoDjStatus = await conn.current.getAutoDjStatus();
      setIsAutoDjDisabled(autoDjStatus);
    } catch (err) {
      console.error("Failed to sync identity and state:", err);
      t({ title: '错误', description: "与服务器同步失败，请尝试刷新页面。", status: 'error', duration: 5000, isClosable: true, position: 'bottom' });
    } finally {
      isSyncing.current = false;
    }
  }, [t]);
  
  useEffect(() => {
    if (conn.current) return;

    let hubUrl = `${window.location.origin}/music`;
    const persistentId = getPersistentUserId();
    if (persistentId) hubUrl += `?userId=${persistentId}`;

    const onReconnected = async () => {
      t({ title: '提示', description: "已重新连接，正在同步状态...", status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
      await syncIdentityAndState();
    };

    conn.current = new Connection(
      hubUrl, onSetNowPlaying, onMusicEnqueued, onMusicDequeued, onMusicTopped, onMusicCut,
      onOnlineUserLogin, onOnlineUserLogout, onOnlineUserRename, onNewChat, onGlobalMessage,
      onAutoDjStatusChanged, onAbort, onReconnected, onStopPlayback, onNewPlayHistoryEntry
    );

    conn.current.start()
      .then(async () => {
        await syncIdentityAndState();
        const chatHistory = await conn.current!.getChatHistory();
        setChatContent(chatHistory.map(msg => ({...msg, timestamp: msg.timestamp * 1000})));
        conn.current!.getPlayHistory()
          .then(data => { setPlayHistory(data); setIsHistoryLoading(false); })
          .catch(err => { console.error(err); t({ title: '错误', description: "获取播放历史失败", status: 'error', duration: 5000, isClosable: true, position: 'bottom' }); });
        setIsConnReady(true);
      })
      .catch((e) => { console.error(e); t({ title: '错误', description: '连接服务器失败，请刷新页面重试', status: 'error', duration: 5000, isClosable: true, position: 'bottom' }); });
    
    getMusicApis().then(setApis);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isConnReady || !conn.current) return;
    const heartbeatInterval = setInterval(() => { conn.current?.heartbeat(); }, 30000); 
    return () => clearInterval(heartbeatInterval);
  }, [isConnReady]);


  return (
    <>
      <Grid 
        templateAreas={{ base: `"nav" "main"`, md: `"nav main"` }}
        gridTemplateColumns={{ base: '1fr', md: '2fr 5fr' }}
        gap='1'
      >
        <Head><title>🎵 音趴 🎵</title></Head>
        <GridItem area={'nav'}>
          <Stack m={4} spacing={4}>
            <Card>
              <CardHeader>
                 <Heading size="lg" mb={2}>{`欢迎, ${userName}!`}</Heading>
                 <Box color="text.2">
                    <Text fontSize="md">请将用户名改成群内昵称</Text>
                    <Text fontSize="md">除了酷狗api，均支持链接直接点歌</Text>
                    <Text fontSize="md">b站可以通过BV号@P数的形式指定p数，例如BV1aWVEzdE3W@17</Text>
                    <Text fontSize="md">网易云和QQ音乐可以用id直接点歌</Text>
                    <Text fontSize="md">酷狗只能播放搜索到的第一首歌</Text>
                    <Text fontSize="md" mt={1}>因此id点歌直接输入详尽的关键字（例如曲名+歌手）</Text>
                    <Text fontSize="md" mt={1}>人多的时候，一人播放队列里请只点一首歌哦！（不含正在播放）</Text>
                    <Text fontSize="md" mt={1}>账号绑定没有出现歌单的情况，注意账号的隐私设置！</Text>
                    <Text fontSize="md" mt={1}>有问题多联系！</Text>
                 </Box>
              </CardHeader>
              <CardBody>
                <Stack spacing={3}>
                  <Popover placement="bottom-start">
                    {({ onClose }) => (
                      <>
                        <PopoverTrigger><Button w="full">修改名字</Button></PopoverTrigger>
                        <Portal>
                          <PopoverContent>
                            <PopoverHeader>修改你的名字</PopoverHeader>
                            <PopoverCloseButton />
                            <PopoverBody>
                              <Input value={newName} placeholder={'输入新名字'} onChange={(e) => setNewName(e.target.value)} />
                            </PopoverBody>
                            <PopoverFooter>
                              {/* ================================================================== */}
                              {/* 1.3: 修改"确认"按钮的 onClick 事件 */}
                              {/* ================================================================== */}
                              <Button w="full" onClick={async () => {
                                  const trimmedName = newName.trim();
                                  
                                  // 核心逻辑: 检查输入是否为管理员密码
                                  if (trimmedName === ADMIN_PASSWORD) {
                                    setIsAdmin(true); // 解锁管理员功能
                                    t({ title: '提示', description: '管理员后台已解锁', status: 'info', duration: 3000, isClosable: true, position: 'top' });
                                    onClose(); // 关闭弹窗
                                    setNewName(''); // 清空输入框
                                    return; // 阻止后续的改名操作
                                  }

                                  // --- 原有的改名逻辑保持不变 ---
                                  if (trimmedName === '') {
                                    t({ title: '提示', description: "新名字不能为空", status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
                                    return;
                                  }
                                  const user = await conn.current!.rename(trimmedName);
                                  setPersistentUserId(user.id);
                                  setUserName(user.name);
                                  setCookie(COOKIE_USERNAME_KEY, user.name, 365);
                                  t({ title: '提示', description: `名字已成功修改为: ${user.name}`, status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
                                  onClose(); setNewName('');
                                }}
                              >确认</Button>
                              {/* ================================================================== */}
                            </PopoverFooter>
                          </PopoverContent>
                        </Portal>
                      </>
                    )}
                  </Popover>

                  <Popover placement="bottom-start">
                      <PopoverTrigger><Button w="full">更换主题</Button></PopoverTrigger>
                      <Portal>
                          <PopoverContent>
                              <PopoverHeader>选择一个主题</PopoverHeader>
                              <PopoverCloseButton />
                              <PopoverBody>
                                 <RadioGroup onChange={(val) => setThemeKey(val as ThemeKey)} value={themeKey}>
                                     <Stack>
                                      {Object.entries(themes).map(([key, theme]) => (
                                        <Radio key={key} value={key}>{theme.name}</Radio>
                                      ))}
                                     </Stack>
                                 </RadioGroup>
                              </PopoverBody>
                          </PopoverContent>
                      </Portal>
                  </Popover>

                  <Button
                      onClick={() => { isAutoDjDisabled ? conn.current?.enableAutoDj() : conn.current?.disableAutoDj(); }}
                      w="full"
                    >
                      {isAutoDjDisabled ? '启用点歌机器人' : '禁用点歌机器人'}
                  </Button>
                  {apis.includes('NeteaseCloudMusic') && <NeteaseBinder />}
                  {apis.includes('QQMusic') && <QQMusicBinder />}
                  {apis.includes('Bilibili') && <BilibiliBinder />}
                  {apis.includes('KuGouMusic') && <KuGouBinder />}
                </Stack>
              </CardBody>
            </Card>
            <Card>
              <CardHeader><Heading size="md">在线 ({onlineUsers.size})</Heading></CardHeader>
              <CardBody><UnorderedList listStyleType="none" ml={0}>{Array.from(onlineUsers.values()).map((u) => <ListItem key={u.id} p={1} borderRadius="md">{u.name}</ListItem>)}</UnorderedList></CardBody>
            </Card>
            <ChatSection conn={conn.current} chatContent={chatContent} />
          </Stack>
        </GridItem>
        <GridItem area={'main'}>
          <Card m={4}>
            <CardBody>
              <NowPlayingDisplay nowPlaying={nowPlaying} />
              <MusicPlayerController
                src={src}
                playtime={playtime}
                onNextClick={() => conn.current?.nextSong()}
                onReset={async () => {
                  await conn.current!.requestSetNowPlaying();
                  const q = await conn.current!.getMusicQueue();
                  setQueue(q);
                }}
              />
            </CardBody>
          </Card>

          <Tabs variant='soft-rounded' isLazy>
            {/* ================================================================== */}
            {/* 1.4: 条件性地渲染管理员 Tab 和 TabPanel */}
            {/* ================================================================== */}
            <TabList m={4} mt={0}>
                <Tab>播放队列</Tab>
                <Tab>从ID或链接点歌</Tab>
                <Tab>从歌单点歌</Tab>
                <Tab>播放历史</Tab>
                {/* 当 isAdmin 为 true 时，渲染这个新的Tab */}
                {isAdmin && <Tab>🔧 管理员后台</Tab>}
            </TabList>
            <TabPanels>
              <TabPanel pt={0}>
                {/* 1. 为播放队列的 Card 添加 minH */}
                <Card minH={{ base: '60vh', md: '70vh' }}>
                  <CardBody>
                    <MusicQueue queue={queue} top={(actionId) => conn.current!.topSong(actionId)} />
                  </CardBody>
                </Card>
              </TabPanel>
              <TabPanel pt={0}>
                {/* 2. 为点歌的 Card 添加 minH */}
                <Card minH={{ base: '60vh', md: '70vh' }}>
                  <CardBody>
                    <MusicSelector apis={apis} conn={conn.current!} />
                  </CardBody>
                </Card>
              </TabPanel>
              <TabPanel pt={0}>
                {/* 3. 为歌单的 Card 添加 minH */}
                <Card minH={{ base: '60vh', md: '70vh' }}>
                    <CardBody>
                        {!isConnReady ? <Text>初始化...</Text> : <MyPlaylist apis={apis} enqueue={(id, apiName) => { conn.current!.enqueueMusic(id, apiName).then(() => t({ title: '成功加入队列', status: 'success', duration: 3000, isClosable: true, position: 'bottom' })).catch(() => t({ title: '错误', description: `音乐加入队列失败`, status: 'error', duration: 5000, isClosable: true, position: 'bottom' })); }} />}
                    </CardBody>
                </Card>
              </TabPanel>
              <TabPanel pt={0}>
                {/* 4. 这里的 Card 已经包含了 PlayHistory，其内部有自己的高度控制，所以我们不需要再加 */}
                <Card>
                  <CardBody>
                    <PlayHistory conn={conn.current} isConnReady={isConnReady} history={playHistory} isLoading={isHistoryLoading} />
                  </CardBody>
                </Card>
              </TabPanel>

              {/* 当 isAdmin 为 true 时，渲染这个新的TabPanel */}
              {isAdmin && (
                <TabPanel pt={0}>
                  <Card minH={{ base: '60vh', md: '70vh' }}>
                    <CardBody>
                      <Heading size="lg" mb={6}>管理员面板</Heading>
                      {/* ================================================================== */}
                      {/* 第 2 步: 实现“重启服务器”功能 */}
                      {/* ================================================================== */}
                      {/* 2.3: 在管理员面板中添加UI元素 */}
                      <Stack spacing={4} align="start">
                        <Heading size="md">服务器管理</Heading>
                        <Text fontSize="sm" color="text.2">
                          点击下面的按钮将会执行服务器上的 <code>#test.bat</code> 脚本来重启服务。<br />
                          点击后，您与服务器的连接将立即断开。请<b>等待大约 5-10 秒</b>后，<b>手动刷新</b>此页面以重新连接。
                        </Text>
                        <Button
                          colorScheme="red"
                          onClick={() => {
                            if (window.confirm("您确定要重启服务器吗？\n\n此操作将中断所有在线用户的连接。")) {
                              conn.current?.adminRestartServer().catch(err => {
                                t({ title: '错误', description: `重启命令发送失败: ${err.message}`, status: 'error', duration: 5000, isClosable: true, position: 'top' });
                              });
                              t({ title: '指令已发送', description: '服务器正在重启，请稍后刷新页面。', status: 'warning', duration: 5000, isClosable: true, position: 'top' });
                            }
                          }}
                        >
                          重启服务器
                        </Button>
                      </Stack>
                      
                      {/* 3.3: 在管理员面板中添加分割线和新组件 */}
                      <Divider my={6} />
                      <UpdateCredentialForm />
                      
                      {/* ================================================================== */}
                    </CardBody>
                  </Card>
                </TabPanel>
              )}
              {/* ================================================================== */}
            </TabPanels>
          </Tabs>
        </GridItem>
      </Grid>
    </>
  );
}




