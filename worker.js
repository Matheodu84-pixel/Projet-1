// Web Worker — exécute SmolVLM entièrement dans le navigateur.
// Transformers.js v3 met automatiquement en cache les poids du modèle
// (Cache API « transformers-cache »), donc tout fonctionne hors ligne
// après le premier téléchargement.
import {
  AutoProcessor,
  AutoModelForVision2Seq,
  TextStreamer,
  InterruptableStoppingCriteria,
  load_image,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1";

// On ne charge que des modèles distants (depuis le Hub), mis en cache navigateur.
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "HuggingFaceTB/SmolVLM-256M-Instruct";
const MAX_NEW_TOKENS = 768;

async function pickDevice() {
  try {
    if (!navigator.gpu) return "wasm";
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

class SmolVLM {
  static processor = null;
  static model = null;
  static device = null;

  static async getInstance(progress_callback = null) {
    this.device ??= await pickDevice();

    this.processor ??= AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback,
    });

    this.model ??= AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
      dtype: "fp32",
      device: this.device,
      progress_callback,
    });

    return Promise.all([this.processor, this.model]);
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();

async function load() {
  self.postMessage({ status: "loading" });
  await SmolVLM.getInstance((x) => self.postMessage(x));
  self.postMessage({ status: "ready", device: SmolVLM.device });
}

async function generate({ image, prompt }) {
  const [processor, model] = await SmolVLM.getInstance();

  const messages = [
    {
      role: "user",
      content: [{ type: "image", image }, { type: "text", text: prompt }],
    },
  ];

  const img = await load_image(image);
  const text = processor.apply_chat_template(messages, {
    add_generation_prompt: true,
  });
  const inputs = await processor(text, [img]);

  const streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (output) => self.postMessage({ status: "update", output }),
  });

  self.postMessage({ status: "start" });

  try {
    const { sequences } = await model.generate({
      ...inputs,
      do_sample: false,
      repetition_penalty: 1.1,
      max_new_tokens: MAX_NEW_TOKENS,
      streamer,
      stopping_criteria,
      return_dict_in_generate: true,
    });

    const decoded = processor.batch_decode(sequences, {
      skip_special_tokens: true,
    });
    self.postMessage({ status: "complete", output: decoded[0] ?? "" });
  } catch (e) {
    self.postMessage({ status: "error", data: String(e?.message || e) });
  }
}

self.addEventListener("message", (e) => {
  const { type, data } = e.data;
  switch (type) {
    case "load":
      load().catch((err) =>
        self.postMessage({ status: "error", data: String(err?.message || err) }),
      );
      break;
    case "generate":
      stopping_criteria.reset();
      generate(data);
      break;
    case "interrupt":
      stopping_criteria.interrupt();
      break;
  }
});
