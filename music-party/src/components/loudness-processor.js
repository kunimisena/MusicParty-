/**
 * 一阶IIR滤波器类 (保持不变)
 */
class FirstOrderFilter {
  constructor(coeffs) {
    this.b0 = coeffs.b0; this.b1 = coeffs.b1; this.a1 = coeffs.a1;
    this.z1 = 0;
  }
  process(input) {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i];
      const y0 = this.b0 * x0 + this.z1;
      this.z1 = this.b1 * x0 - this.a1 * y0;
      output[i] = isFinite(y0) ? y0 : 0;
    }
    return output;
  }
  reset() { this.z1 = 0; }
}

/**
 * Biquad (二阶) IIR滤波器类 (保持不变)
 */
class BiquadFilter {
  constructor(coeffs) {
    this.b0 = coeffs.b0; this.b1 = coeffs.b1; this.b2 = coeffs.b2;
    this.a1 = coeffs.a1; this.a2 = coeffs.a2;
    this.z1 = 0; this.z2 = 0;
  }
  process(input) {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i];
      const y0 = this.b0 * x0 + this.z1;
      this.z1 = this.b1 * x0 - this.a1 * y0 + this.z2;
      this.z2 = this.b2 * x0 - this.a2 * y0;
      output[i] = isFinite(y0) ? y0 : 0;
    }
    return output;
  }
  reset() { this.z1 = 0; this.z2 = 0; }
}

/**
 * 响度处理器 (V3 - 高频重叠窗口)
 * 职责：基于400ms滑动窗口，高频次地计算并发送瞬时响度。
 */
class LoudnessProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sourceSampleRate = options.processorOptions.sampleRate || sampleRate;
    this.targetSampleRate = 16000.0;
    this.downsampleFactor = this.sourceSampleRate / this.targetSampleRate;

    const preFilterCoeffs = this.calculateCookbookLowpass(8000, this.sourceSampleRate, 0.707);
    this.preFilter = new BiquadFilter(preFilterCoeffs);

    const kShelfCoeffs = this.calculateCookbookPeakingEQ(this.targetSampleRate, 1500.0, 0.5, 4.0);
    this.kShelfFilter = new BiquadFilter(kShelfCoeffs);
    
    const kPassCoeffs = this.calculateKWeightingHighpassCoeffs_1stOrder(this.targetSampleRate);
    this.kPassFilter = new FirstOrderFilter(kPassCoeffs);
    
    this.windowSize = Math.floor(0.4 * this.targetSampleRate); // 400ms
    this.slidingWindow = new Float32Array(this.windowSize);
    
    this.reset();

    this.port.onmessage = (event) => {
      if (event.data.type === 'reset') this.reset();
    };
  }

  // ... (系数计算函数保持不变) ...
  calculateCookbookLowpass(cutoffFreq, sampleRate, Q) {
    const w0 = 2 * Math.PI * cutoffFreq / sampleRate;
    const cos_w0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return {
      b0: (1 - cos_w0) / 2 / a0, b1: (1 - cos_w0) / a0, b2: (1 - cos_w0) / 2 / a0,
      a1: -2 * cos_w0 / a0, a2: (1 - alpha) / a0
    };
  }

  calculateCookbookPeakingEQ(sampleRate, f0, Q, gainDB) {
    const A = 10 ** (gainDB / 40);
    const w0 = 2 * Math.PI * f0 / sampleRate;
    const cos_w0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha / A;
    return {
      b0: (1 + alpha * A) / a0, b1: -2 * cos_w0 / a0, b2: (1 - alpha * A) / a0,
      a1: -2 * cos_w0 / a0, a2: (1 - alpha / A) / a0
    };
  }

  calculateKWeightingHighpassCoeffs_1stOrder(sampleRate) {
    const x = Math.exp(-2 * Math.PI * 38.0 / sampleRate);
    return { b0: (1 + x) / 2, b1: -((1 + x) / 2), a1: -x };
  }

  reset() {
    this.preFilter.reset();
    this.kShelfFilter.reset();
    this.kPassFilter.reset();
    this.slidingWindow.fill(0);
    this.windowSumOfSquares = 0;
    this.windowCurrentIndex = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    
    for (let channel = 0; channel < input.length; channel++) {
      if (input[channel]) output[channel].set(input[channel]);
    }

    const leftChannel = input[0];
    if (!leftChannel || leftChannel.length === 0) return true;

    // --- 滤波和降采样 ---
    const preFiltered = this.preFilter.process(leftChannel);
    const numDownsampled = Math.floor(preFiltered.length / this.downsampleFactor);
    const downsampled = new Float32Array(numDownsampled);
    for (let i = 0; i < numDownsampled; i++) {
        const srcIndex = i * this.downsampleFactor;
        const i0 = Math.floor(srcIndex);
        const frac = srcIndex - i0;
        downsampled[i] = (i0 + 1 < preFiltered.length) 
            ? preFiltered[i0] * (1 - frac) + preFiltered[i0 + 1] * frac
            : preFiltered[i0];
    }
    const kShelfFiltered = this.kShelfFilter.process(downsampled);
    const kWeighted = this.kPassFilter.process(kShelfFiltered);
    
    // 【修改】不再等待攒够400ms，而是每个处理块都计算并发送最新的滑动窗口响度
    if (kWeighted.length > 0) {
        for (let i = 0; i < kWeighted.length; i++) {
            const sample = kWeighted[i];
            const oldestSample = this.slidingWindow[this.windowCurrentIndex];
            this.windowSumOfSquares -= oldestSample * oldestSample;
            this.windowSumOfSquares += sample * sample;
            this.slidingWindow[this.windowCurrentIndex] = sample;
            this.windowCurrentIndex = (this.windowCurrentIndex + 1) % this.windowSize;
        }

        const meanSquare = this.windowSumOfSquares / this.windowSize;
        if (meanSquare > 0) {
            const momentaryLoudness = 10 * Math.log10(meanSquare) - 0.691;
            this.port.postMessage({
                type: 'momentary-loudness',
                value: momentaryLoudness
            });
        }
    }

    return true;
  }
}

registerProcessor('loudness-processor', LoudnessProcessor);
