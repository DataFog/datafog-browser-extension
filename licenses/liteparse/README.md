# LiteParse binary notices

LiteParse 2.21.1, source commit b2ca8f00e8c0b8e78c4e40bd0c2a60ce9d48f3f2.
`LICENSE` is the upstream root Apache-2.0 license (the npm distribution omits it).

`pdfium/` contains the complete notices distributed with the pinned
chromium/8172 `pdfium-wasi-wasm.tgz` release, including the bundled fonts and
image/font libraries. Download source:
https://github.com/run-llama/pdfium-binaries/releases/download/chromium%2F8172/pdfium-wasi-wasm.tgz

`rust/inventory.json` maps every registry package in the pinned upstream
Cargo.lock to its retained license/copyright/notice files. This is deliberately
a conservative superset; it includes build-time, native-platform and optional
packages not linked into the WASM artifact. It is not an assertion that every
listed package is used by this extension. Crate archives were verified against
the lockfile SHA-256 before extracting notices. Missing crate license files were
supplemented from their upstream repositories, with source URLs recorded in the
inventory, or from the same project's sibling crate as explicitly noted.

Identical file bytes are deduplicated under `rust/texts/<sha256>.txt`; all original
paths, package names, versions and attribution text remain in the inventory.
No copyright or attribution text was stripped during deduplication.
