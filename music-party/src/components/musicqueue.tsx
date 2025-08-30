import { TriangleUpIcon } from '@chakra-ui/icons';
import {
  Text,
  Card,
  CardHeader,
  Heading,
  CardBody,
  OrderedList,
  ListItem,
  Box,
  Highlight,
  Flex,
  Tooltip,
  IconButton,
} from '@chakra-ui/react';
import { MusicOrderAction } from '../api/musichub';

interface MusicQueueProps {
  queue: MusicOrderAction[];
  top: (actionId: string) => void;
}

export const MusicQueue = (props: MusicQueueProps) => {
  const { queue, top } = props;
  return (
    <Card mt={4}>
      <CardHeader>
        <Heading size={'lg'}>播放队列</Heading>
      </CardHeader>
      <CardBody>
        <OrderedList>
          {queue.length > 0 ? (
            queue.map((v) => (
              <ListItem key={v.actionId} fontSize={'lg'}>
                <Flex>
                  <Box flex={1}>
                    {v.music.name} - {v.music.artists}
                    <Text fontSize={'sm'} fontStyle={'italic'} color="text.2">
                      由 {v.enqueuerName} 点歌
                    </Text>
                  </Box>
                  {queue.findIndex((x) => x.actionId === v.actionId) !==
                    0 && (
                    <Tooltip hasArrow label={'将此歌曲至于队列顶端'}>
                      <IconButton
                        onClick={() => top(v.actionId)}
                        aria-label={'置顶'}
                        icon={<TriangleUpIcon />}
                      />
                    </Tooltip>
                  )}
                </Flex>
              </ListItem>
            ))
          ) : (
            <Text size={'md'}>
              <Highlight
                query={'点歌'}
                styles={{ px: '2', py: '1', rounded: 'full', bg: 'teal.100' }}
              >
                播放队列为空，请随意点歌吧~
              </Highlight>
            </Text>
          )}
        </OrderedList>
      </CardBody>
    </Card>
  );
};

