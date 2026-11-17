/**
 * Tritone palette presets for paper/substrate & ink rendering.
 * RGB values are normalized [0.0, 1.0] for WebGL uniforms.
 */
export const PALETTES = {
  archival: {
    id: 'archival',
    label: 'Warm Archival Paper',
    light: [0.953, 0.941, 0.910], // #f3f0e8
    mid:   [0.471, 0.463, 0.447], // #787672
    dark:  [0.047, 0.047, 0.047], // #0c0c0c
  },
  cream: {
    id: 'cream',
    label: 'Warm Cream',
    light: [0.965, 0.922, 0.847], // #f6ebd8
    mid:   [0.522, 0.486, 0.431], // #857c6e
    dark:  [0.067, 0.059, 0.051], // #110f0d
  },
  gallery: {
    id: 'gallery',
    label: 'Gallery White',
    light: [1.000, 1.000, 1.000], // #ffffff
    mid:   [0.500, 0.500, 0.500], // #808080
    dark:  [0.020, 0.020, 0.020], // #050505
  },
};

/**
 * Declarative cosine gradient palettes: a + b * cos(2*pi * (c * t + d))
 * 'seeded' delegates colour generation to the shader's deterministic PRNG.
 */
export const GRADIENTS = {
  seeded: {
    id: 'seeded',
    label: 'Seeded (PRNG)',
    useSeed: true,
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.33, 0.67],
  },
  solar_flare: {
    id: 'solar_flare',
    label: 'Solar Flare',
    a: [0.50, 0.32, 0.18],
    b: [0.50, 0.42, 0.28],
    c: [1.00, 1.00, 0.85],
    d: [0.00, 0.12, 0.25],
  },
  abyssal_biolum: {
    id: 'abyssal_biolum',
    label: 'Abyssal Bioluminescence',
    a: [0.18, 0.46, 0.56],
    b: [0.24, 0.42, 0.42],
    c: [0.90, 1.05, 1.15],
    d: [0.55, 0.25, 0.10],
  },
  iridescent_oil: {
    id: 'iridescent_oil',
    label: 'Iridescent Spectrum',
    a: [0.50, 0.50, 0.50],
    b: [0.50, 0.50, 0.50],
    c: [1.00, 1.00, 1.00],
    d: [0.00, 0.33, 0.67],
  },
  cyber_neon: {
    id: 'cyber_neon',
    label: 'Cyber Magenta / Cyan',
    a: [0.52, 0.38, 0.62],
    b: [0.48, 0.44, 0.38],
    c: [1.10, 0.90, 1.00],
    d: [0.75, 0.10, 0.40],
  },
  terracotta_dusk: {
    id: 'terracotta_dusk',
    label: 'Terracotta Dusk',
    a: [0.56, 0.42, 0.36],
    b: [0.38, 0.30, 0.26],
    c: [0.85, 0.95, 1.05],
    d: [0.05, 0.18, 0.35],
  },
  emerald_forest: {
    id: 'emerald_forest',
    label: 'Emerald Canopy',
    a: [0.22, 0.50, 0.34],
    b: [0.22, 0.42, 0.28],
    c: [1.00, 1.00, 0.90],
    d: [0.42, 0.15, 0.28],
  },
  monochrome_ink: {
    id: 'monochrome_ink',
    label: 'Monochrome Ink',
    a: [0.48, 0.48, 0.48],
    b: [0.46, 0.46, 0.46],
    c: [1.00, 1.00, 1.00],
    d: [0.00, 0.00, 0.00],
  },
  ultraviolet: {
    id: 'ultraviolet',
    label: 'Ultraviolet Bloom',
    a: [0.44, 0.30, 0.60],
    b: [0.42, 0.38, 0.40],
    c: [1.00, 1.15, 0.90],
    d: [0.62, 0.35, 0.12],
  },
  copper_patina: {
    id: 'copper_patina',
    label: 'Copper & Verdigris',
    a: [0.46, 0.48, 0.44],
    b: [0.40, 0.32, 0.34],
    c: [0.95, 1.10, 1.20],
    d: [0.12, 0.45, 0.58],
  },
  ice_aurora: {
    id: 'ice_aurora',
    label: 'Arctic Aurora',
    a: [0.28, 0.54, 0.58],
    b: [0.30, 0.40, 0.38],
    c: [1.15, 0.95, 1.05],
    d: [0.65, 0.22, 0.08],
  },
  molten_gold: {
    id: 'molten_gold',
    label: 'Molten Gold',
    a: [0.54, 0.44, 0.24],
    b: [0.46, 0.40, 0.24],
    c: [0.90, 0.90, 0.80],
    d: [0.00, 0.08, 0.20],
  },
};
