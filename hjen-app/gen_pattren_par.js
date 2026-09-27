// Parallel version: fire ALL remaining pattren regions at once (Promise.all).
// Auto-skips any region whose PNG already exists in today's folder.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const OpenAI = require('openai');

const HOME = os.homedir();
const USER_DATA = path.join(HOME, 'Library/Application Support/hjen-studio');
const PROJECTS_ROOT = path.join(HOME, 'Pictures/HJEN Studio');
const PROJECTS_JSON = path.join(USER_DATA, 'projects.json');
const GEN_LOG = path.join(PROJECTS_ROOT, '_generations.jsonl');
const NAME = 'pattren', SLUG = 'pattren', SIZE = '1024x1024', QUALITY = 'high';

function key() { return process.env.OPENAI_API_KEY || fs.readFileSync(path.join(USER_DATA, 'openai_key.txt'), 'utf-8').trim(); }
function slugp(s){ return s.toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').slice(0,60)||'untitled'; }
function readProjects(){ try{const a=JSON.parse(fs.readFileSync(PROJECTS_JSON,'utf-8'));return Array.isArray(a)?a:[];}catch{return[];} }
function writeProjects(a){ fs.writeFileSync(PROJECTS_JSON, JSON.stringify(a,null,2)); }

const PATTERNS = [
  { region:'Asir',    prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography, no perspective. Al-Qatt Al-Asiri geometry — stacked triangles and misht comb-tooth zigzag bands — woven together with illustrated terraced mountain ridgelines fading into fog, and small stylised juniper trees and a flower-man floral crown motif. Hand-drawn carved line quality, flat fill. Strictly 2-3 muted tones: misty teal-green, soft terracotta clay, lime white keyline. Matte paper texture. Desaturated, earthy. Edges tile seamlessly on all four sides. 1:1.' },
  { region:'Najd',    prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. Al-Sadu weaving geometry — the al-ain "eye" diamond, hourglass and triangle bands — interlocked with the triangular dentil and sunburst geometry of carved Najdi adobe doors, and small stylised date palms. Woven flat-line craft look. Strictly 2-3 muted tones: dusty ochre, faded indigo, bone white keyline. Matte paper texture, desaturated earthy. Seamless tiling on all four sides. 1:1.' },
  { region:'Hijaz',   prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. A Hijazi roshan / mashrabiya lattice of turned-baluster hexagonal and octagonal openings, drawn flat as carved line-work, interwoven with stylised Red Sea coral branches and gentle wave lines glimpsed through the openings. Strictly 2-3 muted tones: weathered teak brown, muted sea-grey-teal, cream keyline. Matte paper texture, desaturated. Seamless tiling on all four sides. 1:1.' },
  { region:'AlAhsa',  prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. Al-khoos palm-frond basket weave — diagonal over-under plaiting and herringbone — interwoven with stylised date-palm fronds and concentric oasis-spring ripple rings. Flat woven-line craft look. Strictly 2-3 muted tones: pale palm-straw, soft spring-teal, ivory keyline. Matte paper texture, desaturated earthy. Seamless tiling on all four sides. 1:1.' },
  { region:'Jazan',   prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. Concentric painted ring-bands of the Tihama ushash round houses, hand-drawn with slight wobble, interwoven with stylised coffee branches, coffee cherries and a small stylised parrot silhouette. Flat folk-illustration look. Strictly 2-3 muted tones: muted brick-red, soft sage green, off-white keyline. Matte paper texture, desaturated. Seamless tiling on all four sides. 1:1.' },
  { region:'Najran',  prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. Bedouin silver filigree — coiled wire spirals, crescents, granulated rosettes — laid over the stacked rectangular window geometry of tall Najran mud tower-houses. Fine flat engraved line-work. Strictly 2-3 muted tones: muted silver-grey, desert taupe, charcoal keyline. Matte paper texture, desaturated. Seamless tiling on all four sides. 1:1.' },
  { region:'Hail',    prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. Jubbah-style petroglyph figures — stylised camels, ibex, human figures and ancient marks — scattered across flowing Nefud dune-ripple lines and angular Aja mountain ridges. Carved rock-art line quality, flat fill. Strictly 2-3 muted tones: red-sand ochre, charcoal, bone white keyline. Matte paper texture, desaturated earthy. Seamless tiling on all four sides. 1:1.' },
  { region:'AlUla',   prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. Nabataean carved tomb-facade geometry of Hegra — stepped crow-step crowns, columns and doorways — repeated and interwoven with horizontal sandstone strata lines and stylised desert rock formations. Flat carved line-work. Strictly 2-3 muted tones: muted sandstone rose, shadow taupe, pale keyline. Matte paper texture, desaturated. Seamless tiling on all four sides. 1:1.' },
  { region:'AlBahah', prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. Stacked-stone geometry of Al-Bahah watchtowers and terraced retaining walls, interwoven with stylised juniper foliage, honeycomb hexagons and a small stylised bee. Flat folk-engraving look, hand-drawn line. Strictly 2-3 muted tones: forest green-grey, muted honey amber, off-white keyline. Matte paper texture, desaturated. Seamless tiling on all four sides. 1:1.' },
  { region:'AlJouf',  prompt:'Seamless square tile, flat hand-engraved block-print illustration, no photography. Stylised olive branches with leaves and olives interwoven with the angular cut-stone block geometry and arched openings of Dumat Al-Jandal Marid castle and old town walls. Flat carved line-work. Strictly 2-3 muted tones: muted olive grey-green, old-stone taupe, cream keyline. Matte paper texture, desaturated earthy. Seamless tiling on all four sides. 1:1.' },
];

const client = new OpenAI({ apiKey: key() });
const today = new Date().toISOString().slice(0,10);
const dayDir = path.join(PROJECTS_ROOT, SLUG, today);
fs.mkdirSync(dayDir, { recursive: true });
const proj = readProjects().find(p => p.slug === SLUG);

// which regions already have a png today?
const existing = new Set(fs.readdirSync(dayDir).filter(f=>f.endsWith('.png')).map(f=>{
  const m = f.match(/_\d{2}-([a-z]+)-/); return m ? m[1] : null;
}).filter(Boolean));

async function genOne(idx) {
  const { region, prompt } = PATTERNS[idx];
  if (existing.has(region.toLowerCase())) { console.log(`[skip] ${region} (already done)`); return 'skip'; }
  const t0 = Date.now();
  try {
    console.log(`[gen] ${region} fired`);
    const resp = await client.images.generate({ model:'gpt-image-2', prompt, size:SIZE, quality:QUALITY, n:1 });
    const b64 = resp.data && resp.data[0] && resp.data[0].b64_json;
    if (!b64) throw new Error('empty payload');
    const dur = Date.now()-t0;
    const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const base = `${ts}_${String(idx+1).padStart(2,'0')}-${region.toLowerCase()}-${slugp(prompt).slice(0,40)}`;
    const imgPath = path.join(dayDir, `${base}.png`);
    const jsonPath = path.join(dayDir, `${base}.json`);
    const thumbPath = path.join(dayDir, `${base}.thumb.jpg`);
    fs.writeFileSync(imgPath, Buffer.from(b64,'base64'));
    const sidecar = { captured:new Date().toISOString(), project:{id:proj?proj.id:null,name:NAME,slug:SLUG}, prompt, promptChain:null,
      size:SIZE, apiSize:SIZE, finalSize:SIZE, model:'ChatGPT Image 2.0', apiModelId:'gpt-image-2', region, durationMs:dur, apiDurationMs:dur, references:[],
      selections:{angle:null,movie:null,photographer:null,camera:null,lens:null,stock:null,lighting:null,movement:null,focal_mm:null,aperture_f:null,aspect:'1:1',resolution:'1MP',quality:'HIGH',model:'GPT_IMAGE_2',style_preset:'NONE',atmosphere:'',prompt} };
    fs.writeFileSync(jsonPath, JSON.stringify(sidecar,null,2));
    try{ execSync(`/usr/bin/sips -s format jpeg -Z 1024 ${JSON.stringify(imgPath)} --out ${JSON.stringify(thumbPath)}`,{stdio:'ignore'}); }catch{}
    const stat = fs.statSync(imgPath);
    fs.appendFileSync(GEN_LOG, JSON.stringify({ ts:stat.mtimeMs, imgPath, thumbPath:fs.existsSync(thumbPath)?thumbPath:undefined, jsonPath, dateFolder:today, baseName:base, captured:sidecar.captured, promptTitle:`${region} — regional pattern`, finalSize:SIZE, modelLabel:'ChatGPT Image 2.0', quality:'HIGH', resolution:'1MP', aspect:'1:1', durationMs:dur, referencesCount:0, projectId:proj?proj.id:null, projectName:NAME, projectSlug:SLUG })+'\n');
    console.log(`[ok] ${region} (${(dur/1000).toFixed(1)}s)`);
    return 'ok';
  } catch(err){ console.log(`[FAIL] ${region}: ${err&&err.message?err.message:err}`); return 'fail'; }
}

(async () => {
  const results = await Promise.all(PATTERNS.map((_,i)=>genOne(i)));   // ALL fired at once
  // sync generationCount to actual png count
  const cnt = fs.readdirSync(dayDir).filter(f=>f.endsWith('.png')).length;
  const arr = readProjects(); const t = arr.find(p=>p.slug===SLUG); if(t){ t.generationCount=cnt; writeProjects(arr); }
  const ok = results.filter(r=>r==='ok').length, sk = results.filter(r=>r==='skip').length, fl = results.filter(r=>r==='fail').length;
  console.log(`[done] new:${ok} skipped:${sk} failed:${fl} — total pngs in project: ${cnt}`);
})();
