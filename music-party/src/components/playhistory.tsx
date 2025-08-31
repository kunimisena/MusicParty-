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
  Skeleton,
  useBreakpointValue
} from '@chakra-ui/react';
import React, { CSSProperties, useRef, useState, useEffect, memo } from 'react';
import { FixedSizeList } from 'react-window';
import { Connection, HistoryMusic, PlayHistoryEntry } from '../api/musichub';
import { MarqueeText } from './MarqueeText';

interface PlayHistoryProps {
  conn?: Connection;
  isConnReady: boolean;
  history: PlayHistoryEntry[];
  isLoading: boolean;
}

export const PlayHistory = memo((props: PlayHistoryProps) => {
  const { conn, history, isLoading } = props;
  const t = useToast();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);

  const itemSize = useBreakpointValue({ base: 120, md: 95 });

  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      if (entries[0]) {
        setListHeight(entries[0].contentRect.height);
      }
    });

    if (listContainerRef.current) {
      resizeObserver.observe(listContainerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);


  const handleReplay = (music: HistoryMusic, apiName: string) => {
    if (!conn) return;
    conn.replayMusic(music, apiName)
      .then(() => {
        t({ title: '成功加入队列', status: 'success', duration: 3000, isClosable: true, position: 'bottom' });
      })
      .catch((e) => {
        t({ title: '错误', description: `歌曲 (${music.name}) 加入队列失败`, status: 'error', duration: 5000, isClosable: true, position: 'bottom' });
        console.error(e);
      });
  };

  const Row = ({ index, style }: { index: number; style: CSSProperties }) => {
    const entry = history[index];
    return (
      <ListItem key={`${entry.music.id}-${entry.timestamp}`} style={style} py={2} px={4} _hover={{ bg: 'bg.2' }} listStyleType="none">
        <Flex
          justifyContent="space-between"
          alignItems="center"
          direction={{ base: 'column', md: 'row' }}
          h="100%"
        >
          <Box flex={1} mb={{ base: 2, md: 0 }} overflow="hidden" w="100%" pr={{md: 4}} minWidth={0}>
            <MarqueeText>
              <Text fontWeight="bold" fontSize="md" whiteSpace="nowrap">{entry.music.name}</Text>
            </MarqueeText>
            <MarqueeText>
              <Text fontSize="sm" color="text.2" whiteSpace="nowrap">{entry.music.artists.join(' / ')}</Text>
            </MarqueeText>
            <Text fontSize="xs" fontStyle="italic" color="text.2">由 {entry.enqueuerName} 点播</Text>
          </Box>
          <Button
            size="sm"
            onClick={() => handleReplay(entry.music, entry.apiName)}
            alignSelf={{base: "flex-end", md: "center"}}
          >
            重新播放
          </Button>
        </Flex>
      </ListItem>
    );
  };


  return (
    <Stack spacing={4} mt={4}>
      <Text fontSize="2xl" fontWeight="bold">播放历史</Text>
      <Divider />
      <Box
        ref={listContainerRef}
        borderWidth="1px"
        borderRadius="lg"
        height={{ base: '60vh', md: '70vh' }}
        width="100%"
      >
        <Skeleton isLoaded={!isLoading} height="100%">
          {history.length > 0 ? (
            <FixedSizeList
              height={listHeight}
              itemCount={history.length}
              itemSize={itemSize ?? 120}
              width="100%"
              innerElementType={List}
            >
              {Row}
            </FixedSizeList>
          ) : (
             <Box p={4}>
                <Text>还没有播放历史哦，快去点歌吧！</Text>
             </Box>
          )}
        </Skeleton>
      </Box>
    </Stack>
  );
});

PlayHistory.displayName = 'PlayHistory';

