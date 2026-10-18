# Phase 4 — Local Brain (Obsidian + LLM)

**Status:** not started

## Objective

The bot can form a relevant spoken reply, grounded in your own notes.

## Likely scope

- RAG index over an Obsidian vault directory using LlamaIndex.TS.
- Feed Phase 2's live transcript in as query context; retrieve relevant notes.
- Generate a reply with a local model (Ollama running Llama 3) or the OpenAI
  API, depending on the privacy/cost/quality tradeoff you want at the time.
- Replace the static `hello.wav` playback from Phase 1 with dynamically
  generated speech (ElevenLabs) piped into the same fake-audio-capture flag
  bot-engine already uses.

## Depends on

Phase 2 (needs a transcript to react to) and Phase 1's audio-injection
mechanism (same fake-mic flag, just fed a generated file instead of a static
one).
