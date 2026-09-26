import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SAMPLE_MEDICINE, type MedicineRecord } from '@/lib/medicine';

type SampleMedicineButtonProps = {
  connected: boolean;
  sendMedicine: (record: MedicineRecord) => Promise<void>;
};

/** Sends the fixed {@link SAMPLE_MEDICINE} packet so the link can be smoke-tested. */
export function SampleMedicineButton({ connected, sendMedicine }: SampleMedicineButtonProps) {
  const theme = useTheme();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const send = async () => {
    setFeedback(null);
    setIsSending(true);
    try {
      await sendMedicine(SAMPLE_MEDICINE);
      setFeedback(`Sent ${SAMPLE_MEDICINE.medicine} for ${SAMPLE_MEDICINE.data[0].time}.`);
    } catch (sendError) {
      setFeedback(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        disabled={!connected || isSending}
        onPress={() => {
          void send();
        }}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.backgroundSelected },
          (!connected || isSending) && styles.disabled,
          pressed && styles.pressed,
        ]}>
        {isSending ? (
          <ActivityIndicator color={theme.textSecondary} />
        ) : (
          <ThemedText type="smallBold">Send sample packet</ThemedText>
        )}
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">
        Vitamin A at 10:00 UTC, 1 dose.
      </ThemedText>
      {feedback !== null && (
        <ThemedText type="small" themeColor="textSecondary">
          {feedback}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  button: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
});
