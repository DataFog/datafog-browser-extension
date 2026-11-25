# Local PDF extraction notices

This extension bundles @llamaindex/liteparse-wasm 2.21.1, Apache License 2.0,
source revision b2ca8f00e8c0b8e78c4e40bd0c2a60ce9d48f3f2. The complete license
is supplied in licenses/liteparse/LICENSE and pdf/LITEPARSE-LICENSE.txt.
Source: https://github.com/run-llama/liteparse/tree/b2ca8f00e8c0b8e78c4e40bd0c2a60ce9d48f3f2

OCRia-nano-1 model release v1.0.0, copyright LlamaIndex, Inc., is supplied under
its custom OCRia-nano-1 MODEL LICENSE, reproduced without modification at
assets/ocria/LICENSE. Its terms, including Section 5 and Attachment A use
restrictions, govern every use of the bundled model and its output. Section 5 and Attachment A apply to downstream users of the model. The extension's MIT license does
not supersede the model license. The model license distinguishes personal/research use, revenue, total funding,
and competing services; revenue alone is not the complete eligibility test.
Source: https://huggingface.co/llamaindex/OCRia-nano-1/tree/v1.0.0

Only the detector, script router, Latin recognizer and associated metadata are
bundled. LayoutNet and CJK/RTL/world recognizers are disabled. Build-time SHA-256
checks and LiteParse's runtime verification enforce release-compatible model
bytes. The worker loads these assets locally.

PDF processing runs lazily in a dedicated local module worker, in single-page
batches. Cancellation terminates the worker and releases its document/model
memory. Normal completion also terminates it. Input is limited to 50 MB and 100
pages. Password-protected documents are unsupported. Extraction errors and
empty pages are reported for review. OCR can omit or misread content, including
accents, handwriting, complex tables and unusual fonts: compare against the
source. Coordinates are top-left page points. Native/OCR overlap reconciliation
is performed by LiteParse. Repeated occurrences at distinct positions survive.

Synthetic fixtures under e2e/pdf-fixtures were generated for this project; they
contain invented names/addresses and a reserved example.com email. No customer
documents or third-party PDF fixtures are redistributed.

Embedded PDFium chromium/8172 and its bundled fonts/libraries have their original
notices in licenses/liteparse/pdfium. Rust dependency notices and pinned source
inventory are retained in licenses/liteparse/rust; this conservative inventory
also includes optional/native/build dependencies not used by the WASM target.
Identical license bytes are stored once, with per-package mappings retained.
