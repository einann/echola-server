import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

export interface AudioProcessResult {
  metadata: {
    mimeType: string;
    size: number;
    duration?: number;
  };
  waveformData: number[];
}

@Injectable()
export class AudioProcessor {
  constructor(private readonly logger: Logger) {}

  /**
   * Process audio buffer and extract waveform data
   * Generates an array of normalized amplitude peaks (0-1) for visualization
   */
  process(buffer: Buffer, mimeType: string): AudioProcessResult {
    // Number of samples to generate for waveform visualization
    const numberOfSamples = 100;

    // For now, we'll generate waveform from raw audio data
    // In production, you might want to use a library like audiowaveform or fluent-ffmpeg
    const waveformData = this.generateWaveformFromBuffer(buffer, numberOfSamples);

    // Estimate duration based on typical audio bitrates
    // For accurate duration, consider using ffprobe or similar
    const estimatedDuration = this.estimateDuration(buffer.length, mimeType);

    return {
      metadata: {
        mimeType,
        size: buffer.length,
        duration: estimatedDuration,
      },
      waveformData,
    };
  }

  /**
   * Generate waveform peaks from audio buffer
   * This is a simplified implementation that works with raw PCM-like data
   * For production, consider using ffmpeg/audiowaveform for accurate results
   */
  private generateWaveformFromBuffer(buffer: Buffer, samples: number): number[] {
    const waveform: number[] = [];
    const chunkSize = Math.floor(buffer.length / samples);

    for (let i = 0; i < samples; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, buffer.length);

      // Calculate RMS (Root Mean Square) for this chunk
      let sum = 0;
      let count = 0;

      for (let j = start; j < end; j += 2) {
        // Treat as 16-bit samples
        if (j + 1 < buffer.length) {
          // Read as signed 16-bit little-endian
          const sample = buffer.readInt16LE(j);
          sum += sample * sample;
          count++;
        }
      }

      // Normalize to 0-1 range
      const rms = count > 0 ? Math.sqrt(sum / count) / 32768 : 0;
      const normalizedPeak = Math.min(1, rms * 2); // Scale up slightly for visibility
      waveform.push(Math.round(normalizedPeak * 100) / 100);
    }

    // Ensure we have some variation for visual interest
    // If all values are very low, it might be compressed audio
    const maxVal = Math.max(...waveform);
    if (maxVal < 0.1 && maxVal > 0) {
      // Normalize the waveform to use full range
      return waveform.map((v) => Math.round((v / maxVal) * 100) / 100);
    }

    return waveform;
  }

  /**
   * Estimate audio duration based on file size and typical bitrates
   */
  private estimateDuration(fileSize: number, mimeType: string): number | undefined {
    // Typical bitrates in bits per second
    const bitrates: Record<string, number> = {
      'audio/mpeg': 128000, // 128 kbps MP3
      'audio/mp3': 128000,
      'audio/ogg': 96000, // 96 kbps OGG
      'audio/opus': 64000, // 64 kbps Opus
      'audio/webm': 64000,
      'audio/wav': 1411200, // 16-bit 44.1kHz stereo PCM
      'audio/aac': 128000,
      'audio/m4a': 128000,
    };

    const bitrate = bitrates[mimeType];
    if (bitrate) {
      // Duration in seconds = (file size in bytes * 8) / bitrate
      return Math.round((fileSize * 8) / bitrate);
    }

    // Default estimate for unknown formats (assume 128kbps)
    return Math.round((fileSize * 8) / 128000);
  }
}
