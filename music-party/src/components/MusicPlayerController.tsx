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

const LOCALSTORAGE_VOLUME_KEY = 'music_party_volume';

export const MusicPlayerController = (props: MusicPlayerControllerProps) => {
  const { src, playtime, onNextClick, onReset } = props;

  const [length, setLength] = useState(0);
  const [time, setTime] = useState(0);
  const [sliderValue, setSliderValue] = useState(100); 

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isInitialLoadForSrc = useRef(true); // 用于跟踪是否是某个src的首次加载
  const { isOpen: isAutoplayModalOpen, onOpen: onAutoplayModalOpen, onClose: onAutoplayModalClose } = useDisclosure();

  useEffect(() => {
    const savedVolume = localStorage.getItem(LOCALSTORAGE_VOLUME_KEY);
    if (savedVolume !== null && !isNaN(Number(savedVolume))) {
      setSliderValue(Number(savedVolume));
    }
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

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
    
    return () => {
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
    }
  }, []);

  const sliderToVolume = useCallback((value: number) => {
    if (value === 0) return 0;
    const db = -24 + (value / 100) * 24;
    return Math.pow(10, db / 20);
  }, []);

  const valueToDbText = useCallback((value: number) => {
    if (value === 0) return "-inf dB";
    const db = -24 + (value / 100) * 24;
    return `${db.toFixed(1)} dB`;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    audio.volume = sliderToVolume(sliderValue);

    if (src === "") {
      audio.pause();
      audio.src = ""; // 确保完全重置
      setTime(0);
      setLength(0);
    } else {
      const isNewSrc = !audio.currentSrc.endsWith(src);
      
      if (isNewSrc) {
        isInitialLoadForSrc.current = true;
        audio.src = src;
        audio.load(); // 显式告诉浏览器开始加载新资源
      } else {
        isInitialLoadForSrc.current = false;
      }

      // --- [最终版 Firefox 兼容性修复] ---
      // 这是一个健壮的、事件驱动的播放/同步逻辑，专门解决Firefox的竞速问题

      const playAudio = () => {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((error: DOMException) => {
            if (error.name === "NotAllowedError") {
              onAutoplayModalOpen();
            } else {
              console.error("Playback failed:", error);
            }
          });
        }
      };

      if (isInitialLoadForSrc.current) {
        // 对于新加载的歌曲（特别是Firefox首次加载），我们必须等待浏览器准备好
        const handleCanPlay = () => {
          console.log(`canplay event fired. Ready to seek. Setting time to ${playtime}`);
          audio.currentTime = playtime;
          playAudio();
          // 清理监听器，防止重复执行
          audio.removeEventListener('canplay', handleCanPlay);
        };
        audio.addEventListener('canplay', handleCanPlay);
      } else {
        // 对于已经加载的歌曲，直接播放和同步即可
        const timeDiff = Math.abs(audio.currentTime - playtime);
        if (timeDiff > 2) {
           audio.currentTime = playtime;
        }
        playAudio();
      }
    }
  }, [src, playtime, sliderToVolume, onAutoplayModalOpen]); 

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = sliderToVolume(sliderValue);
    }
    localStorage.setItem(LOCALSTORAGE_VOLUME_KEY, String(sliderValue));
  }, [sliderValue, sliderToVolume]);

  return (
    <>
      <MusicPlayer
        time={time}
        length={length}
        nextClick={onNextClick}
        reset={onReset}
        volumeValue={sliderValue}
        onVolumeChange={setSliderValue}
        dbText={valueToDbText(sliderValue)}
      />
      
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

