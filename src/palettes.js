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
