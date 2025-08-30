import {
  Button,
  Flex,
  Icon,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import { ArrowRightIcon } from "@chakra-ui/icons";
import React from "react";

// [核心修改] 这个组件现在是一个纯粹的“仪表盘”，只负责显示UI，不再包含任何播放逻辑。
export const MusicPlayer = (props: {
  // 它接收的props也变了，直接接收当前时间和总时长
  time: number;
  length: number;
  // 控制逻辑由父组件传入
  nextClick: () => void;
  reset: () => void;
}) => {
  const formatTime = (seconds: number) => {
    const floorSeconds = Math.floor(seconds);
    if (isNaN(floorSeconds) || floorSeconds < 0) return '0:00';
    const min = Math.floor(floorSeconds / 60);
    const sec = floorSeconds % 60;
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <Flex flexDirection={"row"} alignItems={"center"}>
      {/* 进度条现在直接由父组件传入的 state 控制 */}
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
  );
};

