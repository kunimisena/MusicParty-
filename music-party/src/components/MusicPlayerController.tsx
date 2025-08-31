import React, { useState, useRef, useEffect } from 'react';
import { useDisclosure, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Text } from '@chakra-ui/react';
import { MusicPlayer } from './musicplayer';

// 定义组件接收的 props 接口
interface MusicPlayerControllerProps {
  src: string; // 音频源 URL
  playtime: number; // 从服务器同步的播放开始时间
  onNextClick: () => void; // “下一首”按钮的回调
  onReset: () => void; // “同步”按钮的回调
}

/**
 * 这是一个“智能”容器组件，专门负责：
 * 1. 管理 <audio> 元素的整个生命周期。
 * 2. 封装所有高频更新的状态（time, length），将“渲染风暴”隔离在此组件内部。
 * 3. 处理浏览器的自动播放策略。
 * 4. 渲染纯 UI 的 MusicPlayer 组件，向其传递所需的 props。
 */
export const MusicPlayerController = (props: MusicPlayerControllerProps) => {
  const { src, playtime, onNextClick, onReset } = props;

  // 内部状态，用于驱动 UI，不会影响外部组件
  const [length, setLength] = useState(0);
  const [time, setTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { isOpen: isAutoplayModalOpen, onOpen: onAutoplayModalOpen, onClose: onAutoplayModalClose } = useDisclosure();

  // Effect 1: 初始化和清理 <audio> 元素
  useEffect(() => {
    // 实例化 audio 元素，并保存在 ref 中，确保在组件生命周期内唯一
    const audio = new Audio();
    audioRef.current = audio;

    // --- 事件监听器 ---
    const handleDurationChange = () => {
      const duration = audio.duration;
      setLength(duration && isFinite(duration) ? duration : 0);
    };
    const handleTimeUpdate = () => {
      setTime(audio.currentTime);
    };
    const handleEnded = () => {
      console.log('Playback ended locally. Awaiting server command.');
    };

    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    
    // --- 清理函数 ---
    return () => {
      // 组件卸载时，确保停止所有事件监听并清理资源
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
    }
  }, []); // 空依赖数组，确保此 effect 只在组件挂载时运行一次

  // Effect 2: 响应外部 props 变化，控制播放逻辑
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return; // 确保 audio 元素已创建
    
    if (src === "") {
      audio.pause();
      setTime(0);
      setLength(0);
    } else {
      const isSameSongEnded = audio.currentSrc === src && audio.ended;

      if (audio.src !== src) {
        audio.src = src;
      }
      
      if (isSameSongEnded) {
        audio.load();
      }

      // 与服务器的开始时间同步，设置一个容差值（例如2秒）避免频繁跳动
      if (playtime > 0 && Math.abs(audio.currentTime - playtime) > 2) {
        audio.currentTime = playtime;
      }

      // 核心播放逻辑，并处理自动播放失败的情况
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((e: DOMException) => {
          if (e.name === "NotAllowedError") {
            onAutoplayModalOpen();
          } else {
            console.error("Audio play error:", e);
          }
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, playtime]); // 只依赖 `src` 和 `playtime`

  return (
    <>
      {/* 纯 UI 的播放器组件 */}
      <MusicPlayer
        time={time}
        length={length}
        nextClick={onNextClick}
        reset={onReset}
      />
      
      {/* 用于处理自动播放限制的 Modal */}
      <Modal isOpen={isAutoplayModalOpen} onClose={onAutoplayModalClose} isCentered>
        <ModalOverlay />
        <ModalContent>
            <ModalHeader fontSize={"lg"} fontWeight={"bold"}>
              播放器需要您的允许
            </ModalHeader>
            <ModalBody>
              <Text>
                浏览器限制了声音自动播放，请点击下方的按钮以开始。
              </Text>
            </ModalBody>
            <ModalFooter>
              <Button
                onClick={() => {
                  audioRef.current?.play().catch(e => console.error("Manual play failed:", e));
                  onAutoplayModalClose();
                }}
                w="full"
              >
                开始播放
              </Button>
            </ModalFooter>
          </ModalContent>
      </Modal>
    </>
  );
};

