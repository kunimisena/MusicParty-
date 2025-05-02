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
          type={'text'}
          value={id}
          placeholder={'输入音乐ID (示例: music.163.com/#/song?id=你要输入的 或 y.qq.com/n/ryqq/songDetail/你要输入的 或BV号@P数（可不含@P数）)'}
          onChange={(e) => setId(e.target.value)}
          minH={{ base: '80px', md: '40px' }} // 增加自适应高度
          sx={{
            '&::placeholder': {
              whiteSpace: 'pre-wrap',
              // ...其他样式保持不变
            },
            // 新增输入框容器样式
            _input: {
              minH: 'inherit !important', // 强制继承外层高度
              alignItems: 'flex-start',   // 多行文本顶部对齐
              py: { base: 2, md: 1 }      // 垂直内间距自适应
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
