import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { G, Line } from 'react-native-svg';
import { BacarIsologo } from './BacarIsologo';

type Props = {
  size?: number;
  markSize?: number;
};

const SEGMENT_COUNT = 36;

/**
 * Loader: isologo Bacar (mock) + anillo de rayas girando en rojos de marca.
 */
export function BacarLoadingMark({ size = 120, markSize = 52 }: Props) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.44;
  const rInner = size * 0.36;

  const ticks = Array.from({ length: SEGMENT_COUNT }, (_, i) => {
    const angle = (i / SEGMENT_COUNT) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * rInner;
    const y1 = cy + Math.sin(angle) * rInner;
    const x2 = cx + Math.cos(angle) * rOuter;
    const y2 = cy + Math.sin(angle) * rOuter;
    const t = i / SEGMENT_COUNT;
    const opacity = 0.12 + 0.88 * Math.pow(t, 1.35);
    const color = t > 0.55 ? '#D32F2F' : '#8B1A1A';
    return { x1, y1, x2, y2, opacity, color, key: i };
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <Svg width={size} height={size}>
          <G>
            {ticks.map((tick) => (
              <Line
                key={tick.key}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                stroke={tick.color}
                strokeWidth={3.2}
                strokeLinecap="round"
                opacity={tick.opacity}
              />
            ))}
          </G>
        </Svg>
      </Animated.View>
      <View style={styles.mark}>
        <BacarIsologo size={markSize} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
