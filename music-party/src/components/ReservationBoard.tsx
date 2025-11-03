import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Stack,
  Text,
  Textarea,
  useDisclosure,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
} from '@chakra-ui/react';
import {
  Connection,
  RecentVisitor,
  ReservationConfig,
  ReservationCreationPayload,
  ReservationStatus,
  ReservationRoom,
} from '../api/musichub';

const statusLabelMap: Record<string, string> = {
  Upcoming: '未开始',
  Ongoing: '进行中',
  Ended: '已结束',
};

const DEFAULT_MAX_ADVANCE_HOURS = 72;

const formatNowLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const getMinStartLocalString = (baseTimestamp: number) => {
  const minDate = new Date(baseTimestamp + 10 * 60 * 1000);
  minDate.setSeconds(0, 0);
  const tzOffset = minDate.getTimezoneOffset() * 60000;
  return new Date(minDate.getTime() - tzOffset).toISOString().slice(0, 16);
};

const getMaxStartLocalString = (baseTimestamp: number, maxAdvanceHours: number) => {
  const maxDate = new Date(baseTimestamp + maxAdvanceHours * 60 * 60 * 1000);
  maxDate.setSeconds(0, 0);
  const tzOffset = maxDate.getTimezoneOffset() * 60000;
  return new Date(maxDate.getTime() - tzOffset).toISOString().slice(0, 16);
};

const formatDateRange = (room: ReservationRoom) => {
  const start = new Date(room.startTimeUtc);
  const end = new Date(start.getTime() + room.durationMinutes * 60000);
  const formatOptions: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  return `${start.toLocaleString('zh-CN', formatOptions)} - ${end.toLocaleString('zh-CN', formatOptions)}`;
};

const formatRelativeTime = (isoString: string) => {
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs <= 0) return '刚刚';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
};

interface ReservationBoardProps {
  conn?: Connection;
  reservations: ReservationRoom[];
  config: ReservationConfig;
  currentUserId: string;
  recentVisitors: RecentVisitor[];
}

