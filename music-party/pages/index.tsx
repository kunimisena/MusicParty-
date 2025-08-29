import Head from 'next/head';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Connection, Music, MusicOrderAction } from '../src/api/musichub';
import {
  Text, Button, Card, CardBody, CardHeader, Grid, GridItem, Heading, Input, ListItem,
  Tab, TabList, TabPanel, TabPanels, Tabs, useToast, Stack, Popover, PopoverArrow,
  PopoverBody, PopoverCloseButton, PopoverContent, PopoverFooter, PopoverHeader,
  PopoverTrigger, Portal, UnorderedList, Flex, Box,
} from '@chakra-ui/react';
import { MusicPlayer } from '../src/components/musicplayer';
import { getMusicApis, getProfile } from '../src/api/api';
import { NeteaseBinder } from '../src/components/neteasebinder';
import { MyPlaylist } from '../src/components/myplaylist';
import { toastEnqueueOk, toastError, toastInfo } from '../src/utils/toast';
import { MusicSelector } from '../src/components/musicselector';
import { QQMusicBinder } from '../src/components/qqmusicbinder';
import { MusicQueue } from '../src/components/musicqueue';
import { BilibiliBinder } from '../src/components/bilibilibinder';
import { KuGouBinder } from '../src/components/kugoubinder';
import { PlayHistory } from '../src/api/playhistory';

// --- 类型定义 ---
type OnlineUser = { id: string; name: string };

// --- Cookie 和 LocalStorage 辅助函数 ---
const COOKIE_USERNAME_KEY = 'chat_username_preference';
const LOCALSTORAGE_USERID_KEY = 'music_party_user_id'; // [新增] 用于在LocalStorage中存储用户ID的键
const DEFAULT_USERNAME_ON_NO_COOKIE = "请设置用户名";

// --- LocalStorage 辅助函数 [新增] ---
// 使用LocalStorage来持久化存储用户ID，因为它比Cookie更不容易被浏览器自动清除
const getPersistentUserId = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LOCALSTORAGE_USERID_KEY);
};

const setPersistentUserId = (id: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCALSTORAGE_USERID_KEY, id);
};


// --- Cookie 辅助函数 (无变化) ---
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

