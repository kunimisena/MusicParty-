import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDisclosure, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Text } from '@chakra-ui/react';
import { MusicPlayer } from './musicplayer';

// 定义组件接收的 props 接口
interface MusicPlayerControllerProps {
  src: string; // 音频源 URL
  playtime: number; // 从服务器同步的播放开始时间
  onNextClick: () => void; // “下一首”按钮的回调
  onReset: () => void; // “同步”按钮的回调
}

// [新增] 用于本地存储音量值的键
const LOCALSTORAGE_VOLUME_KEY = 'music_party_volume';

/**
 * 这是一个“智能”容器组件，专门负责：
 * 1. 管理 <audio> 元素的整个生命周期。
 * 2. 封装所有高频更新的状态（time, length），将“渲染风暴”隔离在此组件内部。
 * 3. 处理浏览器的自动播放策略。
 * 4. [新增] 管理音量状态、逻辑转换和持久化。
 * 5. 渲染纯 UI 的 MusicPlayer 组件，向其传递所需的 props。
 */
export const MusicPlayerController = (props: MusicPlayerControllerProps) => {
  const { src, playtime, onNextClick, onReset } = props;

  // 内部状态，用于驱动 UI，不会影响外部组件
  const [length, setLength] = useState(0);
  const [time, setTime] = useState(0);
  
  // [新增] 音量相关的状态，默认值为100（最大音量）
  const [sliderValue, setSliderValue] = useState(100); 

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { isOpen: isAutoplayModalOpen, onOpen: onAutoplayModalOpen, onClose: onAutoplayModalClose } = useDisclosure();

  // [新增] Effect 0: 首次加载时从LocalStorage恢复音量
  useEffect(() => {
    const savedVolume = localStorage.getItem(LOCALSTORAGE_VOLUME_KEY);
    if (savedVolume !== null && !isNaN(Number(savedVolume))) {
      // 确保读取的值是有效的数字
      setSliderValue(Number(savedVolume));
    }
  }, []); // 空依赖数组，确保只在组件首次挂载时运行

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

  // [新增] 核心转换函数
  // 将滑块的线性值 (0-100) 转换为 <audio> 的对数音量 (0.0-1.0)
  const sliderToVolume = useCallback((value: number) => {
    if (value === 0) return 0;
    // 1. 将滑块值映射到 -24dB 到 0dB 的范围
    const db = -24 + (value / 100) * 24;
    // 2. 将 dB 转换为音量增益 (gain)
    const volume = Math.pow(10, db / 20);
    return volume;
  }, []);

  // 将滑块的线性值 (0-100) 转换为显示的 dB 文本
  const valueToDbText = useCallback((value: number) => {
    if (value === 0) return "-inf dB"; // 0时表示负无穷
    const db = -24 + (value / 100) * 24;
    return `${db.toFixed(1)} dB`;
  }, []);


  // Effect 2: 响应外部 props 变化，控制播放逻辑
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return; // 确保 audio 元素已创建
    
    // [修改] 在此Effect开始时，根据当前的sliderValue设置一次音量
    audio.volume = sliderToVolume(sliderValue);

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

  // [新增] Effect 3: 响应音量滑块变化，更新audio音量并持久化
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = sliderToVolume(sliderValue);
    }
    localStorage.setItem(LOCALSTORAGE_VOLUME_KEY, String(sliderValue));
  }, [sliderValue, sliderToVolume]);


  return (
    <>
      {/* 纯 UI 的播放器组件 */}
      <MusicPlayer
        time={time}
        length={length}
        nextClick={onNextClick}
        reset={onReset}
        // [新增] 传递音量相关的props
        volumeValue={sliderValue}
        onVolumeChange={setSliderValue}
        dbText={valueToDbText(sliderValue)}
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
