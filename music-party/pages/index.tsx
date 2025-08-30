import Head from 'next/head';
import React, { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { Connection, Music, MusicOrderAction, PlayHistoryEntry } from '../src/api/musichub';
import {
  Text, Button, Card, CardBody, CardHeader, Grid, GridItem, Heading, Input, ListItem,
  Tab, TabList, TabPanel, TabPanels, Tabs, useToast, Stack, Popover,
  PopoverBody, PopoverCloseButton, PopoverContent, PopoverFooter, PopoverHeader,
  PopoverTrigger, Portal, UnorderedList, Flex, RadioGroup, Radio, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Box,
} from '@chakra-ui/react';
import { MusicPlayer } from '../src/components/musicplayer';
import { getMusicApis } from '../src/api/api';
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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [length, setLength] = useState(0);
  const [time, setTime] = useState(0);
  const { isOpen: isAutoplayModalOpen, onOpen: onAutoplayModalOpen, onClose: onAutoplayModalClose } = useDisclosure();

  // 【修改点 1】: 修复“幻觉切歌”问题和“最后一首不刷新”问题
  // 我们将 audio 元素的 `ended` 事件处理逻辑修改为只在本地 log，不再向服务器发送 `nextSong` 请求。
  // 歌曲是否结束，完全交由后端的权威计时器来判断和广播，避免了客户端的错误上报。
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const handleDurationChange = () => {
      const duration = audio.duration;
      setLength(duration && isFinite(duration) ? duration : 0);
    };
    const handleTimeUpdate = () => {
      setTime(audio.currentTime);
    };
    
    const handleEnded = () => {
      // 这是关键修改！不再调用 conn.current?.nextSong()。
      // 后端会自己判断歌曲是否播放完毕，并发送相应的指令（下一首歌或停止播放）。
      // 这就解决了错误的“我切歌了”的提示。
      console.log('Playback ended locally. Awaiting server command.');
    };

    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    
    return () => {
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
    }
  }, []);

  // 【修改点 2】: 修复相同歌曲不重播的问题
  // 这个 useEffect 负责根据 `src` 和 `playtime` 控制播放。
  // 修改了内部逻辑，确保即使下一首歌的 URL 和当前一样，也能正确地重新加载和播放。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    if (src === "") {
      audio.pause();
      // 在停止播放时，也显式重置时间和长度，让UI立即响应。
      setTime(0);
      setLength(0);
    } else {
      // 检查是否是同一首刚刚播放完的歌，这种情况需要强制重新加载。
      const isSameSongEnded = audio.currentSrc === src && audio.ended;

      if (audio.src !== src) {
        audio.src = src; // 设置新的音频源
      }
      
      // 如果是重播同一首歌，必须调用 .load() 来重置音频元素状态
      if (isSameSongEnded) {
        audio.load();
      }

      // 与服务器的开始时间同步
      if (playtime > 0 && Math.abs(audio.currentTime - playtime) > 2) {
        audio.currentTime = playtime;
      }

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((e: DOMException) => {
          if (e.name === "NotAllowedError") {
            onAutoplayModalOpen();
          } else {
            console.error("Audio play error:", e);
          }
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, playtime]);
  
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
      // 【修改点 3】: Toast 通知位置
      t({ title: '提示', description: `歌曲 "${target.music.name}-${target.music.artists}" 被 ${operatorName} 置顶了`, status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
      return [target, ...q.filter((x) => x.actionId !== actionId)];
    });
  }, [t]);
  
  const onMusicCut = useCallback((operatorName: string, _: Music) => {
    // 【修改点 3】: Toast 通知位置
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
    // 【修改点 3】: Toast 通知位置
    t({ title: '提示', description: `自动点歌机器人已${isDisabled ? '禁用' : '启用'}`, status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
  }, [t]);

  const onAbort = useCallback((msg: string) => {
    console.error(msg);
    // 【修改点 3】: Toast 通知位置
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
      // 【修改点 3】: Toast 通知位置
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
      // 【修改点 3】: Toast 通知位置
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
                              <Button w="full" onClick={async () => {
                                  if (newName.trim() === '') {
                                    // 【修改点 3】: Toast 通知位置
                                    t({ title: '提示', description: "新名字不能为空", status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
                                    return;
                                  }
                                  const user = await conn.current!.rename(newName.trim());
                                  setPersistentUserId(user.id);
                                  setUserName(user.name);
                                  setCookie(COOKIE_USERNAME_KEY, user.name, 365);
                                  // 【修改点 3】: Toast 通知位置
                                  t({ title: '提示', description: `名字已成功修改为: ${user.name}`, status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
                                  onClose(); setNewName('');
                                }}
                              >确认</Button>
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
          <Tabs variant='soft-rounded' isLazy>
            <TabList m={4}><Tab>播放列表</Tab><Tab>从ID或链接点歌</Tab><Tab>从歌单点歌</Tab><Tab>播放历史</Tab></TabList>
            <TabPanels>
              <TabPanel>
                <Card>
                    <CardBody>
                        <Box mb={4}>
                          {nowPlaying ? (
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
                                <MarqueeText>
                                  <Text as="span" fontWeight="bold" fontSize="lg">
                                    {`${nowPlaying.music.name} - ${nowPlaying.music.artists}`}
                                  </Text>
                                </MarqueeText>
                              </GridItem>

                              <GridItem area="enqueuer" whiteSpace="nowrap">
                                <Text fontSize="sm" fontStyle="italic" color="text.2">
                                  {`由 ${nowPlaying.enqueuer} 点播`}
                                </Text>
                              </GridItem>
                            </Grid>
                          ) : (
                            <Heading size="md">暂无歌曲正在播放</Heading>
                          )}
                        </Box>

                        <MusicPlayer
                          time={time}
                          length={length}
                          nextClick={() => conn.current?.nextSong()}
                          reset={async () => {
                            await conn.current!.requestSetNowPlaying();
                            const q = await conn.current!.getMusicQueue();
                            setQueue(q);
                          }}
                        />
                        <MusicQueue queue={queue} top={(actionId) => conn.current!.topSong(actionId)} />
                    </CardBody>
                </Card>
              </TabPanel>
              <TabPanel>
                <Card><CardBody><MusicSelector apis={apis} conn={conn.current!} /></CardBody></Card>
              </TabPanel>
              <TabPanel>
                <Card>
                    <CardBody>
                        {!isConnReady ? <Text>初始化...</Text> : <MyPlaylist apis={apis} enqueue={(id, apiName) => { conn.current!.enqueueMusic(id, apiName).then(() => t({ title: '成功加入队列', status: 'success', duration: 3000, isClosable: true, position: 'bottom' })).catch(() => t({ title: '错误', description: `音乐加入队列失败`, status: 'error', duration: 5000, isClosable: true, position: 'bottom' })); }} />}
                    </CardBody>
                </Card>
              </TabPanel>
              <TabPanel>
                <Card>
                    <CardBody>
                        <PlayHistory conn={conn.current} isConnReady={isConnReady} history={playHistory} isLoading={isHistoryLoading} />
                    </CardBody>
                </Card>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </GridItem>
      </Grid>
      
      <Modal isOpen={isAutoplayModalOpen} onClose={onAutoplayModalClose} isCentered>
        <ModalOverlay />
        <ModalContent>
            <ModalHeader fontSize={"lg"} fontWeight={"bold"}>
              播放器需要您的允许
            </ModalHeader>
            <ModalBody>
              <Text>
                浏览器限制了声音自动播放，请点击下方的按钮以开始。
              </Text>
            </ModalBody>
            <ModalFooter>
              <Button
                onClick={() => {
                  audioRef.current?.play();
                  onAutoplayModalClose();
                }}
                w="full"
              >
                开始播放
              </Button>
            </ModalFooter>
          </ModalContent>
      </Modal>
    </>
  );
}