// --- 聊天组件 (无变化) ---
const ChatSection = React.memo(function ChatSection({
    conn,
    chatContent,
  }: {
    conn: Connection | undefined;
    chatContent: { name: string; content: string; timestamp: number }[];
  }) {
    const [chatToSend, setChatToSend] = useState('');
  
    return (
      <Card>
        <CardHeader><Heading>聊天</Heading></CardHeader>
        <CardBody>
          <Flex>
            <Input
              flex={1} value={chatToSend} onChange={(e) => setChatToSend(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && chatToSend.trim()) {
                  await conn?.chatSay(chatToSend);
                  setChatToSend('');
                }
              }}
            />
            <Button ml={2} onClick={async () => {
                if (chatToSend.trim()) {
                  await conn?.chatSay(chatToSend);
                  setChatToSend('');
                }
              }}
            >
              发送
            </Button>
          </Flex>
          <UnorderedList maxH="300px" overflowY="auto" pr={2} listStyleType="none" spacing={2} width="100%">
            {chatContent.map((s) => (
              <ListItem key={`msg-${s.timestamp}`} bg="gray.50" p={2} borderRadius="md" wordBreak="break-word">
                <Text as="span" fontSize="xs" color="gray.500" mr={2}>
                  {new Date(s.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </Text>
                <Text as="span" fontWeight="bold">{s.name}:</Text>
                <Text as="span" ml={2} whiteSpace="pre-wrap" overflowWrap="break-word" display="inline-block" maxW="full">{s.content}</Text>
              </ListItem>
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

  const [inited, setInited] = useState(false);
  const [chatContent, setChatContent] = useState<{ name: string; content: string; timestamp: number }[]>([]); 
  const [isAutoDjDisabled, setIsAutoDjDisabled] = useState(false);
  const [isConnReady, setIsConnReady] = useState(false);
  const [apis, setApis] = useState<string[]>([]);
  const t = useToast();

  const conn = useRef<Connection>();
  const isSyncing = useRef(false);

  const syncIdentityAndState = useCallback(async () => {
    if (!conn.current || isSyncing.current) return;

    isSyncing.current = true;
    console.log("Syncing identity and state with server...");

    try {
      const preferredName = getCookie(COOKIE_USERNAME_KEY) || DEFAULT_USERNAME_ON_NO_COOKIE;
      const userProfile = await conn.current.rename(preferredName);
      
      // [核心修改] 将服务器返回的权威ID持久化存储到LocalStorage
      // 这样即使用户的Cookie丢失，我们也能通过URL参数找回身份
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

      console.log("Sync complete. Current user ID:", userProfile.id, "Name:", userProfile.name);
    } catch (err) {
      console.error("Failed to sync identity and state:", err);
      toastError(t, "与服务器同步失败，请尝试刷新页面。");
    } finally {
      isSyncing.current = false;
    }
  }, [t]);


  useEffect(() => {
    if (conn.current) return;

    // [核心修改] 动态构建SignalR Hub的URL
    // 优先从LocalStorage读取用户ID，如果存在，则将其作为查询参数附加到URL上
    // 这是保证移动端重连时身份不丢失的关键
    let hubUrl = `${window.location.origin}/music`;
    const persistentId = getPersistentUserId();
    if (persistentId) {
      hubUrl += `?userId=${persistentId}`;
      console.log(`Connecting with persistent UserID: ${persistentId}`);
    } else {
      console.log("No persistent UserID found, connecting as new user.");
    }

    conn.current = new Connection(
      hubUrl, // 使用我们刚刚构建的URL
      (music, enqueuerName, playedTime) => {
        setSrc(music.url);
        setNowPlaying({ music, enqueuer: enqueuerName });
        setPlaytime(playedTime);
      },
      (actionId, music, enqueuerName) => {
        setQueue(q => [...q, { actionId, music, enqueuerName }]);
      },
      () => setQueue(q => q.slice(1)),
      (actionId, operatorName) => {
        setQueue(q => {
          const target = q.find((x) => x.actionId === actionId);
          if (!target) return q;
          toastInfo(t, `歌曲 "${target.music.name}-${target.music.artists}" 被 ${operatorName} 置顶了`);
          return [target, ...q.filter((x) => x.actionId !== actionId)];
        });
      },
      (operatorName, _) => toastInfo(t, `${operatorName} 切到了下一首歌`),
      
      (id, name) => {
        if (isSyncing.current) return;
        setOnlineUsers(prevMap => new Map(prevMap).set(id, { id, name }));
      },
      (id) => {
        if (isSyncing.current) return;
        setOnlineUsers(prevMap => {
          const newMap = new Map(prevMap);
          newMap.delete(id);
          return newMap;
        });
      },
      (id, newName) => {
        if (isSyncing.current) return;
        setOnlineUsers(prevMap => {
            if (!prevMap.has(id)) return prevMap;
            return new Map(prevMap).set(id, { id, name: newName });
        });
      },
      
      (name, content, timestamp) => {
        setChatContent(prev => [{ name, content: content.trim(), timestamp: timestamp * 1000 }, ...prev].slice(0, 100)); 
      },
      (content) => console.log(content),
      (isDisabled) => {
        setIsAutoDjDisabled(isDisabled);
        toastInfo(t, `自动点歌机器人已${isDisabled ? '禁用' : '启用'}`);
      },
      (msg) => {
        console.error(msg);
        toastError(t, msg);
      },
      async () => {
        toastInfo(t, "已重新连接，正在同步状态...");
        await syncIdentityAndState();
      }
    );

    conn.current.start()
      .then(async () => {
        console.log("Initial connection successful.");
        await syncIdentityAndState();
        const chatHistory = await conn.current!.getChatHistory();
        setChatContent(chatHistory.map(msg => ({...msg, timestamp: msg.timestamp * 1000})));
        setIsConnReady(true);
      })
      .catch((e) => {
        console.error(e);
        toastError(t, '连接服务器失败，请刷新页面重试');
      });

    getMusicApis().then(setApis);
    setInited(true);
  }, [syncIdentityAndState, t]);


  useEffect(() => {
    if (typeof window !== 'undefined') { 
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
      document.head.prepend(meta);
    }
  }, []);

  useEffect(() => {
   if (!isConnReady || !conn.current) return;
   const heartbeatInterval = setInterval(() => {
     console.log("Sending heartbeat...");
     conn.current?.heartbeat();
   }, 30000); 
   return () => clearInterval(heartbeatInterval);
  }, [isConnReady]);

  return (
    <Grid 
      templateAreas={{ base: `"nav" "main"`, md: `"nav main"` }}
      gridTemplateColumns={{ base: '1fr', md: '2fr 5fr' }}
      gap='1'
    >
      <Head>
        <title>🎵 音趴 🎵</title>
        <meta name='description' content='享受音趴！' />
        <link rel='icon' href='/favicon.ico' />
        <meta name='referrer' content='never' />
      </Head>
      <GridItem area={'nav'}>
        <Stack m={4} spacing={4}>
          <Card>
          <CardHeader>
            <Box>
              <Heading mb={2}>{`欢迎, ${userName}!`}</Heading>
              <Text fontSize="md" color="gray.600">请改成群内昵称</Text>
              <Text fontSize="md" color="gray.600">b站id点歌可以通过“@”来输入特定的P（否则默认1P），例如BV1Dv411T7E2@3</Text>
              <Text fontSize="md" color="gray.600">为了避免卡顿，B站视频最多20min的时长！逾者不予播放</Text>
              <Text fontSize="md" color="gray.600">网易云和QQ很好理解如何点歌了</Text>
              <Text fontSize="md" color="gray.600">酷狗只能播放搜索到的第一首歌，因此id点歌直接输入详尽的关键字（例如曲名+歌手）</Text>
              <Text fontSize="md" color="gray.600" mt={1}>人多的时候，一人播放队列里请只点一首歌哦！（不含正在播放，人少就无所谓了）</Text>
              <Text fontSize="md" color="gray.600" mt={1}>非必要请勿切歌和置顶！</Text>
              <Text fontSize="md" color="gray.600" mt={1}>账号绑定没有出现歌单的情况，注意账号的隐私设置！</Text>
              <Text fontSize="md" color="gray.600" mt={1}>显示出问题可以试试刷新一下网页，或者找找被屏蔽的弹窗</Text>
              <Text fontSize="md" color="gray.600" mt={1}>手机端兼容性较差的话，请在手机浏览器上切换成电脑端。试试火狐和谷歌浏览器！</Text>
              <Text fontSize="md" color="gray.600" mt={1}>有问题多联系！</Text>
            </Box>
          </CardHeader>
            <CardBody>
              <Stack>
                <Popover>
                  {({ onClose }) => (
                    <>
                      <PopoverTrigger><Button>修改名字</Button></PopoverTrigger>
                      <Portal>
                        <PopoverContent>
                          <PopoverArrow />
                          <PopoverHeader>修改名字</PopoverHeader>
                          <PopoverCloseButton />
                          <PopoverBody>
                            <Input value={newName} placeholder={'输入新名字'} onChange={(e) => setNewName(e.target.value)} />
                          </PopoverBody>
                          <PopoverFooter>
                            <Button colorScheme='blue' onClick={async () => {
                                if (newName.trim() === '') {
                                  toastInfo(t, "新名字不能为空");
                                  return;
                                }
                                try {
                                  // [核心修改] rename 成功后，服务器返回的 profile 中包含权威 ID
                                  const user = await conn.current!.rename(newName.trim());
                                  // [核心修改] 再次确保存储的是最新的权威ID
                                  setPersistentUserId(user.id);
                                  
                                  setUserName(user.name);
                                  setCookie(COOKIE_USERNAME_KEY, user.name, 365);
                                  toastInfo(t, `名字已成功修改为: ${user.name}`);
                                  onClose();
                                  setNewName('');
                                } catch (error: any) {
                                  console.error("Failed to rename:", error);
                                  toastError(t, `修改名字失败: ${error.toString()}`);
                                }
                              }}
                            >
                              确认
                            </Button>
                          </PopoverFooter>
                        </PopoverContent>
                      </Portal>
                    </>
                  )}
                </Popover>
                <Flex alignItems="center" p={2} borderWidth="1px" borderRadius="md" borderColor="gray.200">
                  <Button
                    colorScheme={isAutoDjDisabled ? 'green' : 'orange'}
                    onClick={() => {
                      if (isAutoDjDisabled) conn.current?.enableAutoDj();
                      else conn.current?.disableAutoDj();
                    }}
                  >
                    {isAutoDjDisabled ? '启用点歌机器人' : '禁用点歌机器人'}
                  </Button>
                  <Text ml={3} fontSize="sm" color="gray.600">(当前状态: {isAutoDjDisabled ? '已禁用' : '已启用'})</Text>
                </Flex>
                {apis.includes('NeteaseCloudMusic') && <NeteaseBinder />}
                {apis.includes('QQMusic') && <QQMusicBinder />}
                {apis.includes('Bilibili') && <BilibiliBinder />}
                {apis.includes('KuGouMusic') && <KuGouBinder />}
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><Heading>在线</Heading></CardHeader>
            <CardBody>
              <UnorderedList>
                {Array.from(onlineUsers.values()).map((u) => (
                  <ListItem key={u.id}>{u.name}</ListItem>
                ))}
              </UnorderedList>
            </CardBody>
          </Card>
          <ChatSection conn={conn.current} chatContent={chatContent} />
        </Stack>
      </GridItem>
      <GridItem area={'main'}>
        <Tabs>
          <TabList>
            <Tab>播放列表</Tab><Tab>从音乐ID点歌</Tab><Tab>从歌单点歌</Tab><Tab>播放历史</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <Flex flexDirection={'row'} mb={4} alignItems={'flex-end'}>
                {nowPlaying ? (
                  <>
                    <Heading>{`正在播放:\n ${nowPlaying?.music.name} - ${nowPlaying?.music.artists}`}</Heading>
                    <Text size={'md'} fontStyle={'italic'} ml={2}>{`由 ${nowPlaying?.enqueuer} 点歌`}</Text>
                  </>
                ) : ( <Heading>暂无歌曲正在播放</Heading> )}
              </Flex>
              <MusicPlayer
                src={src} playtime={playtime}
                nextClick={() => conn.current?.nextSong()}
                reset={async () => {
                  console.log('reset');
                  await conn.current!.requestSetNowPlaying();
                  const q = await conn.current!.getMusicQueue();
                  setQueue(q);
                }}
              />
              <MusicQueue queue={queue} top={(actionId) => conn.current!.topSong(actionId)} />
            </TabPanel>
            <TabPanel>
              <MusicSelector apis={apis} conn={conn.current!} />
            </TabPanel>
            <TabPanel>
              {!inited ? ( <Text>初始化...</Text> ) : (
                <MyPlaylist
                  apis={apis}
                  enqueue={(id, apiName) => {
                    conn.current!.enqueueMusic(id, apiName)
                      .then(() => toastEnqueueOk(t))
                      .catch(() => toastError(t, `音乐 {id: ${id}} 加入队列失败`));
                  }}
                />
              )}
            </TabPanel>
            <TabPanel>
              <PlayHistory conn={conn.current} isConnReady={isConnReady} />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </GridItem>
    </Grid>
  );
}
