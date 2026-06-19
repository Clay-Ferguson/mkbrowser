# Most Powerful Qwen Model for Dell XPS 13 9350 (Lunar Lake) at >=10 TPS

## Hardware

- Dell XPS 13 9350
- Intel Core Ultra 9 288V (Lunar Lake), Arc 140V iGPU + NPU
- 32 GiB on-package LPDDR5X RAM (unified)
- Ubuntu 24.04.4 LTS
- Inference stack: llama.cpp + Vulkan

## The constraint: 136.5 GB/s memory bandwidth

Token generation is almost entirely **memory-bandwidth-bound**. The 288V has
LPDDR5X-8533 on-package = **136.5 GB/s** theoretical peak (real-world ~100-120
GB/s through Vulkan). Every token, the GPU must read the *active* weights from
that memory, so:

**TPS ~= bandwidth / (active params x bytes-per-param)**

At Q4 (~0.55 bytes/param), here is where each Qwen3.6 lands:

| Model | Active params | Read/token @ Q4 | Theoretical ceiling | Realistic TPS | Fits 32 GB? |
|---|---|---|---|---|---|
| **Qwen3.6-35B-A3B** (MoE) | ~3B | ~1.7 GB | ~80 tok/s | **~25-40 tok/s** (PASS) | ~21 GB (yes) |
| **Qwen3.6-27B** (dense) | 27.8B | ~15 GB | ~9 tok/s | **~5-8 tok/s** (FAIL) | ~16 GB (yes) |

## Answer: Qwen3.6-35B-A3B

The dense **27B is the slightly more capable model on paper** (77.2 vs 73.4
SWE-bench), but it is a dense model -- it has to stream all ~28B params per
token, which runs straight into the 136.5 GB/s wall at **~5-8 TPS**. It busts
the 10-TPS floor. It would *fit* in memory fine; it just is not fast enough.

The **35B-A3B MoE only touches ~3B params per token**, so the same bandwidth
gives **comfortably 2-4x the 10-TPS minimum** -- and it is still a near-flagship
coding model, far stronger than any small dense Qwen that could run faster.
That is the sweet spot: most powerful Qwen that clears 10 TPS.

Same conclusion as the Gemma comparison: on bandwidth-limited unified memory,
**sparse MoE wins, dense loses.**

## Practical setup notes for Arc 140V

Real gotchas from llama.cpp Vulkan + Lunar Lake reports:

1. **Memory fit is tight.** 35B-A3B at `Q4_K_M` is ~21 GB. With the iGPU sharing
   the 32 GB and needing room for OS + KV cache, prefer **`IQ4_XS` (~19 GB)** and
   keep context modest (16-32K) to start.
2. **Known k-quant crash on Arc 140V Xe2.** Open llama.cpp issues report K-quants
   crashing on this iGPU. Workarounds: set **`OLLAMA_FLASH_ATTENTION=0`** (or
   `--flash-attn off` in llama.cpp), and prefer **IQ-quants** over K-quants here.
   Test before committing.
3. **Prompt processing:** use **`-b 256`** -- reported to significantly improve
   pp512 throughput for A3B models on the Vulkan backend.
4. **Build with the Vulkan backend** (already in use) and confirm the iGPU is the
   offload target.

**Recommended:** grab `Qwen3.6-35B-A3B` in **IQ4_XS**, run with flash-attn off
and `-b 256`, modest context. Expect ~25-40 TPS -- well above the 10-TPS bar --
with the most capability extractable from this laptop.

**Honesty caveat:** the TPS figures are bandwidth-math estimates; no published
Arc 140V benchmark exists for this exact model. The architecture verdict (MoE
yes, dense no) is solid, but measure real throughput once loaded.

## Sources

- [Core Ultra 9 288V specs -- 136.5 GB/s LPDDR5X (TechPowerUp)](https://www.techpowerup.com/cpu-specs/core-ultra-9-288v.c3755)
- [Run Qwen3.6-35B-A3B on llama.cpp ~30 tps (Medium)](https://mychen76.medium.com/run-qwen3-6-35b-a3b-on-6gb-vram-using-llama-cpp-30-tps-a89032e5a60c)
- [llama.cpp Vulkan k-quant crash on Intel Arc iGPU (GitHub issue)](https://github.com/ggml-org/llama.cpp/issues/19887)
- [Qwen3.6-27B vs 35B-A3B -- dense vs MoE (aimadetools)](https://www.aimadetools.com/blog/qwen-3-6-27b-vs-35b-a3b/)
- [Intel Arc 140V benchmarks (Notebookcheck)](https://www.notebookcheck.net/Intel-Arc-Graphics-140V-Benchmarks-and-Specs.854991.0.html)
