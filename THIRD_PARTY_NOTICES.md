# Third-party notices

This extension bundles the following software, models and interface assets. Their licenses are included in the distribution alongside the extension's own `LICENSE`.

## Lucide 1.75.0

Lucide icons are licensed under the ISC License, copyright 2026 Lucide Icons and Contributors. Some icons are derived from Feather and also carry the MIT License, copyright 2013-present Cole Bemis. The complete upstream notice, including both licenses and the list of Feather-derived icons, is in [licenses/lucide-LICENSE.txt](licenses/lucide-LICENSE.txt).

## Geist and Geist Mono

The bundled Geist fonts are licensed under the SIL Open Font License 1.1, copyright 2024 The Geist Project Authors. The complete copyright and license text is in [fonts/OFL.txt](fonts/OFL.txt).

Existing FogVault dependency notices remain included under `fogvault/third-party/` in the built extension.

## PDF extraction and Rampart detector

LiteParse and its bundled OCRia Latin model assets are described in [PDF_NOTICES.md](PDF_NOTICES.md).

Rampart SDK **0.1.3** and the quantized model at Hugging Face revision
`b1993e4e68b082835b80ffc65acc03325ea2e501` are by **National Design Studio**,
licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Source: https://github.com/nationaldesignstudio/rampart and
https://huggingface.co/nationaldesignstudio/rampart.
The extension adapts model spans to Core entity types and uses DataFog's
user-selected policy instead of the SDK's default keep-set. Model weights are
unmodified; asset SHA-256 checksums are in `assets/rampart/manifest.json` in source.
Upstream training corpus: AI4Privacy `pii-masking-openpii-1.5m` (CC BY 4.0).

The worker also bundles Hugging Face **Transformers.js 3.7.5** (Apache 2.0;
`licenses/rampart/TRANSFORMERS-LICENSE`) and Microsoft **ONNX Runtime Web
1.22.0-dev.20250409-89f8206ba4** (MIT;
`licenses/rampart/ORT-LICENSE`). Their code and WASM are loaded locally.
