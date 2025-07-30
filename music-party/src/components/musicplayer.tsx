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
  useDisclosure,
  Switch, // 新增
  Box,    // 新增
  Stack,  // 新增
  FormLabel, // 新增
} from "@chakra-ui/react";
import { ArrowRightIcon } from "@chakra-ui/icons";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { AudioEngine } from "./AudioEngine.js";

// 全局函数声明，方便从浏览器控制台调试
declare global {
  interface Window {
    setAppVolumeDb: (dbValue: number) => void;
    setPidConfig: (config: object) => void;
  }
}

// =================================================================
// 【新增】增益可视化组件 (GainMeter)
// =================================================================
const GainMeter = React.memo((props: { gainDb: number }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maxDb = 12; // 视觉上的最大增益值

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 适配高DPI屏幕
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;

    // 1. 清空画布
    ctx.clearRect(0, 0, width, height);

    // 2. 绘制背景/轨道
    ctx.fillStyle = '#E2E8F0'; // gray.200
    ctx.fillRect(0, 0, width, height);
    
    // 3. 绘制中心线
    ctx.fillStyle = '#A0AEC0'; // gray.400
    ctx.fillRect(centerX - 0.5, 0, 1, height);

    // 4. 计算并绘制增益条
    const gainRatio = Math.max(-1, Math.min(1, props.gainDb / maxDb));
    
    if (gainRatio > 0) {
      // 正增益 (绿色)
      ctx.fillStyle = '#68D391'; // green.300
      ctx.fillRect(centerX, 0, gainRatio * (width / 2), height);
    } else if (gainRatio < 0) {
      // 负增益 (黄色)
      ctx.fillStyle = '#F6E05E'; // yellow.300
      ctx.fillRect(centerX + gainRatio * (width / 2), 0, -gainRatio * (width / 2), height);
    }

  }, [props.gainDb]);

  return (
    <Box flex="1" height="12px" borderRadius="md" overflow="hidden">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
});


