# llama.cpp — Local LLM Backend

Run local LLM models using [llama.cpp](https://github.com/ggml-org/llama.cpp). llama.cpp provides an OpenAI-compatible HTTP API, which
MkBrowser connects to via the `LLAMACPP` provider. The scripts in this project can be used to run any `LLAMA.CPP` model locally on your own hardware 
the actual models that are listed (inactive ones commented out) are the ones selected because they run on the machine the developer of this project
uses which is a **Dell XPS laptop with an Intel Core Ultra 9 288V (Lunar Lake)**, which pairs 8 CPU cores with an **Intel Arc 140V integrated GPU** and 
**32 GB of on-package "unified" LPDDR5X memory**. So as long as you have a hardware equal to or better than this you can easily run all
the models listed in this project. Also the Vulkan script in this project is specific to my hardware Intel Chipset, and so it may not be applicable
to your specific hardware.

## Quick Start

```bash
# 1. Install llama.cpp (downloads prebuilt binaries)
./setup.sh

# 2. Download the model (see model selection in script; default: Qwen3.6-35B-A3B)
./download-model.sh

# 3. Start the server
./start-server.sh
```

Then in MkBrowser **Settings → AI**:
- Select the **llama.cpp** model
- Verify the **llama.cpp Base URL** is `http://localhost:8080/v1`

## Web UI (Browser Chat)

You don't need MkBrowser — or any extra app — just to confirm the model is up.
`llama-server` ships with a **built-in chat web app**, served from the same
host and port as the API. Once `./start-server.sh` is running, open:

```
http://localhost:8080
```

in any browser and you get a full chat interface with conversation history and
adjustable sampling settings (temperature, top-p, etc.). Nothing else to
install — it's part of the `llama-server` binary itself, so it's the quickest
way to prove the model is installed and answering (a friendlier alternative to
the `curl` checks in [Verifying the Server](#verifying-the-server)).

### Using a different port

The Web UI is served on the **same port as the API** (default **8080**), so
changing the port moves both. If something else on your machine is already using
8080, start the server on another port:

```bash
./start-server.sh --port 9090
```

Then open **http://localhost:9090** for the UI. (This is just the `--port N`
override described under [Customization](#server-parameters).)

If you change the port, update MkBrowser to match in **Settings → AI** by
setting the **llama.cpp Base URL** to `http://localhost:9090/v1`.

## Prerequisites

- **Linux x86_64** (Ubuntu or similar)
- **32 GB RAM** recommended (model sizes range from ~3.1 GB to ~24 GB)
- `curl`, `unzip`, `bc` (standard on most Ubuntu installs)

## Files

| Script | Purpose |
|--------|---------|
| `setup.sh` | Download and install the **CPU-only** llama.cpp binaries to `~/.local/bin/` |
| `setup-with-vulkan.sh` | Download and install a **Vulkan (GPU)** llama.cpp build side-by-side (see [Vulkan Driver](#vulkan-driver)) |
| `download-model.sh` | Download a quantized GGUF model to `~/.local/share/llama.cpp/models/` |
| `start-server.sh` | Launch the server on `localhost:8080`; selects CPU or GPU via the `BACKEND` env var |

## Verifying the Server

Once `start-server.sh` is running, test with:

```bash
# List available models
curl http://localhost:8080/v1/models

# Send a test chat completion
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

## Switching Models

Several model variants are supported:

| Variant | Params | Quant | File Size | Context | Notes |
|---------|--------|-------|-----------|---------|-------|
| **Qwen3.6-35B-A3B** | ~3B active / 35B total (MoE) | UD-IQ4_XS | ~17.7 GB | 16384 | Near-flagship coder; MoE keeps generation fast on unified memory. Uses flash-attn off + `-b 256` on the Arc 140V iGPU. **Current default** |
| **Gemma 4 26B-A4B** | 3.8B active / 25.2B total (MoE) | UD-IQ4_XS | ~13.4 GB | 8192 | High quality; MoE keeps generation fast despite the large size |
| **Gemma 4 12B QAT** | 12B (dense) | UD-Q4_K_XL | ~6.7 GB | 16384 | Quantization-Aware Training; lower memory (~7 GB total), potentially faster, accuracy close to BF16 |
| **Gemma 4 12B** | 12B (dense) | Q4_K_M | ~7.1 GB | 16384 | Strong quality |
| **Gemma 4 E4B** | 4.5B effective (8B total) | Q4_K_M | ~5.0 GB | 16384 | Good balance |
| **Gemma 4 E2B** | 2.3B effective (5.1B total) | Q4_K_M | ~3.1 GB | 16384 | Lightest, fastest |

To switch variants, edit the model selection block near the top of **both**
`download-model.sh` and `start-server.sh`. Comment out the active group and
uncomment the other. In `start-server.sh` a block may also set `FA`
(flash-attention on/off) and `BATCH` (prefill batch size); blocks that omit them
fall back to the defaults near the top of the selection section (`FA="on"`,
`BATCH=""`).

```bash
# Uncomment ONE group of settings below.

# Gemma 4 26B-A4B (MoE): 3.8B active params (~13.4 GB)
#MODEL_FILE="gemma-4-26B-A4B-it-UD-IQ4_XS.gguf"  # ← inactive
#CTX_SIZE="8192"                                   # ← inactive

# Qwen3.6-35B-A3B (MoE): ~3B active params (~17.7 GB)
MODEL_FILE="Qwen3.6-35B-A3B-UD-IQ4_XS.gguf"      # ← active
CTX_SIZE="16384"                                  # ← active
FA="off"                                          # ← active (Arc 140V workaround)
BATCH="256"                                        # ← active (better A3B prefill)
```

All model files can coexist on disk (they have different filenames), so you
only need to run `./download-model.sh` once per variant. After switching, just
restart `./start-server.sh`.

> **Note:** Qwen3.6-35B-A3B uses `IQ4_XS` and flash-attn off because the Arc
> 140V iGPU has a known crash with k-quants and with flash-attention enabled.
> Context is kept at 16384 to fit comfortably in 32 GB RAM alongside the ~17.7 GB
> weights, the OS, and KV-cache overhead.

## Vulkan Driver

By default this project runs entirely on the **CPU**. `setup.sh` installs the
plain CPU build of llama.cpp, and `start-server.sh` runs inference across your
processor cores. That works everywhere, but it leaves any GPU in the machine
idle. The optional `setup-with-vulkan.sh` script installs a second,
**GPU-accelerated** build that offloads the model to your graphics hardware via
[Vulkan](https://www.vulkan.org/).

**What is Vulkan, and why use it here?** Vulkan is a cross-vendor, open standard
for talking to GPUs — both for graphics and for general compute. For local LLMs
it serves the same role that CUDA does for NVIDIA cards or ROCm does for AMD
cards: it lets llama.cpp run the model's math on the GPU instead of the CPU. The
big advantage of Vulkan is that it is *vendor-neutral*. CUDA only works on
NVIDIA hardware and ROCm only on certain AMD cards, and both can be painful to
install. Vulkan, by contrast, runs on Intel integrated graphics, AMD GPUs, and
NVIDIA GPUs alike, using the driver that ships with the OS. That makes it the
most practical way to get GPU acceleration on the kind of hardware that doesn't
have a discrete NVIDIA card.

**The two setups, side by side.** The scripts are deliberately independent and
non-destructive. `setup.sh` installs the CPU build into
`~/.local/lib/llama.cpp/`; `setup-with-vulkan.sh` installs the Vulkan build into
a *separate* directory, `~/.local/lib/llama.cpp-vulkan/`, under a separate
binary name. Because nothing overlaps, installing or removing the Vulkan build
never disturbs the working CPU build — to remove GPU support you can simply
delete the `-vulkan` directory. You choose which one runs at launch time with an
environment variable:

```bash
BACKEND=cpu ./start-server.sh   # CPU build (the universal fallback)
BACKEND=gpu ./start-server.sh   # Vulkan build, offloads all layers to the GPU
```

In `gpu` mode the server adds `--n-gpu-layers 99`, which offloads the entire
model onto the GPU. The Vulkan installer also runs a self-check at the end that
asks llama.cpp to enumerate GPU devices, so you'll know immediately whether your
hardware is usable before you try to serve a real model.

**This setup was tuned for one specific machine.** It was developed and tested
on a **Dell XPS laptop with an Intel Core Ultra 9 288V (Lunar Lake)**, which
pairs 8 CPU cores with an **Intel Arc 140V integrated GPU** and **32 GB of
on-package "unified" LPDDR5X memory**. "Unified" means the CPU and the GPU share
the same physical memory pool rather than the GPU having its own dedicated VRAM.
That architecture is what makes GPU offload attractive here: a discrete entry-
level GPU might only have 4–8 GB of VRAM and couldn't hold a ~6.7 GB model at
all, but because the Arc iGPU can address the shared 32 GB pool, it can host the
full model with room to spare. If you're on a similar unified-memory machine
(many recent Intel and AMD laptops, for example), this same approach should
apply with little or no change.

**What to realistically expect.** On a unified-memory system the GPU and CPU
draw from the *same* memory at the *same* bandwidth, so GPU offload does not
necessarily make token *generation* dramatically faster — that phase is limited
by memory bandwidth, not raw compute. Where the GPU clearly wins is **prompt
processing** (digesting a long prompt or document before the first token), which
is compute-bound, and in **freeing up the CPU** so the rest of the laptop stays
responsive while the model is working. On machines with a genuinely more capable
GPU than this little iGPU, the generation speedup can be much larger. In other
words, Vulkan offload is worth it even on modest "unified memory" / low-end-GPU
hardware, but the benefit shows up more in latency and system responsiveness
than in a giant tokens-per-second jump.

**Requirements and caveats.** This is **Linux-only** (developed on Ubuntu) — the
scripts download prebuilt Ubuntu x86_64 binaries and rely on the system's
Mesa-provided Vulkan driver, so they do not apply to macOS or Windows. The
Vulkan path needs a reasonably **recent Mesa driver**: on brand-new GPUs (this
laptop included) the early drivers were too immature and GPU detection failed;
a later Mesa release fixed it. If `setup-with-vulkan.sh` reports that no GPU
device was found, updating your graphics/Mesa packages is the first thing to
try. The installer checks for the Vulkan loader (`libvulkan.so.1`) and an
appropriate driver up front and tells you what to install if anything is
missing. If GPU mode ever misbehaves, the CPU build is always one command away.

## Customization

### Server parameters

`start-server.sh` passes CLI flags directly to `llama-server`. You can override
settings on the command line:

```bash
./start-server.sh --port 9090 --ctx-size 8192 --threads 8
```

Common flags:
- `--port N` — HTTP port (default: 8080)
- `--ctx-size N` — Context window size in tokens (default: varies by model)
- `--threads N` — CPU threads (default: auto-detect)
- `--n-gpu-layers N` — Offload layers to GPU (Vulkan/CUDA/ROCm builds; see [Vulkan Driver](#vulkan-driver))

See `llama-server --help` for all options.
