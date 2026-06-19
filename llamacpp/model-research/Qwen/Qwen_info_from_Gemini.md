### The Most Powerful Option: Qwen3.6-35B-A3B (MoE)

If your strict requirement is maintaining at least 10 tokens per second (TPS), the **Qwen3.6-35B-A3B** at a 4-bit quantization (such as Q4_K_M) is the absolute most powerful model your machine can run.

Here is how the math breaks down for your specific Lunar Lake architecture using `llama.cpp` and the Vulkan backend on your Arc 140V.

### The Memory Bandwidth Bottleneck

The defining limitation for local LLM inference is not raw compute, but memory bandwidth. The Intel Core Ultra 9 288V features exceptionally fast on-package memory, but its maximum bandwidth is capped at **136 GB/s**. During autoregressive generation, the entire active weight of the model must be streamed through this memory bus for every single token.

* **Dense Models (e.g., Qwen3.6-27B or Qwen 2.5 14B):** * A 27B dense model at 4-bit is roughly 16 GB. Pushing 16 GB through a 136 GB/s pipe yields a theoretical maximum of 8.5 TPS. In reality, software overhead drops this to around **5–7 TPS**, failing your requirement.
* A 14B dense model is roughly 8.5 GB. This gets a theoretical max of 16 TPS, translating to roughly **8–12 TPS** in reality. It hovers right on the edge of your requirement.


* **Mixture of Experts (e.g., Qwen3.6-35B-A3B):** * While the total static model size is ~23 GB (which safely fits in your 32 GiB unified RAM while leaving room for Ubuntu and the KV cache), it only activates **3 billion parameters per token**.
* This means `llama.cpp` only needs to pull about 1.5 to 2 GB of active weights through memory per token. Even with the routing overhead inherent to MoE architectures, you will easily achieve **20+ TPS**.



### Configuration Recommendations for Ubuntu

To maximize this specific model on your setup:

1. **Vulkan Offloading:** Ensure you offload all layers to the Arc 140V iGPU using the standard flags (e.g., `-ngl 99`).
2. **Context Management:** With ~23 GB dedicated to the weights, you have roughly 6-8 GB of usable memory left before you risk OS swapping. Keep your context window conservative (e.g., 8K or 16K) to prevent `llama.cpp` from overflowing your remaining RAM. Swapping to disk will instantly tank your TPS to single digits.


The Qwen3.6-35B-A3B is the definitive answer: it delivers the reasoning and coding power of a heavyweight 35B parameter model while generating tokens at the speed of a lightweight 3B model, perfectly leveraging your hardware's capabilities.