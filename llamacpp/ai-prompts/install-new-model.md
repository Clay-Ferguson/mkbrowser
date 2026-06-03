# Objective: Setup "Gemma 4 12B"

if you look in the folder named `llamacpp` in this project, you'll find the files related to how we install and run a local LLM that the MkBrowser can make use of for supporting its AI features. there's not too many files in that folder so please read all of them to get a full understanding of how things work. you'll notice that we've currently got "Gemma 4 E4B" installed and activated so that it's what gets run by the `start-server.sh` script.

google has just released a new better version of Gemma named "Gemma 4 12B", and I would like for you to switch over to where we know use that model. you can use the following two resources (web links below) to figure out where to download the model file from, as necessary, although I think our `llama.cpp` server may automatically download it itself, as long as we've configured it to do so.

https://developers.googleblog.com/gemma-4-12b-the-developer-guide/

https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12B/

be sure not to destroy our ability to revert back to the current 'E4B' model, because the way we should have our bash scripts set up, is that we should simply be able to comment out the old environment variables associated with the old model, and then define new environment variable setters that set the model values to where it will download the new model that we want. you can probably just follow the examples in the script because we're already doing this type of thing where we can easily switch from one model to another simply by uncommenting specific environment variable setters in our bash scripts.

so please update my scripts and then let me know what I need to run in order to get `start-server.sh` to begin serving up the new "Gemma 4 12B" model.