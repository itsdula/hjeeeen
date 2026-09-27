// الصياغة العربية — Arabic re-authoring of a Breakdown 360. Sends the ad's
// raw material (VO, beat structure, the reverse pipeline) to the model the
// user assigned to the 'arabic-copy' task (default: latest ChatGPT text) and
// gets back the eight-section Arabic document — written, not translated.
// Result lands beside the breakdown as arabic_rewrite.json; the treatment PDF
// picks it up automatically as «النسخة العربية» pages.

import type { AdBreakdown } from './breakdown';
import { llmForTask } from '../models/registry';
import { extractJson } from '../storyboardLlm';

export interface ArabicRewrite {
  model: string;
  createdAt: string;
  brief_ar: string;                       // البريف المعكوس
  proposition_ar: string;                 // الجملة الواحدة
  persona_ar: string;                     // الإنسان
  bigIdea_ar: { name: string; hook: string; insight: string; culturalTruth: string };
  beats_ar: Array<{ beat: string; visual: string; vo: string }>;
  treatment_ar: {
    lookPhrase: string;
    pairs: { aspect: string; lens: string; light: string; move: string; hour: string; place: string };
  };
  references_ar: string[];                // نأخذ/نترك per reference
  pitch_ar: Array<{ title: string; body: string }>;
}

const SYSTEM = `أنت مدير إبداعي ومخرج إعلانات سعودي كتبتَ حملات عالمية بالعربية، وتكره العربية المترجمة الميتة.
قوانين اللغة (صارمة): عربية فصحى حديثة بعصب روائي سعودي — جُمل قصيرة، أفعال قوية، صور محسوسة.
ممنوع نهائيًا: «يُعتبر، يُعد، بمثابة، يجدر بالذكر، لا يخفى، علاوة على ذلك، في عالمٍ يتسارع، رحلة، شغف، إلهام، انطلاقة واعدة».
ممنوع الحشو التحفيزي ولغة LinkedIn. التعليق الصوتي يُختبر بالأذن — أعد كتابته كأن كاتبًا سعوديًا كتبه أصلًا للميكروفون، لا ترجمة حرفية.
أعد JSON فقط بلا أي نص خارجه.`;

function buildPrompt(bd: AdBreakdown): string {
  const p = bd.pipeline;
  const vo = p.beats.map(b => b.vo).filter(Boolean).join(' / ');
  const beats = p.beats.map(b => `${b.beat}: ${b.visual}${b.vo ? ` — VO: "${b.vo}"` : ''}`).join('\n');
  const refs = p.references.map(r => r.note).join('\n');
  const c = p.treatment.choicePairs;
  return `الإعلان: "${bd.ad.title}" — ${bd.ad.brand}${bd.ad.year ? ` (${bd.ad.year})` : ''}، ${Math.round(bd.ad.durationS ?? 0)} ثانية.
الفرضية الحاكمة لا تُكسر: هذا الإعلان فيلم صُنع بالذكاء الاصطناعي داخل استوديو عربي اسمه «هجين»، وأنت تعيد بناء المسار الذي أنتجه بالعربية وحدها.

── مادة الإعلان (اعمل منها فقط، لا تخترع مشاهد) ──
التعليق الصوتي الأصلي: ${vo}
الضربات الخمس كما وقعت:
${beats}
المعالجة الحالية: «${p.treatment.lookPhrase}» — aspect: ${c.aspect} / lens: ${c.lens} / light: ${c.lightDirection} / move: ${c.cameraMove} / hour: ${c.hour} / place: ${c.placeRegister}
المراجع الحالية:
${refs}
البريف المعكوس الحالي (للاستئناس لا للترجمة): ${p.brief.rawBrief}
الجملة الحالية: ${p.brief.proposition}

── المطلوب: JSON بهذا الشكل حرفيًا ──
{
 "brief_ar": "فقرة واحدة كثيفة: ما الذي طلبه العميل حتمًا — الجمهور، مشكلة العلامة، القيد، المطلوب تسليمه",
 "proposition_ar": "جملة واحدة تُباع بصوت عالٍ في أي غرفة — إن خرجت جملتين فقد فشلت",
 "persona_ar": "إنسان واحد مسمّى: اسم، عمر، مدينة عربية، سلوك يومي واحد، شيء يسخر منه، والخوف الذي لا يقوله",
 "bigIdea_ar": {"name": "اسم الفكرة", "hook": "جملة تُقال في مجلس", "insight": "لماذا تعمل نفسيًا", "culturalTruth": "تفصيلة الحقيقة الثقافية"},
 "beats_ar": [{"beat": "SETUP", "visual": "وصف بصري بجملتين", "vo": "التعليق الصوتي بالعربية — إعادة كتابة لا ترجمة"}, ... الخمس كلها بالترتيب SETUP/DESIRE/CONFLICT/CHANGE/RESULT],
 "treatment_ar": {"lookPhrase": "فلسفة لوك واحدة بعبارة يقولها مدير تصوير", "pairs": {"aspect": "...", "lens": "...", "light": "...", "move": "...", "hour": "...", "place": "..."}},
 "references_ar": ["أربعة أسطر، لكل مرجع: الاسم + نأخذ… + نترك…", "...", "...", "..."],
 "pitch_ar": [{"title": "عنوان الصفحة", "body": "فقرتها المقنعة"}, ... خمس صفحات]
}`;
}

