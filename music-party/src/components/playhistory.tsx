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
import React from 'react';
import { Connection, HistoryMusic, PlayHistoryEntry } from '../api/musichub';

interface PlayHistoryProps {
  conn?: Connection;
  isConnReady: boolean;
  history: PlayHistoryEntry[];
  isLoading: boolean;
}

export const PlayHistory = (props: PlayHistoryProps) => {
  const { conn, history, isLoading } = props;
  const t = useToast();

  const handleReplay = (music: HistoryMusic, apiName: string) => {
    if (!conn) return;
    conn.replayMusic(music, apiName)
      .then(() => {
        // 修改：直接调用 t，不再使用辅助函数
        t({ title: '成功加入队列', status: 'success', duration: 3000, isClosable: true, position: 'bottom' });
      })
      .catch((e) => {
        // 修改：直接调用 t，不再使用辅助函数
        t({ title: '错误', description: `歌曲 (${music.name}) 加入队列失败`, status: 'error', duration: 5000, isClosable: true, position: 'bottom' });
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
              {history.map((entry) => (
                <ListItem key={`${entry.music.id}-${entry.timestamp}`}>
                  <Flex 
                    justifyContent="space-between" 
                    alignItems="center"
                    direction={{ base: 'column', md: 'row' }} 
                  >
                    <Box flex={1} mb={{ base: 2, md: 0 }}>
                      <Text fontWeight="bold" fontSize="lg">{entry.music.name}</Text>
                      <Text fontSize="md" color="text.2">{entry.music.artists.join(' / ')}</Text>
                      <Text fontSize="sm" fontStyle="italic" color="text.2">由 {entry.enqueuerName} 点播</Text>
                    </Box>
                    <Button
                      size="sm"
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
