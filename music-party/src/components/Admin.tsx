import React from 'react';
import {
    Text, Button, Card, CardBody, Heading, Stack, Divider, useToast, Menu, MenuButton,
    MenuList, MenuItem, Flex, Textarea, useDisclosure, Modal, ModalOverlay, ModalContent,
    ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Input, Box
} from '@chakra-ui/react';
import { ChevronDownIcon } from '@chakra-ui/icons';
import { Connection } from '../api/musichub';
import { setCredential } from '../api/api';

interface AdminPanelProps {
    conn?: Connection;
}

const UpdateCredentialForm = () => {
    const [apiName, setApiName] = React.useState('NeteaseCloudMusic');
    const apiDisplayNames: { [key: string]: string } = {
        NeteaseCloudMusic: '网易云 (Cookie)',
        QQMusic: 'QQ音乐 (Cookie)',
        Bilibili: 'Bilibili (SESSDATA)',
    };
    const [newValue, setNewValue] = React.useState('');
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const t = useToast();

    const handleSubmit = async () => {
        if (!newValue.trim()) {
            t({ title: '错误', description: '凭据内容不能为空', status: 'error', isClosable: true, position: 'top' });
            return;
        }
        setIsSubmitting(true);
        try {
            await setCredential(apiName, newValue.trim());
            t({ title: '成功', description: `${apiDisplayNames[apiName]} 的凭据已成功更新。`, status: 'success', isClosable: true, position: 'top' });
            setNewValue('');
        } catch (e: any) {
            t({ title: '更新失败', description: e.message, status: 'error', isClosable: true, position: 'top' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Stack spacing={4} align="start" w="100%">
            <Heading size="md">凭据管理</Heading>
            <Text fontSize="sm" color="text.2">
                在此更新各平台API的凭据（如 Cookie, SESSDATA 等）。更新成功后会自动保存，服务器重启后依然有效。
            </Text>
            <Flex flexDirection={'row'} alignItems={'center'} w="100%">
                <Text mr={4}>选择平台</Text>
                <Menu>
                    <MenuButton
                        as={Button}
                        rightIcon={<ChevronDownIcon />}
                        ml={2}
                        flex={1}
                        textAlign="left"
                        fontWeight="normal"
                        bg="bg.3"
                        color="text.2"
                        _hover={{ bg: 'bg.2' }}
                        _active={{ bg: 'bg.2' }}
                    >
                        {apiDisplayNames[apiName] || '...'}
                    </MenuButton>
                    <MenuList>
                        {Object.entries(apiDisplayNames).map(([key, value]) => (
                            <MenuItem
                                key={key}
                                onClick={() => setApiName(key)}
                            >
                                {value}
                            </MenuItem>
                        ))}
                    </MenuList>
                </Menu>
            </Flex>
            <Textarea
                placeholder="在此处粘贴新的凭据内容"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                w="full"
                minH="120px"
            />
            <Button onClick={handleSubmit} colorScheme="teal" isLoading={isSubmitting}>
                更新凭据
            </Button>
            <Text fontSize="xs" color="text.2" pt={2}>
                <b>关于酷狗:</b> 酷狗的凭据(Token)需要通过手机验证码在服务器后台首次运行时生成，无法在此处直接更新。如需更新，请联系网站部署者。
            </Text>
        </Stack>
    );
};

// [修改] 根据您的新方案，简化歌单生成器组件
const PlaylistGenerator = ({ conn }: AdminPanelProps) => {
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [customCookie, setCustomCookie] = React.useState('');
    const [startTime, setStartTime] = React.useState('');
    const [endTime, setEndTime] = React.useState('');
    const [isGenerating, setIsGenerating] = React.useState(false);
    const t = useToast();

    const handleGenerate = async () => {
        if (!startTime || !endTime) {
            t({ title: '错误', description: '请选择开始和结束时间', status: 'error', duration: 3000, isClosable: true, position: 'top' });
            return;
        }
        if (!customCookie.trim()) {
            t({ title: '错误', description: '请填写您的网易云音乐Cookie', status: 'error', duration: 3000, isClosable: true, position: 'top' });
            return;
        }

        setIsGenerating(true);
        try {
            const result = await conn?.generatePlaylistFromHistory(
                customCookie,
                startTime,
                endTime
            );
            t({ title: '操作结果', description: result, status: result?.startsWith('错误') ? 'error' : 'success', duration: 9000, isClosable: true, position: 'top' });
            onClose();
        } catch (e: any) {
            t({ title: '执行失败', description: e.message, status: 'error', duration: 5000, isClosable: true, position: 'top' });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <>
            <Stack spacing={4} align="start" w="100%">
                <Heading size="md">从播放历史生成歌单</Heading>
                <Text fontSize="sm" color="text.2">
                    此功能将抓取指定时间范围内的网易云播放历史，并自动在您的网易云音乐账户中创建一个新的歌单。
                </Text>
                <Button onClick={onOpen} w="full">
                    打开生成器
                </Button>
            </Stack>

            <Modal isOpen={isOpen} onClose={onClose} isCentered>
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>生成网易云歌单</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        <Stack spacing={4}>
                            <Text fontSize="sm" color="text.2">
                                歌单名称将自动生成。此操作需要您提供一个有效的网易云音乐Cookie，并将请求发送至一个独立的API服务器实例(默认2336端口)。
                            </Text>
                            <Box>
                                <Text mb="8px" fontWeight="medium">您的网易云音乐 Cookie</Text>
                                <Textarea
                                    placeholder="请在此处粘贴您的Cookie"
                                    value={customCookie}
                                    onChange={(e) => setCustomCookie(e.target.value)}
                                />
                            </Box>
                            <Box>
                                <Text mb="8px" fontWeight="medium">开始时间 (UTC+8)</Text>
                                <Input
                                    type="datetime-local"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                />
                            </Box>
                            <Box>
                                <Text mb="8px" fontWeight="medium">结束时间 (UTC+8)</Text>
                                <Input
                                    type="datetime-local"
                                    value={endTime}
                                    onChange={(e) => setEndTime(e.target.value)}
                                />
                            </Box>
                        </Stack>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant='ghost' mr={3} onClick={onClose}>
                            取消
                        </Button>
                        <Button
                            colorScheme='blue'
                            onClick={handleGenerate}
                            isLoading={isGenerating}
                        >
                            开始生成
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    )
}

export const AdminPanel = ({ conn }: AdminPanelProps) => {
    const t = useToast();
    return (
        <Card minH={{ base: '60vh', md: '70vh' }}>
            <CardBody>
                <Heading size="lg" mb={6}>管理员面板</Heading>
                
                <PlaylistGenerator conn={conn} />
                
                <Divider my={6} />

                <Stack spacing={4} align="start">
                    <Heading size="md">服务器管理</Heading>
                    <Text fontSize="sm" color="text.2">
                        点击下面的按钮将会执行服务器上的 <code>#test.bat</code> 脚本来重启服务。<br />
                        点击后，您与服务器的连接将立即断开。请<b>等待大约 5-10 秒</b>后，<b>手动刷新</b>此页面以重新连接。
                    </Text>
                    <Button
                        colorScheme="red"
                        onClick={() => {
                            if (window.confirm("您确定要重启服务器吗？\n\n此操作将中断所有在线用户的连接。")) {
                                conn?.adminRestartServer().catch(err => {
                                    t({ title: '错误', description: `重启命令发送失败: ${err.message}`, status: 'error', duration: 5000, isClosable: true, position: 'top' });
                                });
                                t({ title: '指令已发送', description: '服务器正在重启，请稍后刷新页面。', status: 'warning', duration: 5000, isClosable: true, position: 'top' });
                            }
                        }}
                    >
                        重启服务器
                    </Button>
                </Stack>

                <Divider my={6} />

                <UpdateCredentialForm />
            </CardBody>
        </Card>
    );
};

