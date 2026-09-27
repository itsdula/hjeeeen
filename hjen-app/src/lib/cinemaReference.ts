// Cinema reference bank — aggregated from 1020 real dna_corpus frames at 768px.
// Built by 02_PRODUCT/dna_corpus/calibration/build_reference.py. Regenerate there.
export const CINEMA_BANK = {
  "all": {
    "mean": {
      "spec_slope": -2.9789188727076876,
      "tail_excess": -0.31665352936848434,
      "black_p1": 0.06381215053612216,
      "hi_headroom": 0.8255565236395627,
      "clip_frac": 0.006825889909443666,
      "median_luma": 0.30833690180020934,
      "contrast_iqr": 0.26656988309148477,
      "sat_mean": 0.3421453995611884,
      "hi_desat_slope": -0.43326230655384923,
      "warmth": 1.186011156943791,
      "acutance": 0.14100245522613655,
      "grain": 0.005097941679139017
    },
    "std": {
      "spec_slope": 0.6060005080883514,
      "tail_excess": 0.2877858254704288,
      "black_p1": 0.0711586562458596,
      "hi_headroom": 0.15185644563438497,
      "clip_frac": 0.0502233266931055,
      "median_luma": 0.1782705583195427,
      "contrast_iqr": 0.13611689998621027,
      "sat_mean": 0.15284055566069762,
      "hi_desat_slope": 0.43261536143570933,
      "warmth": 0.4433663089574735,
      "acutance": 0.06900372908758215,
      "grain": 0.005862499244657986
    },
    "n": 1020
  },
  "day": {
    "mean": {
      "spec_slope": -2.9889838606220516,
      "tail_excess": -0.3225359395250929,
      "black_p1": 0.08183464238345911,
      "hi_headroom": 0.8613380939479094,
      "clip_frac": 0.009324370936888426,
      "median_luma": 0.41352628550487786,
      "contrast_iqr": 0.3122043072561391,
      "sat_mean": 0.31065304533301574,
      "hi_desat_slope": -0.4354225807253849,
      "warmth": 1.1717952315137383,
      "acutance": 0.13437757967225022,
      "grain": 0.006162846873470212
    },
    "std": {
      "spec_slope": 0.582536052566518,
      "tail_excess": 0.2460106036638387,
      "black_p1": 0.08324867150002975,
      "hi_headroom": 0.11024720505639138,
      "clip_frac": 0.0633973852424361,
      "median_luma": 0.14475291086432407,
      "contrast_iqr": 0.12954966443359753,
      "sat_mean": 0.13842502161030193,
      "hi_desat_slope": 0.41951606753803145,
      "warmth": 0.41384148597113296,
      "acutance": 0.06385269289677405,
      "grain": 0.0066254293686117734
    },
    "n": 629
  },
  "night": {
    "mean": {
      "spec_slope": -2.9627273704106667,
      "tail_excess": -0.30719052172524447,
      "black_p1": 0.034819446259971396,
      "hi_headroom": 0.76799486705657,
      "clip_frac": 0.0028065943435542674,
      "median_luma": 0.1391191975796557,
      "contrast_iqr": 0.19315798334834522,
      "sat_mean": 0.39280701288477043,
      "hi_desat_slope": -0.4297870828865962,
      "warmth": 1.2088802543747457,
      "acutance": 0.15165986372586673,
      "grain": 0.0033848333230410057
    },
    "std": {
      "spec_slope": 0.6416193328239251,
      "tail_excess": 0.3443087238533872,
      "black_p1": 0.02640670424271875,
      "hi_headroom": 0.1877009736418266,
      "clip_frac": 0.00939025472424243,
      "median_luma": 0.05256255125417675,
      "contrast_iqr": 0.11222748268318486,
      "sat_mean": 0.1610982993924839,
      "hi_desat_slope": 0.45287221199734073,
      "warmth": 0.48625086592272754,
      "acutance": 0.07535406047152755,
      "grain": 0.0037790782985306086
    },
    "n": 391
  },
  "features": [
    "spec_slope",
    "tail_excess",
    "black_p1",
    "hi_headroom",
    "clip_frac",
    "median_luma",
    "contrast_iqr",
    "sat_mean",
    "hi_desat_slope",
    "warmth",
    "acutance",
    "grain"
  ],
  "work": 768
} as const;
