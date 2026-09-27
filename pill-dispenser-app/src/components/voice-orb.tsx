import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ORB_ACTIONS, ORB_HINTS, ORB_PALETTES, type OrbState } from '@/lib/voice-orb';

const SPHERE_SIZE = 260;
const STAGE_SIZE = SPHERE_SIZE + 44;
const NODE_SIZE = 10;

/** Breathing speed of the halo per state; `0` keeps it still. */
const PULSE_DURATIONS: Record<OrbState, number> = {
  idle: 3000,
  connecting: 900,
  listening: 1200,
  speaking: 620,
  linking: 1100,
  offline: 0,
};

type VoiceOrbProps = {
  state: OrbState;
  /** True while the dispenser link is down or a conversation is being ended. */
  disabled?: boolean;
  onPress: () => void;
};

/**
 * The sphere that starts a spoken conversation with the medication assistant.
 *
 * Palette, hint and animations follow `state`, so the sphere doubles as the
 * status display of the front page. Animations use `Animated` with the native
 * driver; nothing here needs a worklet.
 */
export function VoiceOrb({ state, disabled = false, onPress }: VoiceOrbProps) {
  const palette = ORB_PALETTES[state];
  const pulse = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const duration = PULSE_DURATIONS[state];
    if (duration === 0) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [state, pulse]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [orbit]);

  const living = state !== 'idle' && state !== 'offline';

  return (
    <View style={styles.container}>
      <View style={styles.stage}>
        <Animated.View
          style={[
            styles.halo,
            {
              backgroundColor: palette.glow,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.46] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.16] }) },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.orbit,
            {
              borderColor: palette.ring,
              transform: [
                {
                  rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
                },
              ],
            },
          ]}>
          <View style={[styles.orbitNode, { backgroundColor: palette.node }]} />
        </Animated.View>

        <Pressable
          accessibilityLabel={ORB_ACTIONS[state]}
          accessibilityHint={ORB_HINTS[state]}
          accessibilityRole="button"
          accessibilityState={{ busy: living, disabled }}
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => [
            styles.pressable,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}>
          <Animated.View
            style={[
              styles.sphere,
              {
                experimental_backgroundImage: `linear-gradient(160deg, ${palette.core[0]}, ${palette.core[1]})`,
                transform: [
                  {
                    scale: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, living ? 1.07 : 1.02],
                    }),
                  },
                ],
              },
            ]}>
            <View style={styles.specular} />
          </Animated.View>
        </Pressable>
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {ORB_HINTS[state]}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
    width: STAGE_SIZE,
    height: STAGE_SIZE,
  },
  halo: {
    position: 'absolute',
    width: STAGE_SIZE,
    height: STAGE_SIZE,
    borderRadius: STAGE_SIZE / 2,
  },
  orbit: {
    position: 'absolute',
    width: STAGE_SIZE,
    height: STAGE_SIZE,
    borderRadius: STAGE_SIZE / 2,
    borderWidth: 1.5,
  },
  orbitNode: {
    position: 'absolute',
    top: 0,
    left: STAGE_SIZE / 2 - NODE_SIZE / 2,
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
  },
  pressable: {
    borderRadius: SPHERE_SIZE / 2,
  },
  sphere: {
    width: SPHERE_SIZE,
    height: SPHERE_SIZE,
    borderRadius: SPHERE_SIZE / 2,
    overflow: 'hidden',
  },
  specular: {
    marginTop: 26,
    marginLeft: 30,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
  hint: {
    marginTop: 20,
    maxWidth: STAGE_SIZE + Spacing.five,
    textAlign: 'center',
  },
});
