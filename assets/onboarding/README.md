# Onboarding clips

These three silent clips show the actual extension UI in an isolated, local chat fixture. The address `avery.morgan@northpine.studio` and proposal follow-up are fictional demonstration content. No message was sent, no real account or vault was used, and the fixture served the chat page locally.

- `replace.webm`: paste the draft, review the single email finding, and Replace it with a saved token.
- `originals.webm`: reveal the original address in an answer, including the 140 ms value fade.
- `copy.webm`: use Copy with originals and paste the actual clipboard text into an email draft.

The Replace clip runs for 6 seconds, with the original captured sequence slowed to make the draft and review popup easier to follow. The other two clips run for 3 seconds each. All clips are 420 × 360 pixels, 30 fps, VP9 WebM, with no audio track. Matching PNG files show the Replace review or completed result for paused or reduced-motion viewing. Only the surrounding fictional chat/email fixture and pointer are presentation styling; the extension controls and actions are real.

Capture used the repository's extension test fixture with a fresh temporary browser profile and a temporary build. Timestamped screenshots were encoded with FFmpeg; the capture asserted replacement, clipboard contents and zero sends. Temporary capture scripts and frame evidence are kept under the ignored `.playwright/` directory rather than shipped as runtime code.
