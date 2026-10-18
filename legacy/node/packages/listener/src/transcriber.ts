import { SAMPLE_RATE } from './audioCapture';

export interface TranscriptSegment {
  text: string;
  startedAt: Date;
}

export interface Transcriber {
  send(chunk: Buffer): void;
  stop(): void;
}

export interface StartTranscriberOptions {
  /** Hugging Face model id for a whisper checkpoint, e.g. 'Xenova/whisper-small'. */
  modelId?: string;
  /** ONNX Runtime quantization: 'fp32' | 'fp16' | 'q8' | 'q4' etc. */
  dtype?: string;
  /** ONNX Runtime execution provider: 'cpu' (default) or 'dml' for DirectML GPU offload on Windows. */
  device?: string;
  /** How many seconds of audio to batch before running the model on it. */
  chunkSeconds?: number;
}

export const DEFAULT_CHUNK_SECONDS = 8;
export const DEFAULT_MODEL_ID = 'Xenova/whisper-small';
export const DEFAULT_DTYPE = 'q8';
export const DEFAULT_DEVICE = 'cpu';
const BYTES_PER_SAMPLE = 2; // 16-bit PCM, matches audioCapture's -f s16le output

// @huggingface/transformers ships ESM-only. This package builds to
// CommonJS (see tsconfig.json), and tsc downlevels a plain top-level
// `import` of an ESM-only package into a `require()` call, which throws
// ERR_REQUIRE_ESM at runtime. Going through `new Function(...)` forces a
// genuine dynamic `import()` that tsc can't see and rewrite.
type TransformersModule = typeof import('@huggingface/transformers');
type AsrPipeline = (audio: Float32Array) => Promise<{ text: string } | { text: string }[]>;
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<TransformersModule>;

let pipelinePromise: Promise<AsrPipeline> | undefined;

/**
 * Loads (and caches) a single shared whisper pipeline instance. Deliberately
 * one instance for the whole process, not one per bot session — reloading a
 * multi-hundred-MB model per session would be wasteful, and this machine's
 * CPU/GPU is likely the bottleneck, not the model load itself.
 */
function getPipeline(modelId: string, dtype: string, device: string): Promise<AsrPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = dynamicImport('@huggingface/transformers').then(
      ({ pipeline }) => pipeline('automatic-speech-recognition', modelId, { dtype, device } as never) as never,
    );
  }
  return pipelinePromise;
}

// Serializes inference across every active session onto a single queue.
// The shared pipeline instance is one ONNX Runtime session; running two
// chunks through it concurrently on modest consumer hardware would just
// contend for the same CPU/GPU rather than actually parallelize.
let inferenceQueue: Promise<void> = Promise.resolve();

function pcmToFloat32(pcm: Buffer): Float32Array {
  const sampleCount = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  const audio = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    audio[i] = pcm.readInt16LE(i * BYTES_PER_SAMPLE) / 32768;
  }
  return audio;
}

/**
 * Buffers incoming PCM into fixed-length windows and runs each one through
 * a local whisper model (via @huggingface/transformers, in-process) as it
 * fills, rather than streaming continuously to a cloud STT websocket.
 * Transcript segments therefore lag by up to chunkSeconds — acceptable here
 * since nothing downstream needs live-voice-agent latency, just a readable
 * transcript (see docs/phases/phase-2-listener.md).
 */
export function startTranscriber(
  options: StartTranscriberOptions,
  onSegment: (segment: TranscriptSegment) => void,
  onError?: (message: string) => void,
): Transcriber {
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const dtype = options.dtype ?? DEFAULT_DTYPE;
  const device = options.device ?? DEFAULT_DEVICE;
  const chunkBytes = (options.chunkSeconds ?? DEFAULT_CHUNK_SECONDS) * SAMPLE_RATE * BYTES_PER_SAMPLE;

  let buffered: Buffer[] = [];
  let bufferedBytes = 0;
  let stopped = false;

  async function transcribeChunk(pcm: Buffer): Promise<void> {
    const audio = pcmToFloat32(pcm);
    const transcribe = await getPipeline(modelId, dtype, device);
    const output = await transcribe(audio);
    const text = (Array.isArray(output) ? output.map((segment) => segment.text).join(' ') : output.text).trim();
    if (text) {
      onSegment({ text, startedAt: new Date() });
    }
  }

  function flush(): void {
    if (bufferedBytes === 0) return;
    const pcm = Buffer.concat(buffered, bufferedBytes);
    buffered = [];
    bufferedBytes = 0;

    inferenceQueue = inferenceQueue.then(() =>
      transcribeChunk(pcm).catch((err) => {
        onError?.(err instanceof Error ? err.message : String(err));
      }),
    );
  }

  return {
    send(chunk: Buffer) {
      if (stopped) return;
      buffered.push(chunk);
      bufferedBytes += chunk.length;
      if (bufferedBytes >= chunkBytes) {
        flush();
      }
    },
    stop() {
      stopped = true;
      flush();
    },
  };
}
