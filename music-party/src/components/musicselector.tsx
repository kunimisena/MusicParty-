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
      const storedApiName = localStorage.getItem('musicSelectorApiName');
      if (storedApiName && props.apis.includes(storedApiName)) {
        setApiName(storedApiName);
      } else {
        setApiName(props.apis[0]);
      }
    }
  }, [props.apis]);

  const handleEnqueue = useCallback(() => {
    if (id.trim().length > 0 && apiName) {
      props.conn
        .enqueueMusic(id, apiName)
        .then(() => {
          t({ title: '成功加入队列', status: 'success', duration: 3000, isClosable: true, position: 'bottom' });
          setId(''); 
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
        alignItems={'center'} // 垂直居中对齐
      >
        {/* --- 这是核心修改点 --- */}
        {/* 移除了 minH 和 sx 属性，恢复为标准输入框 */}
        <Input
          flex={1}
          type="text"
          value={id}
          placeholder="输入音乐ID或链接"
          onChange={(e) => setId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleEnqueue();
            }
          }}
        />
        <Button
          ml={2}
          onClick={handleEnqueue}
        >
          点歌
        </Button>
      </Flex>
    </>
  );
};
