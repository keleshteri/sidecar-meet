import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export const DEFAULT_AUDIO_DEVICE = 'CABLE Output (VB-Audio Virtual Cable)';
export const SAMPLE_RATE = 16000;

export interface AudioCapture {
  stop(): void;
}

export interface CaptureDeviceAudioOptions {
  /** DirectShow device name to read from. Defaults to VB-Cable's standard output device name. */
  device?: string;
  onError?: (message: string) => void;
}

/**
 * Spawns ffmpeg against a Windows DirectShow audio input device — the
 * virtual cable's recording side, which mirrors whatever the system is
 * currently playing out, including the meeting tab's audio — and hands raw
 * 16-bit mono PCM chunks to onData as they arrive. Requires the cable
 * (VB-Cable/VoiceMeeter) to already be installed and set as the system's
 * default playback+recording device; see docs/phases/phase-2-listener.md.
 */
export function captureDeviceAudio(
  onData: (chunk: Buffer) => void,
  options: CaptureDeviceAudioOptions = {},
): AudioCapture {
  const device = options.device ?? DEFAULT_AUDIO_DEVICE;

  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not resolve a binary for this platform.');
  }

  const ffmpeg = spawn(ffmpegPath, [
    '-f',
    'dshow',
    '-i',
    `audio=${device}`,
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    '-f',
    's16le',
    '-loglevel',
    'error',
    '-',
  ]);

  ffmpeg.stdout.on('data', onData);
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    options.onError?.(chunk.toString());
  });

  return {
    stop() {
      ffmpeg.kill();
    },
  };
}
