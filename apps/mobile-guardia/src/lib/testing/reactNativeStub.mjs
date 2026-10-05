/**
 * Stub mínimo de `react-native` para renderizar con react-dom/server en Node.
 * Solo lo que usan las tarjetas: View, Text, Pressable, StyleSheet, Platform, ActivityIndicator.
 */
import React from 'react';

function flattenStyle(style) {
  if (!style) return undefined;
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle).filter(Boolean));
  if (typeof style === 'function') return flattenStyle(style({ pressed: false }));
  return style;
}

function domProps(props, extra = {}) {
  const { testID, style, accessibilityLabel, accessibilityRole, numberOfLines, children } = props;
  return {
    'data-testid': testID,
    'aria-label': accessibilityLabel,
    role: accessibilityRole,
    'data-lines': numberOfLines,
    style: flattenStyle(style),
    children,
    ...extra,
  };
}

export const View = (props) => React.createElement('div', domProps(props));
export const Text = (props) => React.createElement('span', domProps(props));
export const ScrollView = View;
export const ActivityIndicator = () => React.createElement('span', { 'data-testid': 'spinner' }, '…');
export const Pressable = (props) => {
  const { onPress, disabled, children } = props;
  const content = typeof children === 'function' ? children({ pressed: false }) : children;
  return React.createElement('button', {
    ...domProps({ ...props, children: undefined }, { disabled: !!disabled, onClick: onPress }),
    children: content,
  });
};
export const TouchableOpacity = Pressable;
export const StyleSheet = {
  create: (styles) => styles,
  flatten: flattenStyle,
  hairlineWidth: 1,
  absoluteFill: {},
};
export const Platform = { OS: 'web', select: (o) => (o.web !== undefined ? o.web : o.default) };
export const Dimensions = { get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) };
export const useWindowDimensions = () => ({ width: 390, height: 844, scale: 3, fontScale: 1 });
export const Linking = { openURL: async () => {} };
export default { View, Text, Pressable, StyleSheet, Platform };
