import type { AiRecipient } from "@rakazo/contracts";
import { AI_DATA_DISCLOSURES, AI_PRIVACY_URL } from "@rakazo/contracts";
import { Alert, AppState, Linking } from "react-native";

export function promptAiConsent(
  recipient: AiRecipient,
  privacyUrl = AI_PRIVACY_URL,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let dialogOpen = false;
    let waitingForPrivacyReturn = false;
    let scheduledShow: ReturnType<typeof setTimeout> | undefined;

    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !waitingForPrivacyReturn || settled) return;
      waitingForPrivacyReturn = false;
      showWhenReady();
    });

    const cleanup = () => {
      subscription.remove();
      if (scheduledShow !== undefined) clearTimeout(scheduledShow);
    };

    const finish = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(allowed);
    };

    const scheduleShow = () => {
      if (settled || waitingForPrivacyReturn || scheduledShow !== undefined) return;
      scheduledShow = setTimeout(() => {
        scheduledShow = undefined;
        show();
      }, 0);
    };

    const showWhenReady = () => {
      if (settled || waitingForPrivacyReturn || dialogOpen) return;
      scheduleShow();
    };

    const show = () => {
      if (settled || waitingForPrivacyReturn || dialogOpen) return;
      dialogOpen = true;
      let privacyPolicyPressed = false;
      Alert.alert(
        `Share data with ${recipient.name}?`,
        [
          recipient.detail,
          AI_DATA_DISCLOSURES[recipient.use],
          "You can withdraw permission for new mobile actions in Account → AI data sharing.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        [
          { text: "Not now", style: "cancel", onPress: () => finish(false) },
          {
            text: "Privacy policy",
            onPress: () => {
              // The button callback is the deterministic lifecycle point on both platforms.
              // RN only maps onDismiss on Android, and Android consumes a button callback
              // instead of sending a second dismissed action.
              privacyPolicyPressed = true;
              dialogOpen = false;
              waitingForPrivacyReturn = true;
              void Linking.openURL(privacyUrl).catch(() => {
                waitingForPrivacyReturn = false;
                showWhenReady();
              });
            },
          },
          { text: "Allow", onPress: () => finish(true) },
        ],
        {
          cancelable: true,
          onDismiss: () => {
            if (privacyPolicyPressed) return;
            dialogOpen = false;
            if (settled) return;
            finish(false);
          },
        },
      );
    };

    show();
  });
}
