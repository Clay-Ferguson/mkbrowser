# llama.cpp — Local LLM Backend

Run local LLM models using [llama.cpp](https://github.com/ggml-org/llama.cpp) as
an alternative to Ollama. llama.cpp provides an OpenAI-compatible HTTP API, which
MkBrowser connects to via the `LLAMACPP` provider.

## Quick Start

```bash
# 1. Install llama.cpp (downloads prebuilt binaries)
./setup.sh

# 2. Download the Gemma 4 model (E4B ~5.0 GB, E2B ~3.1 GB)
./download-model.sh

# 3. Start the server
./start-server.sh
```

Then in MkBrowser **Settings → AI**:
- Select **Gemma 4 (llama.cpp)** as your model
- Verify the **llama.cpp Base URL** is `http://localhost:8080/v1`

## Prerequisites

- **Linux x86_64** (Ubuntu or similar)
- **32 GB RAM** recommended (E4B Q4_K_M is ~5.0 GB, E2B Q4_K_M is ~3.1 GB)
- `curl`, `unzip`, `bc` (standard on most Ubuntu installs)

## Files

| Script | Purpose |
|--------|---------|
| `setup.sh` | Download and install llama.cpp binaries to `~/.local/bin/` |
| `download-model.sh` | Download a quantized Gemma 4 GGUF model to `~/.local/share/llama.cpp/models/` |
| `start-server.sh` | Launch `llama-server` on `localhost:8080` |

## Verifying the Server

Once `start-server.sh` is running, test with:

```bash
# List available models
curl http://localhost:8080/v1/models

# Send a test chat completion
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

## Switching Models

Two Gemma 4 model variants are supported:

| Variant | Effective Params | Q4_K_M Size | Notes |
|---------|-----------------|-------------|-------|
| **E4B** | 4.5B (8B total) | ~5.0 GB | Higher quality, default |
| **E2B** | 2.3B (5.1B total) | ~3.1 GB | Lighter, faster |

To switch variants, edit the `MODEL_VARIANT` line near the top of **both**
`download-model.sh` and `start-server.sh`. Comment out the active variant and
uncomment the other:

```bash
# Uncomment ONE of the following model variants:
MODEL_VARIANT="E2B"    # ← active
#MODEL_VARIANT="E4B"   # ← inactive
```

Both model files can coexist on disk (they have different filenames), so you
only need to run `./download-model.sh` once per variant. After switching, just
restart `./start-server.sh`.

## Customization

### Server parameters

`start-server.sh` passes CLI flags directly to `llama-server`. You can override
settings on the command line:

```bash
./start-server.sh --port 9090 --ctx-size 8192 --threads 8
```

Common flags:
- `--port N` — HTTP port (default: 8080)
- `--ctx-size N` — Context window size in tokens (default: 16384)
- `--threads N` — CPU threads (default: auto-detect)
- `--n-gpu-layers N` — Offload layers to GPU (for CUDA/ROCm builds)

See `llama-server --help` for all options.