// =================================================================
//  修改后的 MusicPlayer 组件
// =================================================================
export const MusicPlayer = (props: {
  src: string;
  playtime: number;
  nextClick: () => void;
  reset: () => void;
}) => {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const [isEngineReady, setIsEngineReady] = useState(false);

  const [length, setLength] = useState(100);
  const [time, setTime] = useState(0);
  const { isOpen, onOpen, onClose } = useDisclosure();

  // 【新增】自动增益UI所需的状态
  const [isAutoGainEnabled, setIsAutoGainEnabled] = useState(false); // 开关状态，默认禁用
  const [currentGainDb, setCurrentGainDb] = useState(-3.0); // 增益值，从初始值开始

  // Effect 1: 初始化音频引擎和元素 (只在组件挂载时运行一次)
  useEffect(() => {
    console.log("MusicPlayer: Mounting component...");
    
    audioElRef.current = new Audio();
    engineRef.current = new AudioEngine();

    window.setAppVolumeDb = (dbValue: number) => {
      engineRef.current?.setVolume(dbValue);
      console.log(`[Debug] Volume target set to: ${dbValue} dB`);
    };
    window.setPidConfig = (config: object) => {
      engineRef.current?.setPidConfig(config);
    };

    engineRef.current.connect(audioElRef.current)
      .then(() => {
        console.log("MusicPlayer: AudioEngine is fully connected and ready.");
        
        // 【新增】设置从引擎到UI的回调
        if (engineRef.current) {
          engineRef.current.onGainUpdate = (db) => {
            setCurrentGainDb(db);
          };
        }

        setIsEngineReady(true);
      })
      .catch(error => {
        console.error("Fatal error connecting AudioEngine:", error);
      });
      
    const currentAudioEl = audioElRef.current;
    const handleDurationChange = () => setLength(currentAudioEl.duration);
    const handleTimeUpdate = () => setTime(currentAudioEl.currentTime);
    
    currentAudioEl.addEventListener("durationchange", handleDurationChange);
    currentAudioEl.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      console.log("MusicPlayer: Unmounting component.");
      currentAudioEl.removeEventListener("durationchange", handleDurationChange);
      currentAudioEl.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, []);

  // Effect 2: 响应歌曲变化 (仅当引擎就绪后才运行)
  useEffect(() => {
    if (!isEngineReady || !props.src || !audioElRef.current) {
      return;
    }
    engineRef.current?.startNewSong();
    console.log(`MusicPlayer: Loading new source: ${props.src}`);
    const currentAudioEl = audioElRef.current;
    
    currentAudioEl.src = props.src;
    currentAudioEl.crossOrigin = "anonymous";
    
    if (props.playtime !== 0) {
      currentAudioEl.currentTime = props.playtime;
    }

    currentAudioEl.play().catch((e: DOMException) => {
      if (e.name === 'AbortError') {
        console.log("Audio play() was aborted, likely by a new source being loaded.");
        return;
      }
      console.error("Audio play error:", e);
      onOpen();
    });

  }, [props.src, props.playtime, isEngineReady]);

  // 【新增】处理自动增益开关变化的函数
  const handleAutoGainChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isEnabled = event.target.checked;
    setIsAutoGainEnabled(isEnabled);
    engineRef.current?.setAutoGainActive(isEnabled);
  };

  const handleUserGesture = () => {
    engineRef.current?.resumeContext();
    audioElRef.current?.play();
    props.reset();
    onClose();
  };

  return (
    <>
      {/* 【布局修改】使用Stack来垂直排列播放器控件 */}
      <Stack spacing={2}>
        {/* 第一行：播放进度条和时间 */}
        <Flex flexDirection={"row"} alignItems={"center"}>
          <Progress flex={12} height={"32px"} max={length} value={time} />
          <Text flex={2} textAlign={"center"}>{`${Math.floor(
            time
          )} / ${Math.floor(length)}`}</Text>
          <Tooltip hasArrow label="当音乐没有自动播放时，点我试试">
            <IconButton
              flex={1}
              aria-label={"Play"}
              mr={2}
              icon={
                <Icon viewBox="0 0 1024 1024">
                  <path
                    d="M128 138.666667c0-47.232 33.322667-66.666667 74.176-43.562667l663.146667 374.954667c40.96 23.168 40.853333 60.8 0 83.882666L202.176 928.896C161.216 952.064 128 932.565333 128 885.333333v-746.666666z"
                    fill="#3D3D3D"
                    p-id="2949"
                  ></path>
                </Icon>
              }
              onClick={() => {
                engineRef.current?.resumeContext();
                audioElRef.current?.play();
                props.reset();
              }}
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

        {/* 【新增】第二行：自动增益控制条 */}
        <Flex
          flexDirection="row"
          alignItems="center"
          p={2}
          borderWidth="1px"
          borderColor="gray.200"
          borderRadius="md"
        >
          <FormLabel htmlFor='auto-gain-switch' mb='0' fontSize="sm" whiteSpace="nowrap">
            自动增益
          </FormLabel>
          <Switch id='auto-gain-switch' isChecked={isAutoGainEnabled} onChange={handleAutoGainChange} mr={3}/>
          <GainMeter gainDb={currentGainDb} />
          <Text fontSize="sm" fontWeight="bold" width="80px" textAlign="center" ml={3}>
            {currentGainDb.toFixed(1)} dB
          </Text>
        </Flex>
      </Stack>

      {/* 播放失败的模态框 (无变化) */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay>
          <ModalContent>
            <ModalHeader fontSize={"lg"} fontWeight={"bold"}>
              播放失败
            </ModalHeader>
            <ModalBody>
              <Text>
                您的浏览器似乎禁止了音频自动播放，
                请点击下方按钮以手动开始播放。
              </Text>
            </ModalBody>
            <ModalFooter>
              <Button colorScheme={"blue"} onClick={handleUserGesture}>
                开始播放
              </Button>
            </ModalFooter>
          </ModalContent>
        </ModalOverlay>
      </Modal>
    </>
  );
};
