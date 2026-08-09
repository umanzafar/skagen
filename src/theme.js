// Brand palette — sampled from the Skagen logo (yellow field, navy/indigo
// comet swoosh, black aperture + bar-chart mark). Used for chrome/branding
// (headers, nav, primary buttons, accents). Status colors (green/red/amber/
// purple approve-reject-pending-assign) and per-employee identity colors are
// kept separate since they carry meaning defined by the requirements doc.
export const BRAND = {
  yellow: '#FFD400',
  yellowSoft: '#FFF3B0',
  navy: '#1E1B4E',       // deep indigo-navy — header/nav base
  navyLight: '#3B37A6',  // lighter indigo — gradient accent / hover
  black: '#0A0A0F',      // near-black — darkest gradient stop
};

export const brandGradient = `linear-gradient(135deg, ${BRAND.black} 0%, ${BRAND.navy} 55%, ${BRAND.navyLight} 100%)`;
export const brandButtonGradient = `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyLight})`;
