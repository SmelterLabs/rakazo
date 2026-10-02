import { describe, expect, it, vi } from "vitest";
import { resolveVoiceCallPlan, type VoiceCallStatus } from "./voice-call-entry";

function deps(options: { deviceVoice: boolean; dictation: boolean; status: VoiceCallStatus }) {
  return {
    loadDeviceVoiceEnabled: vi.fn(async () => options.deviceVoice),
    dictationAvailable: vi.fn(async () => options.dictation),
    loadVoiceStatus: vi.fn(async () => options.status),
  };
}

describe("mobile voice call entry", () => {
  it("starts a device-only call without asking the API for provider readiness", async () => {
    const fakes = deps({
      deviceVoice: true,
      dictation: true,
      status: { ready: false, transcribe: false },
    });

    await expect(resolveVoiceCallPlan(fakes)).resolves.toEqual({
      kind: "device",
      transcribe: false,
    });
    expect(fakes.loadVoiceStatus).not.toHaveBeenCalled();
  });

  it("reports missing speech recognition instead of opening provider setup", async () => {
    const fakes = deps({
      deviceVoice: true,
      dictation: false,
      status: { ready: false, transcribe: false },
    });

    await expect(resolveVoiceCallPlan(fakes)).resolves.toEqual({ kind: "dictation" });
    expect(fakes.loadVoiceStatus).toHaveBeenCalledOnce();
  });

  it("keeps the normal cloud provider path when device voice is off", async () => {
    const fakes = deps({
      deviceVoice: false,
      dictation: false,
      status: { ready: true, transcribe: true },
    });

    await expect(resolveVoiceCallPlan(fakes)).resolves.toEqual({
      kind: "provider",
      transcribe: true,
    });
    expect(fakes.dictationAvailable).not.toHaveBeenCalled();
  });

  it("keeps provider setup when only on-device dictation is available", async () => {
    const fakes = deps({
      deviceVoice: false,
      dictation: true,
      status: { ready: false, transcribe: false },
    });

    await expect(resolveVoiceCallPlan(fakes)).resolves.toEqual({ kind: "settings" });
    expect(fakes.dictationAvailable).not.toHaveBeenCalled();
  });

  it("falls back to provider transcription when local dictation is unavailable", async () => {
    const fakes = deps({
      deviceVoice: true,
      dictation: false,
      status: { ready: true, transcribe: true },
    });

    await expect(resolveVoiceCallPlan(fakes)).resolves.toEqual({
      kind: "provider",
      transcribe: true,
    });
  });

  it("uses on-device dictation with a configured speak-only provider", async () => {
    const fakes = deps({
      deviceVoice: false,
      dictation: true,
      status: { ready: true, transcribe: false },
    });

    await expect(resolveVoiceCallPlan(fakes)).resolves.toEqual({
      kind: "provider",
      transcribe: false,
    });
    expect(fakes.dictationAvailable).toHaveBeenCalledOnce();
  });

  it("fails closed to device voice if its preference cannot be read", async () => {
    const fakes = deps({
      deviceVoice: true,
      dictation: true,
      status: { ready: false, transcribe: false },
    });
    fakes.loadDeviceVoiceEnabled.mockRejectedValueOnce(new Error("device locked"));

    await expect(resolveVoiceCallPlan(fakes)).resolves.toEqual({
      kind: "device",
      transcribe: false,
    });
    expect(fakes.loadVoiceStatus).not.toHaveBeenCalled();
  });
});
