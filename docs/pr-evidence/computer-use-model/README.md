# PR 2745: fixture-backed component evidence

These are genuine Chromium captures of the unchanged web `ComputerModelSettings` component and shipped application CSS at source `e609d82f44901ef5db49827cce7b1266aeb20a77`. The subsequent `7fda922302879d54fa59a4c89d75884f23f6557c` changes only two mobile test fixtures, not the pictured component.

The surrounding layout and account/connection data are synthetic fixtures, visibly labeled in each image. Browser assertions exercised the actual controls, exact selection/scope identity, medium effort, inheritance versus explicit main, and fixture-backed reload persistence. No production cookies, credentials or customer data were used. This evidence is not a full-app, backend-persistence, mobile-device or OS-native acceptance claim.

- `01-cross-provider-fixture.png`: a Claude source connection with a separate GPT computer model through a ChatGPT connection, medium effort.
- `02-bot-inherit-main-fixture.png`: bot inheritance and explicit same-main selection are distinct.
