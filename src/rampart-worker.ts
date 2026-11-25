import { env } from "@huggingface/transformers";
import { rampartModelInput } from "./rampart-input";
import {
  detectNer,
  loadNerClassifier,
  detectHeuristics,
  premask,
  projectMaskedSpan,
} from "@nationaldesignstudio/rampart";

// Every executable and weight is extension-local. No Hub or CDN fallback.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = new URL("./", import.meta.url).href;
env.backends.onnx.wasm!.wasmPaths = new URL("./", import.meta.url).href;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
const classifier = loadNerClassifier({ model: "model", device: "wasm" });
let queue = Promise.resolve();
self.addEventListener(
  "message",
  ({ data }: MessageEvent<{ id: number; text: string }>) => {
    queue = queue.then(async () => {
      try {
        const loaded = await classifier;
        // Normalize before heuristic premasking so a UUID cannot first become
        // disjoint fragments. All replacements preserve original UTF-16 length.
        const input = rampartModelInput(data.text);
        const map = premask(input, detectHeuristics(input));
        const detected = await detectNer(map.masked, loaded);
        const spans = detected.flatMap((span) => {
          const projected = projectMaskedSpan(span, data.text, map);
          return projected ? [projected] : [];
        });
        self.postMessage({ id: data.id, spans }, { transfer: [] });
      } catch {
        self.postMessage(
          { id: data.id, error: "rampart_failed" },
          { transfer: [] },
        );
      }
    });
  },
);
