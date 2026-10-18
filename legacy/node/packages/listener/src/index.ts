import { captureDeviceAudio, AudioCapture } from './audioCapture';
import { startTranscriber, Transcriber, TranscriptSegment } from './transcriber';

export { TranscriptSegment } from './transcriber';
export { DEFAULT_AUDIO_DEVICE } from './audioCapture';

export interface StartListeningOptions {
  botId: string;
  /** Defaults to process.env.LISTENER_AUDIO_DEVICE, then DEFAULT_AUDIO_DEVICE. */
  audioDevice?: string;
  /** Defaults to process.env.WHISPER_MODEL_ID, then transcriber's DEFAULT_MODEL_ID. */
  whisperModelId?: string;
  /** Defaults to process.env.WHISPER_DTYPE, then transcriber's DEFAULT_DTYPE. */
  whisperDtype?: string;
  /** Defaults to process.env.WHISPER_DEVICE, then transcriber's DEFAULT_DEVICE. */
  whisperDevice?: string;
  /** Defaults to process.env.WHISPER_CHUNK_SECONDS, then transcriber's DEFAULT_CHUNK_SECONDS. */
  chunkSeconds?: number;
}

interface ListenerSession {
  capture: AudioCapture;
  transcriber: Transcriber;
  segments: TranscriptSegment[];
}

const activeSessions = new Map<string, ListenerSession>();

/**
 * Starts capturing the meeting's incoming audio (via the OS virtual audio
 * cable) and transcribing it locally with an in-process whisper model,
 * keyed by botId so getTranscript/stopListening can find it later.
 */
export async function startListening(options: StartListeningOptions): Promise<void> {
  const { botId } = options;
  const audioDevice = options.audioDevice ?? process.env.LISTENER_AUDIO_DEVICE;
  const whisperModelId = options.whisperModelId ?? process.env.WHISPER_MODEL_ID;
  const whisperDtype = options.whisperDtype ?? process.env.WHISPER_DTYPE;
  const whisperDevice = options.whisperDevice ?? process.env.WHISPER_DEVICE;
  const chunkSeconds =
    options.chunkSeconds ?? (process.env.WHISPER_CHUNK_SECONDS ? Number(process.env.WHISPER_CHUNK_SECONDS) : undefined);

  if (activeSessions.has(botId)) {
    return;
  }

  const segments: TranscriptSegment[] = [];

  const transcriber = startTranscriber(
    { modelId: whisperModelId, dtype: whisperDtype, device: whisperDevice, chunkSeconds },
    (segment) => segments.push(segment),
    (message) => {
      // eslint-disable-next-line no-console
      console.warn(`[listener] whisper error for bot ${botId}: ${message}`);
    },
  );

  const capture = captureDeviceAudio((chunk) => transcriber.send(chunk), {
    device: audioDevice,
    onError: (message) => {
      // eslint-disable-next-line no-console
      console.warn(`[listener] ffmpeg stderr for bot ${botId}: ${message}`);
    },
  });

  activeSessions.set(botId, { capture, transcriber, segments });
}

/**
 * Tears down the audio capture + transcription pipeline for botId (flushing
 * any partial chunk first). The transcript segments already collected stay
 * readable via getTranscript even after this is called.
 */
export function stopListening(botId: string): boolean {
  const session = activeSessions.get(botId);
  if (!session) return false;
  session.capture.stop();
  session.transcriber.stop();
  return true;
}

export function getTranscript(botId: string): TranscriptSegment[] | undefined {
  return activeSessions.get(botId)?.segments;
}
