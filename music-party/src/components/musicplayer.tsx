import {
  Flex,
  Icon,
  IconButton,
  Progress,
  Text,
  Tooltip,
  Stack,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Box,
} from "@chakra-ui/react";
import { ArrowRightIcon } from "@chakra-ui/icons";
import React from "react";

// [修改] 更新props接口，加入音量控制相关的属性
export const MusicPlayer = (props: {
  time: number;
  length: number;
  nextClick: () => void;
  reset: () => void;
  volumeValue: number; // 滑块的当前值 (0-100)
  onVolumeChange: (value: number) => void; // 滑块变化时的回调
  dbText: string; // 用于显示的dB文本
}) => {
  const formatTime = (seconds: number) => {
    const floorSeconds = Math.floor(seconds);
    if (isNaN(floorSeconds) || floorSeconds < 0) return '0:00';
    const min = Math.floor(floorSeconds / 60);
    const sec = floorSeconds % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    // 使用Stack进行垂直布局，以容纳新的音量条
    <Stack spacing={3}>
      <Flex flexDirection={"row"} alignItems={"center"}>
        <Progress flex={12} height={"32px"} max={props.length} value={props.time} />
        <Text flex={2} textAlign={"center"} fontFamily="monospace">
            {formatTime(props.time)} / {formatTime(props.length)}
        </Text>
        <Tooltip hasArrow label="同步播放状态">
          <IconButton
            flex={1}
            aria-label={"Reset"}
            mr={2}
            icon={
              <Icon viewBox="0 0 1024 1024">
                <path
                  d="M128 138.666667c0-47.232 33.322667-66.666667 74.176-43.562667l663.146667 374.954667c40.96 23.168 40.853333 60.8 0 83.882666L202.176 928.896C161.216 952.064 128 932.565333 128 885.333333v-746.666666z"
                  fill="currentColor"
                  p-id="2949"
                ></path>
              </Icon>
            }
            onClick={props.reset}
          />
        </Tooltip>
        <Tooltip hasArrow label={"切歌"}>
          <IconButton
            flex={1}
            icon={<ArrowRightIcon />}
            aria-label={"切歌"}
            onClick={props.nextClick}
          />
        </Tooltip>
      </Flex>
      
      {/* [新增] 音量控制条的Flex容器 
        这里实现了您要求的响应式布局：
        - base: 移动端，宽度为95%
        - md: PC端，宽度为60%
        您可以根据需要调整这些值
      */}
      <Flex 
        flexDirection="row" 
        alignItems="center" 
        w={{ base: '95%', md: '50%' }} // 响应式宽度
        alignSelf="left"  //"center" // 居中显示
      >
        {/* [修正] 彻底移除 react-icons 依赖，使用内联SVG Path创建图标，杜绝类型错误 */}
        <Icon viewBox="0 0 24 24" mr={3} boxSize={5} color="text.2">
          {props.volumeValue === 0 && (
            // 静音图标 SVG Path
            <path fill="currentColor" d="M3.63 3.63a.996.996 0 0 0 0 1.41L7.29 8.7 7 9a1 1 0 0 0 1 1v2a1 1 0 0 0 1 1h2l5 5v-4.29l3.66 3.66a.996.996 0 1 0 1.41-1.41L5.05 3.63a.996.996 0 0 0-1.42 0zM16 12V6a1 1 0 0 0-1-1h-2a1 1 0 0 0-.71.29L9.83 7.76 16 14.05V12z" />
          )}
          {props.volumeValue > 0 && props.volumeValue < 50 && (
            // 小声图标 SVG Path
            <path fill="currentColor" d="M16 6a1 1 0 0 0-1-1h-2a1 1 0 0 0-.71.29L8.54 9H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3.54l3.75 3.71A1 1 0 0 0 13 19h2a1 1 0 0 0 1-1V6zm-1.72 6a3.46 3.46 0 0 1-1.55.45A1 1 0 0 0 12 13.5a3.49 3.49 0 0 1 0-7 1 1 0 0 0 .73-1.89 5.5 5.5 0 0 0-2.45 10.18A1 1 0 0 0 11 15.5a3.5 3.5 0 0 1 3.28-3.5z" />
          )}
          {props.volumeValue >= 50 && (
            // 大声图标 SVG Path
            <path fill="currentColor" d="M21.12 12a9.2 9.2 0 0 0-2.35-6.13 1 1 0 1 0-1.54 1.28A7.2 7.2 0 0 1 19.2 12a7.2 7.2 0 0 1-1.94 4.85 1 1 0 0 0 .14 1.41.93.93 0 0 0 .55.2.94.94 0 0 0 .81-.41A9.2 9.2 0 0 0 21.12 12zM16 17.64V6.36a1 1 0 0 0-1-1h-2a1 1 0 0 0-.71.29L8.54 9H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3.54l3.75 3.71A1 1 0 0 0 13 19h2a1 1 0 0 0 1-1.64z" />
          )}
        </Icon>
        <Slider
          aria-label='volume-slider'
          value={props.volumeValue}
          onChange={props.onVolumeChange}
          min={0}
          max={100} // 滑块的值范围为0-100，便于进行线性和对数转换
          step={1}
        >
          <SliderTrack bg="bg.2">
            <SliderFilledTrack bg="text.3" />
          </SliderTrack>
          <SliderThumb />
        </Slider>
        <Text
          ml={4}
          fontFamily="monospace"
          fontSize="sm"
          color="text.2"
          w="80px" // 固定宽度防止布局跳动
          textAlign="right"
        >
          {props.dbText}
        </Text>
      </Flex>
    </Stack>
  );
};

