/**
 * 一个在独立音频线程中运行的、基于PID的音量控制器。
 * (V2 - UI反馈版)
 */
class VolumeProcessor extends AudioWorkletProcessor {
  config = {};
  targetDb = 0.0;
  currentDb = 0.0;
  velocity = 0.0;
  integralError = 0.0;
  currentGain = 1.0;

  // UI反馈系统
  reportIntervalFrames = sampleRate / 20; // 每秒报告20次 (50ms)
  framesSinceLastReport = 0;

  constructor(options) {
    super();
    this.port.onmessage = (event) => {
      if (event.data.type === 'set-target') {
        this.targetDb = event.data.value;
      } else if (event.data.type === 'set-config') {
        this.config = { ...this.config, ...event.data.value };
      } else if (event.data.type === 'reset-state') {
        this.targetDb = event.data.value;
        this.currentDb = event.data.value;
        this.currentGain = 10 ** (this.currentDb / 20);
        this.velocity = 0.0;
        this.integralError = 0.0;
      }
    };
    
    if (options && options.processorOptions) {
        this.config = options.processorOptions.pidConfig;
        this.targetDb = options.processorOptions.initialDb || 0.0;
        this.currentDb = this.targetDb;
        this.currentGain = 10 ** (this.currentDb / 20);
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !input[0]) {
        return true;
    }
    
    const deltaTime = input[0].length / sampleRate;
    const error = this.targetDb - this.currentDb;

    if (Math.abs(error) > 0.01 || Math.abs(this.velocity) > 0.01) {
      const p_force = this.config.kp * error;
      this.integralError += error * deltaTime;
      const i_force = this.config.ki * this.integralError;
      const d_force = -this.config.kd * this.velocity;
      const total_force = p_force + i_force + d_force;
      const acceleration = total_force / this.config.mass;
      this.velocity += acceleration * deltaTime;
      const maxSpeed = this.config.maxSpeedDbPerSecond;
      this.velocity = Math.max(-maxSpeed, Math.min(maxSpeed, this.velocity));
      this.currentDb += this.velocity * deltaTime;
      this.currentGain = 10 ** (this.currentDb / 20);
    } else {
      this.currentDb = this.targetDb;
      this.velocity = 0;
      this.integralError = 0;
      this.currentGain = 10 ** (this.currentDb / 20);
    }

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      for (let i = 0; i < inputChannel.length; i++) {
        outputChannel[i] = inputChannel[i] * this.currentGain;
      }
    }

    // 【核心修改】将当前增益值发送回主线程用于UI更新，取代console.log
    this.framesSinceLastReport += output[0].length;
    if (this.framesSinceLastReport >= this.reportIntervalFrames) {
      this.port.postMessage({
        type: 'gain-update',
        value: this.currentDb
      });
      this.framesSinceLastReport = 0;
    }

    return true;
  }
}

registerProcessor('volume-processor', VolumeProcessor);
