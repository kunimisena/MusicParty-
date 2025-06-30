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

// --- Cookie 辅助函数 ---
const COOKIE_USERNAME_KEY = 'chat_username_preference'; // 用于存储用户名的 Cookie键
const DEFAULT_USERNAME_ON_NO_COOKIE = "请设置用户名"; // Cookie中没有用户名时的默认提示

const getCookie = (name: string): string | null => {
  if (typeof document === 'undefined') { // 防止在服务器端渲染时调用 document
    return null;
  }
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  if (match) {
    return decodeURIComponent(match[2]);
  }
  return null;
};

const setCookie = (name: string, value: string, days: number) => {
  if (typeof document === 'undefined') { // 防止在服务器端渲染时调用 document
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
  >([]); // 初始化为空数组
  // [新增] 机器人状态
  const [isAutoDjDisabled, setIsAutoDjDisabled] = useState(false);
  const [isConnReady, setIsConnReady] = useState(false);
  const [chatToSend, setChatToSend] = useState('');
  const [apis, setApis] = useState<string[]>([]);
  const t = useToast();

  const conn = useRef<Connection>();
  useEffect(() => {
    if (!conn.current) {
      conn.current = new Connection(
        `${window.location.origin}/music`,
        async (music: Music, enqueuerName: string, playedTime: number) => {
          console.log(music);
          setSrc(music.url);
          setNowPlaying({ music, enqueuer: enqueuerName });
          setPlaytime(playedTime);
        },
        async (actionId: string, music: Music, enqueuerName: string) => {
          setQueue((q) => q.concat({ actionId, music, enqueuerName }));
        },
        async () => {
          setQueue((q) => q.slice(1));
        },
        async (actionId: string, operatorName: string) => {
          setQueue((q) => {
            const target = q.find((x) => x.actionId === actionId)!;
            toastInfo(
              t,
              `歌曲 "${target.music.name}-${target.music.artists}" 被 ${operatorName} 置顶了`
            );
            return [target].concat(q.filter((x) => x.actionId !== actionId));
          });
        },
        async (operatorName: string, _) => {
          toastInfo(t, `${operatorName} 切到了下一首歌`);
        },
        async (id: string, name: string) => {
          setOnlineUsers((u) => u.concat({ id, name }));
        },
        async (id: string) => {
          setOnlineUsers((u) => u.filter((x) => x.id !== id));
        },
        async (id: string, newName: string) => {
          setOnlineUsers((u) =>
            u.map((x) => (x.id === id ? { id, name: newName } : x))
          );
        },
        async (name: string, content: string, timestamp: number) => {

          setChatContent(prevChatContent => {
              const newMsg = {
              name,
              content: content.trim(),
              timestamp: timestamp * 1000
            };

            return [newMsg, ...prevChatContent].slice(0, 100);
          }); 
        },
        async (content: string) => {
          // todo
          console.log(content);
          },
        // [新增] 机器人状态变更处理器
        (isDisabled: boolean) => {
          setIsAutoDjDisabled(isDisabled);
          toastInfo(t, `自动点歌机器人已${isDisabled ? '禁用' : '启用'}`);
        },
        async (msg: string) => {
          console.error(msg);
          toastError(t, msg); // ✅ 直接使用已定义的msg参数
        }
      );
      conn.current
        .start()
        .then(async () => {
            // 连接成功后，处理用户名
          const preferredNameFromCookie = getCookie(COOKIE_USERNAME_KEY);
          const initialNameCandidate = preferredNameFromCookie || DEFAULT_USERNAME_ON_NO_COOKIE;
          //console.log(`[INIT] 初始候选用户名 (来自Cookie或默认): ${initialNameCandidate}`);
          try {
            // 1. 尝试将候选用户名设置到服务器
            await conn.current!.rename(initialNameCandidate);
            // toastInfo(t, `尝试设置用户名为: ${initialNameCandidate}`); // 可选的提示
            console.log(`[INIT] 已发送 rename 请求，用户名为: ${initialNameCandidate}`);

            // 2. 从服务器获取最终确认的用户名
            const userProfile = await getProfile();
            const confirmedName = userProfile.name;
            setUserName(confirmedName);
            setCookie(COOKIE_USERNAME_KEY, confirmedName, 365); // 保存服务器确认的名称到Cookie
            console.log(`[INIT] 服务器确认的用户名: ${confirmedName} (已存入Cookie)`);
            if (confirmedName === DEFAULT_USERNAME_ON_NO_COOKIE && !preferredNameFromCookie) {
              toastInfo(t, "欢迎您！请记得修改您的用户名。");
            }

            
            // 3. 获取其他初始数据
            const queueData = await conn.current!.getMusicQueue(); // 变量名从 queue 改为 queueData
            setQueue(queueData); // 使用新的变量名
            const users = await conn.current!.getOnlineUsers();
            setOnlineUsers(users);
            const chatHistory = await conn.current!.getChatHistory();
            setChatContent(chatHistory.map(msg => ({...msg, timestamp: msg.timestamp * 1000})));
            const autoDjStatus = await conn.current!.getAutoDjStatus();
            setIsAutoDjDisabled(autoDjStatus);
            setIsConnReady(true); // 连接和初始数据加载全部完成后，设置就绪状态
          } catch (err: any) {
            toastError(t, err);
            try {
              const fallbackProfile = await getProfile();
              setUserName(fallbackProfile.name);
              setCookie(COOKIE_USERNAME_KEY, fallbackProfile.name, 365); // 保存当前服务器名称
            } catch (profileError: any) {
              toastError(t, `获取用户配置也失败了: ${profileError.toString()}`);
            }
          }
        })
        .catch((e) => {
          console.error(e);
          toastError(t, '请刷新页面重试');
        });

      getMusicApis().then((as) => setApis(as));

      setInited(true);
    }
  }, [t]);
  useEffect(() => {
    // 移动端优化代码
    if (typeof window !== 'undefined') { // 确保只在客户端运行
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
          /* 以下新增针对你的布局 */
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
 // +++ 新增下面的整个 useEffect 代码块 +++
 useEffect(() => {
   // 确保 SignalR 连接已经完全就绪
   if (!isConnReady || !conn.current) {
     return;
   }

   // 设置一个定时器，每隔 60 秒（1分钟）发送一次心跳
   const heartbeatInterval = setInterval(() => {
     console.log("Sending heartbeat..."); // 这行日志可以帮助你调试
     conn.current?.heartbeat();
   }, 60000); 

   // 关键的清理步骤：当组件被卸载（比如用户离开页面）时，
   // 清除这个定时器，防止内存泄漏。
   return () => {
     clearInterval(heartbeatInterval);
   };
 }, [isConnReady]); // 这个 effect 只在 isConnReady 状态变化时运行一次
  return (
    <Grid 
  templateAreas={{
    base: `"nav" "main"`,  // 手机：上下排列
    md: `"nav main"`       // 桌面：左右排列
  }}
  gridTemplateColumns={{
    base: '1fr',          // 手机：单列
    md: '2fr 5fr'         // 桌面：两列比例
  }}
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
                                  const user = await getProfile(); // 从服务器获取确认后的名字
                                  setUserName(user.name);
                                  setCookie(COOKIE_USERNAME_KEY, user.name, 365); // 更新Cookie
                                  toastInfo(t, `名字已成功修改为: ${user.name}`);
                                  onClose();
                                  setNewName(''); // 清空输入框
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
                +                {/* [新增] 自动点歌机器人控制按钮 */}
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
                    if (e.key === "Enter") {
                      if (chatToSend === '') return;
                      await conn.current?.chatSay(chatToSend);
                      setChatToSend('');
                    }
                  }}
                />
                <Button
                  ml={2}
                  onClick={async () => {
                    if (chatToSend === '') return;
                    await conn.current?.chatSay(chatToSend);
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
                  {chatContent.map((s) => ( // chatContent is already newest first [msg3, msg2, msg1]
                      <ListItem
                        key={`msg-${s.timestamp}`}
                        bg="gray.50"
                        p={2}
                        borderRadius="md"
                        wordBreak="break-word"
                      >
                        {/* 时间显示 - Use timestamp (already in ms) */}
                        <Text
                          as="span"
                          fontSize="xs"
                          color="gray.500"
                          mr={2}
                        >
                          {new Date(s.timestamp).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                           })}
                        </Text>
                        {/* 消息内容 */}
                        <Text as="span" fontWeight="bold">{s.name}:</Text>
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
