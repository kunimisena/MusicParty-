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
    { name: string; content: string }[]
  >([]);
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
async (name: string, content: string) => {
  setChatContent((c) => {
    const newChat = [...c, { name, content }];
    return newChat.slice(-30); // ▲ 只保留最新30条消息
  });
},
        async (content: string) => {
          // todo
          console.log(content);
        },
        async (msg: string) => {
          console.error(msg);
          toastError(t, msg);
        }
      );
      conn.current
        .start()
        .then(async () => {
          try {
            const queue = await conn.current!.getMusicQueue();
            setQueue(queue);
            const users = await conn.current!.getOnlineUsers();
            setOnlineUsers(users);
          } catch (err: any) {
            toastError(t, err);
          }
        })
        .catch((e) => {
          console.error(e);
          toastError(t, '请刷新页面重试');
        });

      getProfile()
        .then((u) => {
          setUserName(u.name);
        })
        .catch((e) => {
          console.error(e);
          toastError(t, '请刷新页面重试');
        });

      getMusicApis().then((as) => setApis(as));

      setInited(true);
    }
  }, []);
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
                                if (newName === '') return;
                                await conn.current!.rename(newName);
                                const user = await getProfile();
                                setUserName(user.name);
                                onClose();
                                setNewName('');
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
                {apis.includes('NeteaseCloudMusic') && <NeteaseBinder />}
                {apis.includes('QQMusic') && <QQMusicBinder />}
                {apis.includes('Bilibili') && <BilibiliBinder />}
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
  maxH="300px"          // ▼ 固定高度
  overflowY="auto"      // ▼ 自动滚动条
  pr={2}                // ▼ 滚动条边距
  listStyleType="none"  // ▼ 移除列表点（可选）
  spacing={2}           // ▼ 消息间距（可选）
>
  {chatContent.map((s, index) => (
    <ListItem 
      key={`msg-${index}`}       // ▲ 更稳定的key生成方式
      bg="gray.50"               // ▲ 消息背景色（可选）
      p={2}                     // ▲ 内边距（可选）
      borderRadius="md"          // ▲ 圆角（可选）
    >
      <Text as="span" fontWeight="bold">{s.name}:</Text>
      <Text as="span" ml={2}>{s.content}</Text>
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
          </TabPanels>
        </Tabs>
      </GridItem>
    </Grid>
  );
}
