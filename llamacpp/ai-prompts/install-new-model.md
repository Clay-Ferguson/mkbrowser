# Objective: Setup "Gemma 4 12B"

Instructions to Coding Agent for refactoring our llamacpp setup.

## Phase 1 (completed)

if you look in the folder named `llamacpp` in this project, you'll find the files related to how we install and run a local LLM that the MkBrowser can make use of for supporting its AI features. there's not too many files in that folder so please read all of them to get a full understanding of how things work. you'll notice that we've currently got "Gemma 4 E4B" installed and activated so that it's what gets run by the `start-server.sh` script.

google has just released a new better version of Gemma named "Gemma 4 12B", and I would like for you to switch over to where we know use that model. you can use the following two resources (web links below) to figure out where to download the model file from, as necessary, although I think our `llama.cpp` server may automatically download it itself, as long as we've configured it to do so.

https://developers.googleblog.com/gemma-4-12b-the-developer-guide/

https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12B/

be sure not to destroy our ability to revert back to the current 'E4B' model, because the way we should have our bash scripts set up, is that we should simply be able to comment out the old environment variables associated with the old model, and then define new environment variable setters that set the model values to where it will download the new model that we want. you can probably just follow the examples in the script because we're already doing this type of thing where we can easily switch from one model to another simply by uncommenting specific environment variable setters in our bash scripts.

so please update my scripts and then let me know what I need to run in order to get `start-server.sh` to begin serving up the new "Gemma 4 12B" model.

## Phase 2 (current)

i'm writing this phase 2, because a couple of days after we completed phase 1 above, google released a new "QAT" version of the 'Gemma 4 12B' model, which runs on significantly less memory and potentially runs faster. so what I would like you to do in Phase 2 is to create another new configuration in our bash scripts, in this project, which we'll install and run the QAT version. as we did in Phase 1, I would like for you to also be sure to keep the old stuff commented out in the shell scripts so that it's easy to go back to that configuration in the future if necessary.

here are the links you should read two no exactly what I'm talking about and where to get the new models from, because you won't know that from your built-in knowledge and will have to refer to these resources on the web:

https://x.com/UnslothAI/status/2062931482746994755?s=20

https://huggingface.co/collections/unsloth/gemma-4-qat

https://unsloth.ai/docs/models/gemma-4/qat

https://blog.google/innovation-and-ai/technology/developers-tools/quantization-aware-training-gemma-4/