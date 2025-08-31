import { TriangleUpIcon } from '@chakra-ui/icons';
import {
  Text,
  Card,
  CardHeader,
  Heading,
  CardBody,
  Box,
  Highlight,
  Flex,
  Tooltip,
  IconButton,
  Stack,
  Grid,
  GridItem,
} from '@chakra-ui/react';
import { MusicOrderAction } from '../api/musichub';
import { MarqueeText } from './MarqueeText';

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
        {/* 1. 使用 Stack 替代 OrderedList 来创建列表 */}
        <Stack spacing={0} divider={<Box borderBottomWidth="1px" borderColor="bg.2" />}>
          {queue.length > 0 ? (
            queue.map((v, index) => (
              <Flex key={v.actionId} align="center" py={3}>
                {/* 2. 手动添加序号 */}
                <Text as="span" mr={4} fontSize="lg">{index + 1}.</Text>

                {/* 3. 这是核心修复：使用 Grid 布局来精确控制尺寸 */}
                <Grid
                  templateColumns="1fr auto" // 文本部分占据所有可用空间，按钮自动宽度
                  gap={4}
                  alignItems="center"
                  flex={1}
                  overflow="hidden" // 关键：让Grid本身处理溢出
                >
                  {/* 4. GridItem 成为跑马灯的可靠容器 */}
                  <GridItem overflow="hidden" minWidth={0}>
                    <MarqueeText>
                      <Text fontSize="lg" fontWeight="bold" whiteSpace="nowrap">
                        {v.music.name}
                      </Text>
                    </MarqueeText>
                    <MarqueeText>
                      <Text fontSize="md" color="text.2" whiteSpace="nowrap">
                        {v.music.artists.join(' / ')}
                      </Text>
                    </MarqueeText>
                    <Text fontSize="sm" fontStyle="italic" color="text.2" mt={1}>
                      由 {v.enqueuerName} 点歌
                    </Text>
                  </GridItem>

                  <GridItem>
                    {index !== 0 && (
                      <Tooltip hasArrow label={'将此歌曲置于队列顶端'}>
                        <IconButton
                          onClick={() => top(v.actionId)}
                          aria-label={'置顶'}
                          icon={<TriangleUpIcon />}
                        />
                      </Tooltip>
                    )}
                  </GridItem>
                </Grid>
              </Flex>
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
        </Stack>
      </CardBody>
    </Card>
  );
};

