import {
  Box,
  Button,
  Flex,
  List,
  ListItem,
  Stack,
  Text,
  useToast,
  Divider,
  Skeleton
} from '@chakra-ui/react';
import React, { useEffect, useState } from 'react';
// [修改] 导入 HistoryMusic 类型
import { Connection, HistoryMusic, PlayHistoryEntry } from '../api/musichub';
import { toastEnqueueOk, toastError } from '../utils/toast';

interface PlayHistoryProps {
  conn?: Connection;
  isConnReady: boolean;
}

export const PlayHistory = (props: PlayHistoryProps) => {
  const { conn, isConnReady } = props;
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const t = useToast();

  useEffect(() => {
    if (!isConnReady || !conn) {
      return;
    }

    conn.getPlayHistory()
      .then(data => {
        setHistory(data);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("获取播放历史失败:", err);
        toastError(t, "获取播放历史失败，请刷新页面重试。");
        setIsLoading(false);
      });
  }, [conn, isConnReady, t]);

  // [修改] handleReplay 函数现在接收 music 对象和 apiName
  const handleReplay = (music: HistoryMusic, apiName: string) => {
    if (!conn) return;

    // [修改] 调用新的 replayMusic 方法，传递整个 music 对象
    conn.replayMusic(music, apiName)
      .then(() => {
        toastEnqueueOk(t);
      })
      .catch((e) => {
        // [修改] 错误提示中使用 music.name
        toastError(t, `歌曲 (${music.name}) 加入队列失败`);
        console.error(e);
      });
  };

  return (
    <Stack spacing={4} mt={4}>
      <Text fontSize="2xl" fontWeight="bold">播放历史</Text>
      <Divider />
      <Box
        borderWidth="1px"
        borderRadius="lg"
        p={4}
        maxH={{ base: '60vh', md: '70vh' }}
        overflowY="auto"
      >
        <Skeleton isLoaded={!isLoading}>
          {history.length > 0 ? (
            <List spacing={3}>
              {history.map((entry, index) => (
                <ListItem key={`${entry.music.id}-${entry.timestamp}-${index}`}>
                  <Flex 
                    justifyContent="space-between" 
                    alignItems="center"
                    direction={{ base: 'column', md: 'row' }} 
                  >
                    <Box flex={1} mb={{ base: 2, md: 0 }}>
                      <Text fontWeight="bold" fontSize="lg">{entry.music.name}</Text>
                      <Text fontSize="md" color="gray.500">{entry.music.artists.join(' / ')}</Text>
                      <Text fontSize="sm" fontStyle="italic">由 {entry.enqueuerName} 点播</Text>
                    </Box>
                    <Button
                      colorScheme="teal"
                      variant="outline"
                      size="sm"
                      // [修改] 调用 handleReplay 时传入 entry.music 和 entry.apiName
                      onClick={() => handleReplay(entry.music, entry.apiName)}
                    >
                      重新播放
                    </Button>
                  </Flex>
                </ListItem>
              ))}
            </List>
          ) : (
            <Text>还没有播放历史哦，快去点歌吧！</Text>
          )}
        </Skeleton>
      </Box>
    </Stack>
  );
};
