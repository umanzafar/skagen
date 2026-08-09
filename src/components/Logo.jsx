import React from 'react';
import { BRAND } from '../theme';
import logoImg from '../assets/logo.jpg';

// Real brand mark (yellow field, navy comet, black aperture/bar-chart icon).
export default function Logo({ size = 44, radius = 12 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      overflow: 'hidden', flexShrink: 0,
      boxShadow: `0 4px 14px ${BRAND.navy}55`
    }}>
      <img src={logoImg} alt="Skagen" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
}
