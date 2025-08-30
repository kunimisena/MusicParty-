import { Flex, Input, Button, useToast, Text, Menu, MenuButton, MenuList, MenuItem } from '@chakra-ui/react';
import { ChevronDownIcon } from '@chakra-ui/icons';
import { useEffect, useState } from 'react';
import { Connection } from '../api/musichub';
import { toastEnqueueOk, toastError } from '../utils/toast';

export const MusicSelector = (props: { apis: string[]; conn: Connection }) => {
  const [id, setId] = useState('');
  const [apiName, setApiName] = useState('');
  const t = useToast();

  useEffect(() => {
    if (props.apis && props.apis.length > 0) {
      setApiName(props.apis[0]);
    }
  }, [props.apis]);

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
            color="text.2" // [核心修复] 为按钮本身指定二级字体颜色
            _hover={{ bg: 'bg.2' }}
            _active={{ bg: 'bg.2' }}
          >
            {apiName || '...'}
          </MenuButton>
          <MenuList>
            {props.apis.map((a) => (
              <MenuItem 
                key={a} 
                onClick={() => setApiName(a)}
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
          onClick={() => {
            if (id.length > 0 && apiName) {
              props.conn
                .enqueueMusic(id, apiName)
                .then(() => {
                  toastEnqueueOk(t);
                  setId('');
                })
                .catch((e) => {
                  toastError(t, `音乐 {id: ${id}} 加入队列失败`);
                  console.error(e);
                });
            }
          }}
        >
          点歌
        </Button>
      </Flex>
    </>
  );
};
