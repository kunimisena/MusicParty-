import Head from 'next/head';
import React, { useEffect, useRef, useState, useCallback, useContext, useMemo } from 'react';
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
import { toastEnqueueOk, toastError, toastInfo } from '../src/utils/toast';
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

// [修改] 不再需要 secondaryColor prop
const ChatMessageItem = React.memo(function ChatMessageItem({ msg }: { msg: ChatMessage }) {
    return (
      <ListItem p={2} borderRadius="md" wordBreak="break-word">
        {/* 直接使用主题中的二级字体颜色 */}
        <Text as="span" fontSize="xs" color="text.2" mr={2}>
          {new Date(msg.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </Text>
        <Text as="span" fontWeight="bold">{msg.name}:</Text>
        <Text as="span" ml={2} whiteSpace="pre-wrap" overflowWrap="break-word" display="inline-block" maxW="full">{msg.content}</Text>
      </ListItem>
    );
  });
  
// [修改] 不再需要 secondaryColor prop
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
              // [修改] 不再传递 secondaryColor
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
  // [修改] 从 ThemeContext 中获取主题切换函数和原始主题数据
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
      conn.current?.nextSong();
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    if (src === "") {
      audio.pause();
      if (time !== 0) setTime(0);
      if (length !== 0) setLength(0);
    } else {
      if (audio.src !== src) {
        audio.src = src;
      }
      if (playtime !== 0 && Math.abs(audio.currentTime - playtime) > 2) {
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
      toastInfo(t, `歌曲 "${target.music.name}-${target.music.artists}" 被 ${operatorName} 置顶了`);
      return [target, ...q.filter((x) => x.actionId !== actionId)];
    });
  }, [t]);
  
  const onMusicCut = useCallback((operatorName: string, _: Music) => {
    toastInfo(t, `${operatorName} 切到了下一首歌`);
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
    toastInfo(t, `自动点歌机器人已${isDisabled ? '禁用' : '启用'}`);
  }, [t]);

  const onAbort = useCallback((msg: string) => {
    console.error(msg);
    toastError(t, msg);
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
      toastError(t, "与服务器同步失败，请尝试刷新页面。");
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
      toastInfo(t, "已重新连接，正在同步状态...");
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
        setChatContent(chatHistory.map(msg => ({...msg, timestamp: msg.timestamp * 1000})).reverse());
        conn.current!.getPlayHistory()
          .then(data => { setPlayHistory(data); setIsHistoryLoading(false); })
          .catch(err => { console.error(err); toastError(t, "获取播放历史失败"); });
        setIsConnReady(true);
      })
      .catch((e) => { console.error(e); toastError(t, '连接服务器失败，请刷新页面重试'); });
    
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
                 {/* [修改] 网站提示使用二级字体颜色 */}
                 <Box color="text.2">
                    <Text fontSize="md">请改成群内昵称</Text>
                    <Text fontSize="md">b站id点歌可以通过“@”来输入特定的P（否则默认1P），例如BV1Dv411T7E2@3</Text>
                    <Text fontSize="md">为了避免卡顿，B站视频最多20min的时长！逾者不予播放</Text>
                    <Text fontSize="md">网易云和QQ很好理解如何点歌了</Text>
                    <Text fontSize="md">酷狗只能播放搜索到的第一首歌，因此id点歌直接输入详尽的关键字（例如曲名+歌手）</Text>
                    <Text fontSize="md" mt={1}>人多的时候，一人播放队列里请只点一首歌哦！（不含正在播放，人少就无所谓了）</Text>
                    <Text fontSize="md" mt={1}>非必要请勿切歌和置顶！</Text>
                    <Text fontSize="md" mt={1}>账号绑定没有出现歌单的情况，注意账号的隐私设置！</Text>
                    <Text fontSize="md" mt={1}>显示出问题可以试试刷新一下网页，或者找找被屏蔽的弹窗</Text>
                    <Text fontSize="md" mt={1}>手机端兼容性较差的话，请在手机浏览器上切换成电脑端。试试火狐和谷歌浏览器！</Text>
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
                                  if (newName.trim() === '') return toastInfo(t, "新名字不能为空");
                                  const user = await conn.current!.rename(newName.trim());
                                  setPersistentUserId(user.id);
                                  setUserName(user.name);
                                  setCookie(COOKIE_USERNAME_KEY, user.name, 365);
                                  toastInfo(t, `名字已成功修改为: ${user.name}`);
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
            {/* [修改] 不再传递 secondaryColor */}
            <ChatSection conn={conn.current} chatContent={chatContent}/>
          </Stack>
        </GridItem>
        <GridItem area={'main'}>
          <Tabs variant='soft-rounded' isLazy>
            <TabList m={4}><Tab>播放列表</Tab><Tab>从音乐ID点歌</Tab><Tab>从歌单点歌</Tab><Tab>播放历史</Tab></TabList>
            <TabPanels>
              <TabPanel>
                <Card>
                    <CardBody>
                        <Box mb={4}>
                          {nowPlaying ? (
                            <Grid
                              templateColumns={{ base: '1fr auto', md: 'auto 1fr auto' }}
                              templateRows={{ base: 'auto auto', md: '1fr' }}
                              gap={{ base: 1, md: 2 }}
                              alignItems="baseline"
                            >
                              <GridItem whiteSpace="nowrap">
                                <Heading size="md">正在播放:</Heading>
                              </GridItem>
                              
                              <GridItem overflow="hidden">
                                <MarqueeText>
                                  <Box as="span" fontWeight="bold" fontSize="lg">
                                    {`${nowPlaying.music.name} - ${nowPlaying.music.artists}`}
                                  </Box>
                                </MarqueeText>
                              </GridItem>

                              <GridItem whiteSpace="nowrap" justifySelf={{ base: 'end', md: 'start' }}>
                                {/* [修改] 直接使用主题中的二级字体颜色 */}
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
                        {/* [修改] 不再传递 secondaryColor */}
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
                        {!isConnReady ? <Text>初始化...</Text> : <MyPlaylist apis={apis} enqueue={(id, apiName) => { conn.current!.enqueueMusic(id, apiName).then(() => toastEnqueueOk(t)).catch(() => toastError(t, `音乐加入队列失败`)); }} />}
                    </CardBody>
                </Card>
              </TabPanel>
              <TabPanel>
                <Card>
                    <CardBody>
                        {/* [修改] 不再传递 secondaryColor */}
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