export const ReservationBoard: React.FC<ReservationBoardProps> = ({
  conn,
  reservations,
  config,
  currentUserId,
  recentVisitors,
}) => {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [startAt, setStartAt] = useState('');
  const [duration, setDuration] = useState('60');
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [processingRoomId, setProcessingRoomId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const {
    isOpen: isCreateModalOpen,
    onOpen: onCreateModalOpen,
    onClose: onCreateModalClose,
  } = useDisclosure();

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const effectiveMaxAdvanceHours = config.maxAdvanceHours ?? DEFAULT_MAX_ADVANCE_HOURS;

  const minStart = useMemo(() => getMinStartLocalString(nowTick), [nowTick]);
  const maxStart = useMemo(
    () => getMaxStartLocalString(nowTick, effectiveMaxAdvanceHours),
    [nowTick, effectiveMaxAdvanceHours]
  );

  const nowLabel = useMemo(() => formatNowLabel(nowTick), [nowTick]);

  const reservationsWithStatus = useMemo(() => {
    return reservations.map((room) => {
      const start = new Date(room.startTimeUtc).getTime();
      const end = start + room.durationMinutes * 60000;
      const derivedStatus: ReservationStatus =
        nowTick < start ? 'Upcoming' : nowTick <= end ? 'Ongoing' : 'Ended';

      if (room.status === derivedStatus) {
        return room;
      }

      return { ...room, status: derivedStatus };
    });
  }, [reservations, nowTick]);

  const hostCount = useMemo(() => {
    if (!currentUserId) return 0;
    return reservationsWithStatus.filter((room) => room.host.id === currentUserId && room.status !== 'Ended').length;
  }, [reservationsWithStatus, currentUserId]);

  const isHostLimitReached = hostCount >= config.maxOwnedRooms;

  const handleCreate = async () => {
    if (!conn) return;
    const trimmedTitle = title.trim();
    const trimmedDetail = detail.trim();

    if (!trimmedTitle) {
      toast({ title: '提示', description: '标题不能为空。', status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
      return;
    }

    if (!startAt) {
      toast({ title: '提示', description: '请选择预约开始时间。', status: 'info', duration: 3000, isClosable: true, position: 'bottom' });
      return;
    }

    const parsedStart = new Date(startAt);
    if (Number.isNaN(parsedStart.getTime())) {
      toast({ title: '提示', description: '无效的开始时间。', status: 'warning', duration: 3000, isClosable: true, position: 'bottom' });
      return;
    }

    const now = new Date();
    if (parsedStart.getTime() < now.getTime() + 10 * 60 * 1000) {
      toast({ title: '提示', description: '开始时间需要晚于当前时间 10 分钟。', status: 'warning', duration: 3000, isClosable: true, position: 'bottom' });
      return;
    }

    const maxAdvanceMs = effectiveMaxAdvanceHours * 60 * 60 * 1000;
    if (parsedStart.getTime() > now.getTime() + maxAdvanceMs) {
      toast({
        title: '提示',
        description: `开始时间最多只能晚于当前时间 ${effectiveMaxAdvanceHours} 小时。`,
        status: 'warning',
        duration: 3000,
        isClosable: true,
        position: 'bottom',
      });
      return;
    }

    const durationNumber = Number(duration);
    if (!Number.isFinite(durationNumber) || durationNumber <= 0) {
      toast({ title: '提示', description: '请输入有效的持续时间。', status: 'warning', duration: 3000, isClosable: true, position: 'bottom' });
      return;
    }

    if (durationNumber > config.maxDurationMinutes) {
      toast({
        title: '提示',
        description: `持续时间不能超过 ${config.maxDurationMinutes} 分钟。`,
        status: 'warning',
        duration: 3000,
        isClosable: true,
        position: 'bottom',
      });
      return;
    }

    if (isHostLimitReached) {
      toast({ title: '提示', description: '您拥有的预约已达上限。', status: 'warning', duration: 3000, isClosable: true, position: 'bottom' });
      return;
    }

    const payload: ReservationCreationPayload = {
      title: trimmedTitle,
      detail: trimmedDetail,
      startTimeUtc: parsedStart.toISOString(),
      durationMinutes: durationNumber,
    };

    try {
      setIsCreating(true);
      await conn.createReservation(payload);
      setTitle('');
      setDetail('');
      setStartAt('');
      setDuration('60');
      onCreateModalClose();
      toast({ title: '成功', description: '预约已创建。', status: 'success', duration: 3000, isClosable: true, position: 'bottom' });
    } catch (error: any) {
      const message = error?.message ?? '创建预约失败，请稍后重试。';
      toast({ title: '错误', description: message, status: 'error', duration: 4000, isClosable: true, position: 'bottom' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async (roomId: string) => {
    if (!conn) return;
    try {
      setProcessingRoomId(roomId);
      await conn.joinReservation(roomId);
      toast({ title: '成功', description: '已加入预约。', status: 'success', duration: 2500, isClosable: true, position: 'bottom' });
    } catch (error: any) {
      const message = error?.message ?? '加入预约失败，请稍后重试。';
      toast({ title: '错误', description: message, status: 'error', duration: 4000, isClosable: true, position: 'bottom' });
    } finally {
      setProcessingRoomId(null);
    }
  };

  const handleLeave = async (roomId: string) => {
    if (!conn) return;
    try {
      setProcessingRoomId(roomId);
      await conn.leaveReservation(roomId);
      toast({ title: '提示', description: '已离开预约。', status: 'info', duration: 2500, isClosable: true, position: 'bottom' });
    } catch (error: any) {
      const message = error?.message ?? '离开预约失败，请稍后重试。';
      toast({ title: '错误', description: message, status: 'error', duration: 4000, isClosable: true, position: 'bottom' });
    } finally {
      setProcessingRoomId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <Heading size="md">听歌预定</Heading>
        <Text fontSize="sm" color="text.2" mt={2}>
          预约功能仅仅为了用户间约定时间，增加相遇的概率，提供网站的约定平台，无其他用途。
        </Text>
        <Text fontSize="sm" color="text.2" mt={2}>
          当前你的房主数量：{hostCount} / {config.maxOwnedRooms}，大于等于 {config.maxRooms}个则不能新建预约 。
        </Text>
      </CardHeader>
      <CardBody>
        <Stack spacing={5}>
          <Flex
            direction={{ base: 'column', md: 'row' }}
            align={{ base: 'stretch', md: 'center' }}
            justify="space-between"
            gap={3}
          >
            <Button
              onClick={onCreateModalOpen}
              isDisabled={!conn || isHostLimitReached}
              alignSelf={{ base: 'stretch', md: 'flex-start' }}
            >
              创建预约
            </Button>
            {isHostLimitReached && (
              <Text fontSize="sm" color="text.2">
                您作为房主的预约已达上限，请先交接或等待预约结束。
              </Text>
            )}
          </Flex>

          <Divider />

          <Stack spacing={4}>
            {reservationsWithStatus.length === 0 && (
              <Text color="text.2">还没有任何预约，抢先创建一个吧！</Text>
            )}

            {reservationsWithStatus.map((room) => {
              const isParticipant = room.participants.some((p) => p.id === currentUserId);
              const isHost = room.host.id === currentUserId;
              const isEnded = room.status === 'Ended';
              const leaveDisabledReason = room.status === 'Ongoing'
                ? '进行中的预约暂不支持离开。'
                : room.status === 'Ended'
                  ? '已结束的预约无法变更成员。'
                  : undefined;
              const participantNames = room.participants.map((p) => p.name).join('、');

              return (
                <Box
                  key={room.id}
                  borderWidth="1px"
                  borderRadius="lg"
                  p={4}
                  bg="bg.3"
                  opacity={isEnded ? 0.6 : 1}
                >
                  <Stack spacing={2}>
                    <Flex justify="space-between" align={{ base: 'flex-start', md: 'center' }} direction={{ base: 'column', md: 'row' }}>
                      <Heading size="sm">{room.title}</Heading>
                      {/*<Text fontSize="sm" color="text.2">
                        当前时间 {nowLabel}，状态：{statusLabelMap[room.status] ?? room.status}
                      </Text> */}
                    </Flex>
                    <Text fontSize="sm" color="text.2">
                      时间段：{formatDateRange(room)} 当前时间 {nowLabel}，状态：{statusLabelMap[room.status] ?? room.status}
                    </Text>
                    <Text fontSize="sm">
                      房主：{room.host.name}{isHost ? '（你）' : ''} 参与者：{participantNames || '暂无参与者'}
                    </Text>
                    {room.detail && (
                      <>
                        <Button
                          size="xs"
                          alignSelf="flex-start"
                          bg="bg.2"
                          color="text.1"
                          _hover={{ bg: 'bg.2' }}
                          _active={{ bg: 'bg.2' }}
                          onClick={() => setExpandedRoom((prev) => (prev === room.id ? null : room.id))}
                        >
                          {expandedRoom === room.id ? '收起详细' : '查看详细'}
                        </Button>
                        {expandedRoom === room.id && (
                          <Box p={3} borderRadius="md" bg="bg.2">
                            <Text fontSize="sm" color="text.2" whiteSpace="pre-wrap">
                              {room.detail}
                            </Text>
                          </Box>
                        )}
                      </>
                    )}

                    <Flex gap={3} wrap="wrap" mt={1}>
                      {!isParticipant && !isEnded && (
                        <Button
                          size="sm"
                          onClick={() => handleJoin(room.id)}
                          isLoading={processingRoomId === room.id}
                          isDisabled={!conn}
                        >
                          加入预约
                        </Button>
                      )}
                      {isParticipant && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleLeave(room.id)}
                          isLoading={processingRoomId === room.id}
                          isDisabled={!conn || room.status !== 'Upcoming'}
                          title={leaveDisabledReason}
                        >
                          离开预约
                        </Button>
                      )}
                    </Flex>
                  </Stack>
                </Box>
              );
            })}
          </Stack>

          {recentVisitors.length > 0 && (
            <Box borderTopWidth="1px" pt={3} mt={2}>
              <Text fontSize="sm" color="text.2">
                来过的用户（24小时内）：
                {recentVisitors
                  .map((visitor) => `${visitor.name}（${formatRelativeTime(visitor.lastSeenUtc)}）`)
                  .join('、')}
              </Text>
            </Box>
          )}
        </Stack>
      </CardBody>
      <Modal
        isOpen={isCreateModalOpen}
        onClose={isCreating ? () => undefined : onCreateModalClose}
        isCentered
        closeOnOverlayClick={!isCreating}
      >
        <ModalOverlay />
        <ModalContent bg="bg.3">
          <ModalHeader>创建预约</ModalHeader>
          <ModalCloseButton isDisabled={isCreating} />
          <ModalBody>
            <Stack spacing={3}>
              <Input
                placeholder="预约标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                color="text.1"
              />
              <Textarea
                placeholder="预约详情（可选）"
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                rows={3}
                color="text.1"
              />
              <Flex direction={{ base: 'column', md: 'row' }} gap={3}>
                <FormControl flex={1}>
                  <FormLabel mb={1} color="text.2" fontSize="sm">
                    预约开始时间
                  </FormLabel>
                  <Input
                    type="datetime-local"
                    value={startAt}
                    onChange={(event) => setStartAt(event.target.value)}
                    min={minStart}
                    max={maxStart}
                    color="text.1"
                    bg="bg.2"
                    sx={{
                      '&::-webkit-calendar-picker-indicator': {
                        filter: 'invert(0.8)',
                        cursor: 'pointer',
                        transform: 'scale(1.2)',
                        transformOrigin: 'center',
                      },
                    }}
                  />
                </FormControl>
                <FormControl flex={{ base: 1, md: '0 0 200px' }}>
                  <FormLabel mb={1} color="text.2" fontSize="sm">
                    持续时间（分钟）
                  </FormLabel>
                  <Input
                    type="number"
                    min={1}
                    max={config.maxDurationMinutes}
                    value={duration}
                    onChange={(event) => setDuration(event.target.value.replace(/[^0-9]/g, ''))}
                    placeholder={`持续分钟数 (≤ ${config.maxDurationMinutes})`}
                    color="text.1"
                  />
                </FormControl>
              </Flex>
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onCreateModalClose} isDisabled={isCreating}>
              取消
            </Button>
            <Button
              onClick={handleCreate}
              isLoading={isCreating}
              isDisabled={!conn || isHostLimitReached}
            >
              创建预约
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
};

ReservationBoard.displayName = 'ReservationBoard';
