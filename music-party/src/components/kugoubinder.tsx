import {
  Text,
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  Input,
  List,
  ListItem,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import React, { useState } from 'react';
// 确保从正确的路径导入，这里假设 api.ts 在 '../api/api'
import { bindAccount, MusicServiceUser, searchUsers } from '../api/api'; 

export const KuGouBinder = (props: {}) => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const btnRef = React.useRef<any>();

  // users 状态现在预期只包含一个用户（如果ID有效）或为空
  const [users, setUsers] = useState<MusicServiceUser[]>([]);
  // keyword 现在存储用户输入的酷狗用户ID
  const [keyword, setKeyword] = useState('');

  const t = useToast();

  const handleSearchOrValidate = async () => {
    if (keyword.trim() === '') {
      t({
        title: '输入错误',
        description: '请输入歌单名称',
        status: 'warning',
        duration: 3000,
        isClosable: true,
        position: 'top-right',
      });
      return;
    }
    try {
      // 调用 searchUsers，后端会验证ID格式并返回包含单个用户的数组
      // 或者如果格式错误，后端会抛出异常，前端的 searchUsers 应该能捕获并重新抛出或返回错误信息
      const foundUsers = await searchUsers(keyword, 'KuGouMusic');
      setUsers(foundUsers); // 如果ID格式正确，这里会设置一个包含单个用户的数组
      if (foundUsers.length === 0) { // 理论上后端验证格式后总会返回一个用户，除非有其他错误
        t({
          title: '未找到歌单',
          description: '请检查你输入的酷狗歌单名称是否正确。',
          status: 'info',
          duration: 5000,
          isClosable: true,
          position: 'top-right',
        });
      }
    } catch (error: any) {
      console.error("搜索/验证歌单名称失败:", error);
      setUsers([]); // 清空用户列表
      t({
        title: '验证失败',
        description: error.message || '无法验证歌单名称，请检查输入或稍后再试。',
        status: 'error',
        duration: 5000,
        isClosable: true,
        position: 'top-right',
      });
    }
  };

  const handleBindAccount = async (identifier: string) => {
    try {
      await bindAccount(identifier, 'KuGouMusic');
      t({
        title: '绑定歌单！',
        description: '酷狗歌单内容已成功绑定。',
        status: 'success',
        duration: 5000,
        isClosable: true,
        position: 'top-right',
      });
      // 绑定成功后刷新页面或进行其他操作
      window.location.href = '/'; 
    } catch (ex: any) {
      console.error("绑定歌单失败:", ex);
      t({
        title: '绑定失败',
        description: ex.message || '绑定过程中发生错误，请稍后再试。',
        status: 'error',
        duration: 5000,
        isClosable: true,
        position: 'top-right',
      });
    } finally {
      onClose(); // 关闭抽屉
      setKeyword(''); // 清空输入框
      setUsers([]); // 清空用户列表
    }
  };

  return (
    <>
      <Button ref={btnRef} colorScheme='yellow' onClick={onOpen}>
        绑定酷狗歌单名称
      </Button>
      <Drawer
        isOpen={isOpen}
        placement='left'
        onClose={() => {
          onClose();
          setKeyword(''); // 关闭时清空状态
          setUsers([]);   // 关闭时清空状态
        }}
        finalFocusRef={btnRef}
      >
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          {/* 标题根据后端逻辑调整 */}
          <DrawerHeader>加入酷狗歌单</DrawerHeader>

          <DrawerBody>
            <Flex>
              <Input
                flex={1}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder='搜索酷狗歌单名称' // 提示用户输入纯数字ID
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchOrValidate();
                  }
                }}
              />
              {/* 按钮文字可以考虑改为“验证ID”或类似 */}
              <Button
                ml={2}
                onClick={handleSearchOrValidate}
              >
                验证ID 
              </Button>
            </Flex>
            <List mt={4}> {/* 增加一点上边距 */}
              {users.map((user) => { // 如果ID有效，这里只会有一个用户
                return (
                  <ListItem key={user.identifier}>
                    <Flex paddingY={2} paddingX={0} alignItems="center"> {/* 调整内边距 */}
                      <Text flex={1} mr={2}> {/* 增加右边距 */}
                        {user.name} (ID: {user.identifier}) {/* 显示名称和ID */}
                      </Text>
                      <Button
                        colorScheme='green' // 绑定按钮使用不同颜色
                        onClick={() => handleBindAccount(user.identifier)}
                      >
                        绑定此ID
                      </Button>
                    </Flex>
                  </ListItem>
                );
              })}
            </List>
          </DrawerBody>

          <DrawerFooter>
            <Button variant='outline' mr={3} onClick={() => {
              onClose();
              setKeyword(''); // 关闭时清空状态
              setUsers([]);   // 关闭时清空状态
            }}>
              取消
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
};
