import { Image, type ImageStyle, type StyleProp } from 'react-native';

type Props = {
  size?: number;
  /** Si true, muestra el mock completo (fondo blanco), como en _cap-A-login. */
  framed?: boolean;
  style?: StyleProp<ImageStyle>;
};

/**
 * Isologo COSP Guardia — misma geometría del mock A; colores según assets actuales.
 * `framed`: icono completo (fondo incluido). Sin framed: solo la marca transparente.
 */
export function BacarIsologo({ size = 64, framed = false, style }: Props) {
  return (
    <Image
      source={
        framed
          ? require('../../../assets/icon.png')
          : require('../../../assets/bacar-mark.png')
      }
      style={[{ width: size, height: size, borderRadius: framed ? 16 : 0 }, style]}
      resizeMode="contain"
      accessibilityLabel="COSP Guardia"
    />
  );
}
