#!/usr/bin/env bash

# Check what's running insidie ollama (don't worry if nothing is shown, Stuff gets loaded on 
# demand when you run `ollama run` or `ollama chat` commands, so it's normal for nothing to be 
# running until you do that)
ollama ps

# Query model info about a given running model (in this case 'qwen-silent' which is the custom 
# version of qwen2.5:7b that we set up in `ollama/configure.sh`)
ollama show qwen-silent --modelfile

# TIP: Run this to monitor CPU use during inference
#     watch -n 1 "grep 'cpu MHz' /proc/cpuinfo"


# To monitor GPU status
#     sudo apt install intel-gpu-tools
#     sudo intel_gpu_top

# To monitor temperature:
#    sudo apt install btop
#    btop