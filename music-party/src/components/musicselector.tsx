import { Flex, Input, Button, useToast, Text, Menu, MenuButton, MenuList, MenuItem } from '@chakra-ui/react';
import { ChevronDownIcon } from '@chakra-ui/icons';
import { useEffect, useState, useCallback } from 'react';
import { Connection } from '../api/musichub';

export const MusicSelector = (props: { apis: string[]; conn: Connection }) => {
  const [id, setId] = useState('');
  const [apiName, setApiName] = useState('');
  const t = useToast();

  useEffect(() => {
    if (props.apis && props.apis.length > 0) {
      // 从 localStorage 读取上次选择的 apiName
      const storedApiName = localStorage.getItem('musicSelectorApiName');
      if (storedApiName && props.apis.includes(storedApiName)) {
        setApiName(storedApiName);
      } else {
        setApiName(props.apis[0]);
      }
    }
  }, [props.apis]);

  // [修改] 将点歌逻辑提取到一个可复用的函数中
  const handleEnqueue = useCallback(() => {
    if (id.trim().length > 0 && apiName) {
      props.conn
        .enqueueMusic(id, apiName)
        .then(() => {
          t({ title: '成功加入队列', status: 'success', duration: 3000, isClosable: true, position: 'bottom' });
          setId(''); // 成功后清空输入框
        })
        .catch((e) => {
          t({ title: '错误', description: `音乐 {id: ${id}} 加入队列失败`, status: 'error', duration: 5000, isClosable: true, position: 'bottom' });
          console.error(e);
        });
    }
  }, [id, apiName, props.conn, t]);

  return (
    <>
      <Flex flexDirection={'row'} alignItems={'center'} mb={4}>
        <Text>选择平台</Text>
        
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
            {apiName || '...'}
          </MenuButton>
          <MenuList>
            {props.apis.map((a) => (
              <MenuItem 
                key={a}
                  onClick={() => {
                  setApiName(a);
                  localStorage.setItem('musicSelectorApiName', a);
                }}
              >
                {a}
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
      </Flex>

      <Flex 
        flexDirection={'row'}
        alignItems={{ base: 'stretch', md: 'center' }}
      >
        <Input
          flex={1}
          type="text"
          value={id}
          placeholder="输入音乐ID或链接"
          onChange={(e) => setId(e.target.value)}
          // [修改] 添加 onKeyDown 事件处理器，监听 Enter 键
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleEnqueue();
            }
          }}
          minH={{ base: '80px', md: '60px', xl: '40px' }}
          sx={{
            position: 'relative',
            _placeholder: {
              color: 'text.2',
              position: 'absolute !important',
              top: '0 !important',
              left: '0 !important',
              lineHeight: '1.2 !important',
              whiteSpace: 'pre-wrap',
              transform: 'none !important',
              fontSize: { base: 'sm', md: 'md' }
            },
            '@media (max-width: 819px)': { minHeight: '80px' },
            '@media (min-width: 820px) and (max-width: 1799px)': { minHeight: '60px' },
            '@media (min-width: 1800px)': { minHeight: '40px', _placeholder: { whiteSpace: 'nowrap' } }
          }}
        />
        <Button
          ml={2}
          alignSelf={{ base: 'flex-end', md: 'center' }}
          minH={{ base: '80px', md: '40px' }}
          // [修改] 调用新的处理函数
          onClick={handleEnqueue}
        >
          点歌
        </Button>
      </Flex>
    </>
  );
};

