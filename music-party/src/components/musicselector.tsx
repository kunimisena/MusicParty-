import { Flex, Input, Button, useToast, Select, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { Connection } from '../api/musichub';
import { toastEnqueueOk, toastError } from '../utils/toast';

export const MusicSelector = (props: { apis: string[]; conn: Connection }) => {
  const [id, setId] = useState('');
  const [apiName, setApiName] = useState('');
  const t = useToast();
  useEffect(() => {
    setApiName(props.apis[0]);
  }, [props.apis]);
  return (
    <>
      <Flex flexDirection={'row'} alignItems={'center'} mb={4}>
        <Text>选择平台</Text>
        <Select
          ml={2}
          flex={1}
          onChange={(e) => {
            setApiName(e.target.value);
          }}
        >
          {props.apis.map((a) => {
            return (
              <option key={a} value={a}>
                {a}
              </option>
            );
          })}
        </Select>
      </Flex>

      <Flex 
        flexDirection={'row'}
        alignItems={{ base: 'stretch', md: 'center' }} // 关键修复点
      >
<Input
  flex={1}
  type="text"
  value={id}
  placeholder="输入音乐ID  示例: music.163.com/#/song?id=你要输入的 或 y.qq.com/n/ryqq/songDetail/你要输入的 或 BV号@P数（可不含@P数，P数是数字不带P字母）"
  onChange={(e) => setId(e.target.value)}
  minH={{
    base: '80px', // 手机端
    md: '60px',   // 平板端
    xl: '40px'    // 桌面端
  }}
  sx={{
    // === 核心修复配置 ===
    position: 'relative',
    _placeholder: {
      position: 'absolute !important',
      top: '0 !important',     // 占位符绝对贴顶
      left: '0 !important',
      lineHeight: '1.2 !important',
      whiteSpace: 'pre-wrap',
      transform: 'none !important',
      fontSize: { base: 'sm', md: 'md' }
    },
    _input: {
      position: 'absolute !important',
      top: '0 !important',     // 输入文本绝对贴顶
      left: '0 !important',
      minH: 'inherit !important',
      lineHeight: '1.2 !important',
      width: '100% !important',
      padding: '0 !important'
    },
    // === 显式断点控制 ===
    '@media (max-width: 819px)': { 
      minHeight: '80px',
      _input: { height: '80px !important' }
    },
    '@media (min-width: 820px) and (max-width: 1799px)': {
      minHeight: '60px',
      _input: { height: '60px !important' }
    },
    '@media (min-width: 1800px)': {
      minHeight: '40px',
      _input: { height: '40px !important' },
      _placeholder: { whiteSpace: 'nowrap' }
    }
  }}
/>
        <Button
          ml={2}
          alignSelf={{ base: 'flex-end', md: 'center' }}
          minH={{ base: '80px', md: '40px' }}
          onClick={() => {
            if (id.length > 0) {
              const formattedId =
                apiName.includes('QQMusic') ? `${id},${id}` : id;
        
              props.conn
                .enqueueMusic(formattedId, apiName)
                .then(() => {
                  toastEnqueueOk(t);
                  setId('');
                })
                .catch((e) => {
                  toastError(t, `音乐 {id: ${formattedId}} 加入队列失败`);
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
