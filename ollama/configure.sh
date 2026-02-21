#!/usr/bin/env bash

# This script creates a more 'custom' version of the qwen2.5:7b model (named quen-silent) that runs silently 
# with 4 threads, and verifies it's working.
#
# NOTE: the script is intended to be run after you've already gotten the `setup.sh` script working. 
# It assumes you have Ollama installed and the server running, and it just configures the model and verifies it's working.


# 1. Create your custom silent version
# (Make sure you are in the same folder as your 'Modelfile')
ollama create qwen-silent -f Modelfile

# 2. Run it to verify it works (this will also 'preload' it)
ollama run qwen-silent "Quick test: are you running with 4 threads?"
