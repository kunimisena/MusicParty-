// 从唯一的配置源导入所有设置
import { PID_CONFIG, LIMITER_CONFIG, AUTOGAIN_CONFIG } from './audio-config.js';

/**
 * 音频引擎 (V2.1 - 类型修正)
 * 实现了带有激活延迟的动态回放增益算法。
 * 新增：可开关的逻辑和UI数据回调。
 */
export class AudioEngine {
  audioContext;
  sourceNode;
  limiterNode;
  loudnessProcessorNode;
  volumeProcessorNode;

  // --- 自动增益算法状态 ---
  songStartTime = 0;
  countOfGatedLoudness = 0;
  currentAverageLoudness = -70.0;

  // UI控制状态和回调
  isAutoGainActive = false;
  
  /** * 【核心修正】添加JSDoc类型提示，解决TypeScript中的类型推断错误。
   * @type {((db: number) => void) | null} 
   */
  onGainUpdate = null;      // 用于将增益值传递给UI的回调函数

  constructor() {
    this.audioContext = new AudioContext();
    this.limiterNode = this.audioContext.createDynamicsCompressor();
    
    this.limiterNode.threshold.value = LIMITER_CONFIG.threshold;
    this.limiterNode.knee.value = LIMITER_CONFIG.knee;
    this.limiterNode.ratio.value = LIMITER_CONFIG.ratio;
    this.limiterNode.attack.value = LIMITER_CONFIG.attack;
    this.limiterNode.release.value = LIMITER_CONFIG.release;
  }

  async connect(audioElement) {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }
    
    const loudnessWorkletUrl = new URL('./loudness-processor.js', import.meta.url);
    const volumeWorkletUrl = new URL('./volume-processor.js', import.meta.url);

    await Promise.all([
      this.audioContext.audioWorklet.addModule(loudnessWorkletUrl),
      this.audioContext.audioWorklet.addModule(volumeWorkletUrl)
    ]);

    this.volumeProcessorNode = new AudioWorkletNode(this.audioContext, 'volume-processor', {
        processorOptions: {
            pidConfig: PID_CONFIG,
            initialDb: AUTOGAIN_CONFIG.INITIAL_GAIN_DB,
        }
    });

    this.loudnessProcessorNode = new AudioWorkletNode(this.audioContext, 'loudness-processor', {
      processorOptions: {
        sampleRate: this.audioContext.sampleRate,
      },
    });

    this.setupMessageListeners();

    this.sourceNode = this.audioContext.createMediaElementSource(audioElement);

    this.sourceNode
      .connect(this.volumeProcessorNode)
      .connect(this.limiterNode)
      .connect(this.loudnessProcessorNode)
      .connect(this.audioContext.destination);

    console.log("AudioEngine (V2.1) is connected. AutoGain is ready but disabled by default.");
  }

  setupMessageListeners() {
    // 监听响度处理器
    this.loudnessProcessorNode.port.onmessage = (event) => {
      if (event.data.type !== 'momentary-loudness') return;

      const momentaryLoudness = event.data.value;
      const elapsedSeconds = (Date.now() - this.songStartTime) / 1000;

      // --- 步骤 1: 响度分析 (始终运行) ---
      let valuePassedGate = false;
      const relativeThreshold = this.currentAverageLoudness - AUTOGAIN_CONFIG.RELATIVE_GATE_RANGE_LU;

      if (elapsedSeconds <= AUTOGAIN_CONFIG.RELATIVE_GATE_DELAY_SECONDS) {
        if (momentaryLoudness > AUTOGAIN_CONFIG.ABSOLUTE_GATE_LUFS) {
          valuePassedGate = true;
        }
      } else {
        if (momentaryLoudness > AUTOGAIN_CONFIG.ABSOLUTE_GATE_LUFS && momentaryLoudness > relativeThreshold) {
          valuePassedGate = true;
        }
      }

      if (valuePassedGate) {
        if (this.countOfGatedLoudness === 0) {
          this.currentAverageLoudness = momentaryLoudness;
        } else {
          const n = this.countOfGatedLoudness;
          this.currentAverageLoudness = 
            (this.currentAverageLoudness * n / (n + 1)) + (momentaryLoudness / (n + 1));
        }
        this.countOfGatedLoudness++;
      }

      // --- 步骤 2: 音量调节 (仅在启用时且延迟后激活) ---
      if (this.isAutoGainActive && elapsedSeconds > AUTOGAIN_CONFIG.AUTOGAIN_ACTIVATION_DELAY_SECONDS) {
        const newTargetDb = AUTOGAIN_CONFIG.TARGET_LOUDNESS_LUFS - this.currentAverageLoudness;
        // 限制最大增益为12dB, 最小为-12dB (与UI对应)
        const clampedTargetDb = Math.max(-12.0, Math.min(12.0, newTargetDb));
        this.setVolume(clampedTargetDb);
      }
    };

    // 监听音量处理器，用于UI更新
    this.volumeProcessorNode.port.onmessage = (event) => {
        if (event.data.type === 'gain-update' && typeof this.onGainUpdate === 'function') {
            this.onGainUpdate(event.data.value);
        }
    }
  }

  startNewSong() {
    console.log("Starting new song, resetting all states.");
    this.songStartTime = Date.now();
    this.countOfGatedLoudness = 0;
    this.currentAverageLoudness = -70.0; 

    this.volumeProcessorNode.port.postMessage({
      type: 'reset-state',
      value: AUTOGAIN_CONFIG.INITIAL_GAIN_DB,
    });

    this.loudnessProcessorNode.port.postMessage({ type: 'reset' });
  }
  
  setVolume(dbValue) {
    if (this.volumeProcessorNode) {
      this.volumeProcessorNode.port.postMessage({
        type: 'set-target',
        value: dbValue,
      });
    }
  }

  setAutoGainActive(isActive) {
    this.isAutoGainActive = isActive;
    console.log(`AutoGain is now ${isActive ? 'ENABLED' : 'DISABLED'}.`);

    if (!isActive) {
      this.volumeProcessorNode.port.postMessage({
        type: 'reset-state',
        value: AUTOGAIN_CONFIG.INITIAL_GAIN_DB,
      });
    }
  }

  setPidConfig(newConfig) {
    if (this.volumeProcessorNode) {
        this.volumeProcessorNode.port.postMessage({
            type: 'set-config',
            value: newConfig,
        });
        console.log('New PID config sent to processor:', newConfig);
    }
  }
  
  resumeContext() {
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
      console.log("AudioContext resumed by user gesture.");
    }
  }
}
