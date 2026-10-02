export type VoiceCallStatus = { ready: boolean; transcribe: boolean };

export type VoiceCallPlan =
  | { kind: "device"; transcribe: boolean }
  | { kind: "provider"; transcribe: boolean }
  | { kind: "settings" }
  | { kind: "dictation" };

export type VoiceCallPlanDeps = {
  loadDeviceVoiceEnabled: () => Promise<boolean>;
  dictationAvailable: () => Promise<boolean>;
  loadVoiceStatus: () => Promise<VoiceCallStatus>;
  probeTimeoutMs?: number;
};

/** Optional mid-call fallback; do not wait out the full voice-status RPC timeout. */
export const DEVICE_PROVIDER_PROBE_MS = 1_000;

/**
 * Chooses the call input/output path before any provider setup is required.
 * A device voice preference is fail-closed like speakText: a read failure must
 * not turn a local-only reply into hosted voice traffic. Provider transcription
 * on a device call is only a mid-call fallback, so a status probe must not
 * block the call.
 */
export async function resolveVoiceCallPlan(deps: VoiceCallPlanDeps): Promise<VoiceCallPlan> {
  let deviceVoiceEnabled = false;
  try {
    deviceVoiceEnabled = await deps.loadDeviceVoiceEnabled();
  } catch {
    deviceVoiceEnabled = true;
  }

  const deviceDictationAvailable = deviceVoiceEnabled ? await deps.dictationAvailable() : false;
  if (deviceVoiceEnabled && deviceDictationAvailable) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const status = await Promise.race([
        deps.loadVoiceStatus(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("provider probe timed out")),
            deps.probeTimeoutMs ?? DEVICE_PROVIDER_PROBE_MS,
          );
        }),
      ]);
      if (status.ready && status.transcribe) return { kind: "device", transcribe: true };
    } catch {
      // Timeout and failure still start the device call.
    } finally {
      clearTimeout(timer);
    }
    return { kind: "device", transcribe: false };
  }

  const status = await deps.loadVoiceStatus();
  if (!status.ready) {
    return deviceVoiceEnabled ? { kind: "dictation" } : { kind: "settings" };
  }

  if (!status.transcribe) {
    const canDictate = deviceVoiceEnabled
      ? deviceDictationAvailable
      : await deps.dictationAvailable();
    if (!canDictate) return { kind: "dictation" };
  }

  return { kind: "provider", transcribe: status.transcribe };
}
