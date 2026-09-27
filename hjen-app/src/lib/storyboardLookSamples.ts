// Bundled example images for each board-look preset — shipped with the app so
// the picker shows a real example immediately, with no per-project generation.
// (Made once with gpt-image-2, downscaled to 512px JPEG.)

import graphite from '../assets/storyboard-looks/graphite.jpg';
import blue from '../assets/storyboard-looks/blue.jpg';
import marker from '../assets/storyboard-looks/marker.jpg';
import ink from '../assets/storyboard-looks/ink.jpg';
import charcoal from '../assets/storyboard-looks/charcoal.jpg';
import digital from '../assets/storyboard-looks/digital.jpg';
import colormarker from '../assets/storyboard-looks/colormarker.jpg';
import watercolor from '../assets/storyboard-looks/watercolor.jpg';
import bd from '../assets/storyboard-looks/bd.jpg';
import previs from '../assets/storyboard-looks/previs.jpg';

export const LOOK_SAMPLES: Record<string, string> = {
  graphite, blue, marker, ink, charcoal, digital, colormarker, watercolor, bd, previs,
};
