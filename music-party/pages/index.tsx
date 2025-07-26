import Head from 'next/head';
import React, { useEffect, useRef, useState } from 'react';
import { Connection, Music, MusicOrderAction } from '../src/api/musichub';
import {
  Text,
  Button,
  Card,
  CardBody,
  CardHeader,
  Grid,
  GridItem,
  Heading,
  Input,
  ListItem,
  OrderedList,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  useToast,
  Stack,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
  Portal,
  UnorderedList,
  Flex,
  Spacer,
  Highlight,
  Box,
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

// --- Cookie 辅助函数 (保持不变) ---
const COOKIE_USERNAME_KEY = 'chat_username_preference';
const DEFAULT_USERNAME_ON_NO_COOKIE = "请设置用户名";

const getCookie = (name: string): string | null => {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  if (match) {
    return decodeURIComponent(match[2]);
  }
  return null;
};

const setCookie = (name: string, value: string, days: number) => {
  if (typeof document === 'undefined') {
    return;
  }
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (encodeURIComponent(value) || "")  + expires + "; path=/";
};

// 聊天组件 (来自上次的性能优化, 保持不变)
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
        <CardHeader>
          <Heading>聊天</Heading>
        </CardHeader>
        <CardBody>
          <Flex>
            <Input
              flex={1}
              value={chatToSend}
              onChange={(e) => setChatToSend(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  if (chatToSend.trim() === '') return;
                  await conn?.chatSay(chatToSend);
                  setChatToSend('');
                }
              }}
            />
            <Button
              ml={2}
              onClick={async () => {
                if (chatToSend.trim() === '') return;
                await conn?.chatSay(chatToSend);
                setChatToSend('');
              }}
            >
              发送
            </Button>
          </Flex>
          <UnorderedList
            maxH="300px"
            overflowY="auto"
            pr={2}
            listStyleType="none"
            spacing={2}
            width="100%"
          >
            {chatContent.map((s) => (
              <ListItem
                key={`msg-${s.timestamp}`}
                bg="gray.50"
                p={2}
                borderRadius="md"
                wordBreak="break-word"
              >
                <Text as="span" fontSize="xs" color="gray.500" mr={2}>
                  {new Date(s.timestamp).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })}
                </Text>
                <Text as="span" fontWeight="bold">
                  {s.name}:
                </Text>
                <Text
                  as="span"
                  ml={2}
                  whiteSpace="pre-wrap"
                  overflowWrap="break-word"
                  display="inline-block"
                  maxW="full"
                >
                  {s.content}
                </Text>
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
  const [nowPlaying, setNowPlaying] = useState<{
    music: Music;
    enqueuer: string;
  }>();
  const [queue, setQueue] = useState<MusicOrderAction[]>([]);
  const [userName, setUserName] = useState('');
  const [newName, setNewName] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<
    { id: string; name: string }[]
  >([]);
  const [inited, setInited] = useState(false);
  const [chatContent, setChatContent] = useState<
  { name: string; content: string; timestamp: number }[]
  >([]); 
  const [isAutoDjDisabled, setIsAutoDjDisabled] = useState(false);
  const [isConnReady, setIsConnReady] = useState(false);
  const [apis, setApis] = useState<string[]>([]);
  const t = useToast();

  const conn = useRef<Connection>();
  // +++ 1. 创建“同步锁” +++
  // 使用 useRef, 因为它的变化不会触发组件重渲染
  const isSyncing = useRef(false);

  // +++ 2. 定义一个统一的、健壮的“身份确认与状态同步”函数 +++
  const syncIdentityAndState = async () => {
    if (!conn.current) return;

    try {
      console.log("Syncing identity and state with server...");

      // 步骤一: 重新确认身份
      const preferredName = getCookie(COOKIE_USERNAME_KEY) || DEFAULT_USERNAME_ON_NO_COOKIE;
      const userProfile = await conn.current.rename(preferredName);
      const confirmedName = userProfile.name;

      // 步骤二: 用服务器确认后的信息更新本地核心状态
      setUserName(confirmedName);
      setCookie(COOKIE_USERNAME_KEY, confirmedName, 365);

      // 步骤三: 在身份统一后, 安全地获取所有其它数据
      const users = await conn.current.getOnlineUsers();
      setOnlineUsers(users);

      const queueData = await conn.current.getMusicQueue();
      setQueue(queueData);
      
      await conn.current.requestSetNowPlaying();

      const autoDjStatus = await conn.current.getAutoDjStatus();
      setIsAutoDjDisabled(autoDjStatus);

      console.log("Sync complete. Current user:", confirmedName);

    } catch (err) {
      console.error("Failed to sync identity and state:", err);
      toastError(t, "与服务器同步失败，请尝试刷新页面。");
    }
  };


  useEffect(() => {
    if (!conn.current) {
      conn.current = new Connection(
        `${window.location.origin}/music`,
        // --- SignalR事件回调 ---
        async (music: Music, enqueuerName: string, playedTime: number) => {
          // 这个回调不需要锁，因为它不处理用户列表
          setSrc(music.url);
          setNowPlaying({ music, enqueuer: enqueuerName });
          setPlaytime(playedTime);
        },
        async (actionId: string, music: Music, enqueuerName: string) => {
          // 这个回调不需要锁
          setQueue((q) => q.concat({ actionId, music, enqueuerName }));
        },
        async () => setQueue((q) => q.slice(1)),
        async (actionId: string, operatorName: string) => {
          setQueue((q) => {
            const target = q.find((x) => x.actionId === actionId)!;
            toastInfo(t, `歌曲 "${target.music.name}-${target.music.artists}" 被 ${operatorName} 置顶了`);
            return [target].concat(q.filter((x) => x.actionId !== actionId));
          });
        },
        async (operatorName: string, _) => toastInfo(t, `${operatorName} 切到了下一首歌`),
        
        // +++ 3. 在处理用户列表相关的广播时, 检查“同步锁” +++
        async (id: string, name: string) => {
          if (isSyncing.current) return; // 如果正在同步, 则忽略此广播
          setOnlineUsers((u) => u.concat({ id, name }));
        },
        async (id: string) => {
          if (isSyncing.current) return; // 如果正在同步, 则忽略此广播
          setOnlineUsers((u) => u.filter((x) => x.id !== id));
        },
        async (id: string, newName: string) => {
          if (isSyncing.current) return; // 如果正在同步, 则忽略此广播
          setOnlineUsers((u) => u.map((x) => (x.id === id ? { id, name: newName } : x)));
        },
        
        async (name: string, content: string, timestamp: number) => {
          setChatContent(prevChatContent => [{ name, content: content.trim(), timestamp: timestamp * 1000 }, ...prevChatContent].slice(0, 100)); 
        },
        async (content: string) => console.log(content),
        (isDisabled: boolean) => {
          setIsAutoDjDisabled(isDisabled);
          toastInfo(t, `自动点歌机器人已${isDisabled ? '禁用' : '启用'}`);
        },
        async (msg: string) => {
          console.error(msg);
          toastError(t, msg);
        },
        // +++ 4. 在重连成功时, 启动“同步锁”流程 +++
        async () => {
          toastInfo(t, "已重新连接，正在同步状态...");
          isSyncing.current = true; // 上锁!
          await syncIdentityAndState(); // 执行同步
          isSyncing.current = false; // 解锁!
        }
      );

      // --- 页面首次加载逻辑 ---
      conn.current
        .start()
        .then(async () => {
          console.log("Initial connection successful.");
          // 首次加载时, 也使用这个统一的函数来初始化
          await syncIdentityAndState();

          // 首次加载时还需要额外获取聊天记录
          const chatHistory = await conn.current!.getChatHistory();
          setChatContent(chatHistory.map(msg => ({...msg, timestamp: msg.timestamp * 1000})));
          
          setIsConnReady(true);
        })
        .catch((e) => {
          console.error(e);
          toastError(t, '连接服务器失败，请刷新页面重试');
        });

      getMusicApis().then((as) => setApis(as));
      setInited(true);
    }
  }, [t]);


  // --- 其他 useEffect (保持不变) ---
  useEffect(() => {
    if (typeof window !== 'undefined') { 
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
      document.head.prepend(meta);
      const style = document.createElement('style');
      style.innerHTML = `
        @media (max-width: 768px) {
          body { padding: 8px !important; }
          .container > * { width: 100% !important; }
          button { min-width: 120px !important; }
          [data-area="nav"], [data-area="main"] {
            grid-column: 1 / -1 !important;
          }
          .chakra-tabs__tablist {
            flex-direction: column;
          }
        }`;
      document.head.appendChild(style);
    }
  }, []);

 useEffect(() => {
   if (!isConnReady || !conn.current) return;
   const heartbeatInterval = setInterval(() => {
     console.log("Sending heartbeat...");
     conn.current?.heartbeat();
   }, 60000); 
   return () => clearInterval(heartbeatInterval);
 }, [isConnReady]);

  // --- JSX (保持不变) ---
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
              <Text fontSize="md" color="gray.600">
                请改成群内昵称
              </Text>
              <Text fontSize="md" color="gray.600">
                b站id点歌可以通过“@”来输入特定的P（否则默认1P），例如BV1Dv411T7E2@3
              </Text>
              <Text fontSize="md" color="gray.600">
                为了避免卡顿，B站视频最多20min的时长！逾者不予播放
              </Text>
              <Text fontSize="md" color="gray.600">
                网易云和QQ很好理解如何点歌了
              </Text>
              <Text fontSize="md" color="gray.600">
                酷狗只能播放搜索到的第一首歌，因此id点歌直接输入详尽的关键字（例如曲名+歌手）
              </Text>
              <Text fontSize="md" color="gray.600" mt={1}>
                人多的时候，一人播放队列里请只点一首歌哦！（不含正在播放，人少就无所谓了）
              </Text>
              <Text fontSize="md" color="gray.600" mt={1}>
                非必要请勿切歌和置顶！
              </Text>
              <Text fontSize="md" color="gray.600" mt={1}>
                账号绑定没有出现歌单的情况，注意账号的隐私设置！
              </Text>
              <Text fontSize="md" color="gray.600" mt={1}>
                显示出问题可以试试刷新一下网页，或者找找被屏蔽的弹窗
              </Text>
              <Text fontSize="md" color="gray.600" mt={1}>
                手机端兼容性较差的话，请在手机浏览器上切换成电脑端。试试火狐和谷歌浏览器！
              </Text>
              <Text fontSize="md" color="gray.600" mt={1}>
                有问题多联系！
              </Text>
            </Box>
          </CardHeader>
            <CardBody>
              <Stack>
                <Popover>
                  {({ onClose }) => (
                    <>
                      <PopoverTrigger>
                        <Button>修改名字</Button>
                      </PopoverTrigger>
                      <Portal>
                        <PopoverContent>
                          <PopoverArrow />
                          <PopoverHeader>修改名字</PopoverHeader>
                          <PopoverCloseButton />
                          <PopoverBody>
                            <Input
                              value={newName}
                              placeholder={'输入新名字'}
                              onChange={(e) => setNewName(e.target.value)}
                            ></Input>
                          </PopoverBody>
                          <PopoverFooter>
                            <Button
                              colorScheme='blue'
                              onClick={async () => {
                                if (newName.trim() === '') {
                                  toastInfo(t, "新名字不能为空");
                                  return;
                                }
                                try {
                                  await conn.current!.rename(newName.trim());
                                  const user = await getProfile();
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
                <Flex
                  alignItems="center"
                  p={2}
                  borderWidth="1px"
                  borderRadius="md"
                  borderColor="gray.200"
                >
                  <Button
                    colorScheme={isAutoDjDisabled ? 'green' : 'orange'}
                    onClick={() => {
                      if (isAutoDjDisabled) {
                        conn.current?.enableAutoDj();
                      } else {
                        conn.current?.disableAutoDj();
                      }
                    }}
                  >
                    {isAutoDjDisabled ? '启用点歌机器人' : '禁用点歌机器人'}
                  </Button>
                  <Text ml={3} fontSize="sm" color="gray.600">
                    (当前状态: {isAutoDjDisabled ? '已禁用' : '已启用'})
                  </Text>
                </Flex>
                {apis.includes('NeteaseCloudMusic') && <NeteaseBinder />}
                {apis.includes('QQMusic') && <QQMusicBinder />}
                {apis.includes('Bilibili') && <BilibiliBinder />}
                {apis.includes('KuGouMusic') && <KuGouBinder />}
              </Stack>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <Heading>在线</Heading>
            </CardHeader>
            <CardBody>
              <UnorderedList>
                {onlineUsers.map((u) => {
                  return <ListItem key={u.id}>{u.name}</ListItem>;
                })}
              </UnorderedList>
            </CardBody>
          </Card>

          <ChatSection conn={conn.current} chatContent={chatContent} />

        </Stack>
      </GridItem>

      <GridItem area={'main'}>
        <Tabs>
          <TabList>
            <Tab>播放列表</Tab>
            <Tab>从音乐ID点歌</Tab>
            <Tab>从歌单点歌</Tab>
            <Tab>播放历史</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <Flex flexDirection={'row'} mb={4} alignItems={'flex-end'}>
                {nowPlaying ? (
                  <>
                    <Heading>
                      {`正在播放:\n ${nowPlaying?.music.name} - ${nowPlaying?.music.artists}`}
                    </Heading>
                    <Text size={'md'} fontStyle={'italic'} ml={2}>
                      {`由 ${nowPlaying?.enqueuer} 点歌`}
                    </Text>
                  </>
                ) : (
                  <Heading>暂无歌曲正在播放</Heading>
                )}
              </Flex>

              <MusicPlayer
                src={src}
                playtime={playtime}
                nextClick={() => {
                  conn.current?.nextSong();
                }}
                reset={() => {
                  console.log('reset');
                  conn.current!.requestSetNowPlaying();
                  conn.current!.getMusicQueue().then((q) => {
                    setQueue(q);
                  });
                }}
              />

              <MusicQueue
                queue={queue}
                top={(actionId) => {
                  conn.current!.topSong(actionId);
                }}
              />
            </TabPanel>
            <TabPanel>
              <MusicSelector apis={apis} conn={conn.current!} />
            </TabPanel>
            <TabPanel>
              {!inited ? (
                <Text>初始化...</Text>
              ) : (
                <MyPlaylist
                  apis={apis}
                  enqueue={(id, apiName) => {
                    conn
                      .current!.enqueueMusic(id, apiName)
                      .then(() => {
                        toastEnqueueOk(t);
                      })
                      .catch(() => {
                        toastError(t, `音乐 {id: ${id}} 加入队列失败`);
                      });
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