export async function rewriteBreakdownArabic(bd: AdBreakdown): Promise<{ ok: boolean; message?: string; rewrite?: ArabicRewrite }> {
  const res = await llmForTask('arabic-copy', { promptId: 'arabic-copy',
    system: SYSTEM,
    prompt: buildPrompt(bd),
    maxTokens: 12000,
  });
  if (!res.ok || !res.text) return { ok: false, message: res.message || 'The model returned nothing.' };
  const json = extractJson(res.text) as Partial<ArabicRewrite> | null;
  if (!json || !json.proposition_ar || !Array.isArray(json.beats_ar)) {
    return { ok: false, message: 'العربية رجعت بلا بنية سليمة — أعد المحاولة.' };
  }
  const rewrite: ArabicRewrite = {
    model: res.model ?? '',
    createdAt: new Date().toISOString(),
    brief_ar: String(json.brief_ar ?? ''),
    proposition_ar: String(json.proposition_ar ?? ''),
    persona_ar: String(json.persona_ar ?? ''),
    bigIdea_ar: {
      name: String(json.bigIdea_ar?.name ?? ''),
      hook: String(json.bigIdea_ar?.hook ?? ''),
      insight: String(json.bigIdea_ar?.insight ?? ''),
      culturalTruth: String(json.bigIdea_ar?.culturalTruth ?? ''),
    },
    beats_ar: (json.beats_ar ?? []).map(b => ({
      beat: String(b?.beat ?? ''), visual: String(b?.visual ?? ''), vo: String(b?.vo ?? ''),
    })),
    treatment_ar: {
      lookPhrase: String(json.treatment_ar?.lookPhrase ?? ''),
      pairs: {
        aspect: String(json.treatment_ar?.pairs?.aspect ?? ''),
        lens: String(json.treatment_ar?.pairs?.lens ?? ''),
        light: String(json.treatment_ar?.pairs?.light ?? ''),
        move: String(json.treatment_ar?.pairs?.move ?? ''),
        hour: String(json.treatment_ar?.pairs?.hour ?? ''),
        place: String(json.treatment_ar?.pairs?.place ?? ''),
      },
    },
    references_ar: (json.references_ar ?? []).map(String),
    pitch_ar: (json.pitch_ar ?? []).map(pg => ({ title: String(pg?.title ?? ''), body: String(pg?.body ?? '') })),
  };
  const saved = await window.hjen.mindBreakdownWriteArabic({ slug: bd.slug, data: rewrite });
  if (!saved?.ok) return { ok: false, message: 'فشل حفظ الصياغة العربية.' };
  return { ok: true, rewrite };
}
