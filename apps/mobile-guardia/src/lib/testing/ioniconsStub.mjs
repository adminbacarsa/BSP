/** Stub de Ionicons para tests de render (solo el ícono como texto). */
import React from 'react';

export const Ionicons = (props) =>
  React.createElement('span', { 'data-icon': props.name, 'aria-hidden': true }, '');

export default { Ionicons };
