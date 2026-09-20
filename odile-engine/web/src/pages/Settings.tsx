import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api, humanizeError, upload } from '../api/client';
import LibraryPicker, { LibraryThumb } from '../components/LibraryPicker';
import { EtatErreur, FORMAT_LABELS, PageTitle } from '../components/shared';
import { toast } from '../components/Toaster';
import type { LibraryImageDto } from '../api/types';

type AllSettings = Record<string, unknown> & {
  tone: { preset: string; registre: number; emojiLevel: number; ctaStyle: string; customInstructions?: string };
  brand: { name: string; handle: string; siteUrl: string; accentColor: string; tagline: string; logoAssetId: string | null; avatarAssetId?: string | null; authorLine?: string; footerStyle?: 'logo' | 'initiales' | 'logo-nom'; initials?: string; emojiStyle?: 'aucun' | 'systeme'; telephone?: string; rue?: string; codePostal?: string; ville?: string; sameAs?: string[] };
  cadence: { days: number; rotation: string[]; broadcast?: boolean; docEveryNPosts?: number };
  publish_slots: { ig: { dow: number; time: string }[]; li: { dow: number; time: string }[] };
  dm_triggers: { enabled: boolean; keywords: string[]; replyTemplate: string; requireFollow?: boolean; askFollowTemplate?: string; thanksTemplate?: string; remindTemplate?: string; publicReply?: boolean; publicReplyVariants?: string[]; publicReplyFallbackVariants?: string[]; linkTarget?: 'article' | 'fixe'; fixedUrl?: string; fixedLabel?: string; rdvUrl?: string; rdvLabel?: string; qualifyTemplate?: string; linkedinOffer?: 'ressource' | 'diagnostic'; diagnosticKeywords?: string[]; diagnosticPromise?: string };
  fb_mirror: { enabled: boolean };
  amplification: {
    enabled: boolean; firstComment: boolean; firstCommentDelayMinutes: number; crossComment: boolean;
    delayMinutes: number; spacingMinutes: number; maxAccounts: number;
  };
  video: {
    enabled: boolean; everyNPosts: number; avatarType: 'avatar' | 'talking_photo'; avatarId: string; avatarStyle: string;
    voiceId: string; voiceSpeed: number; backgroundType: 'couleur' | 'image'; backgroundValue: string;
    captions: boolean; targetSeconds: number; testMode: boolean;
  };
  llm_budget: { enabled: boolean; dailyEuros: number };
  approval_email: { to: string; subjectPrefix: string; maxReminders: number };
  design_studio: { enabled: boolean; maxIterations: number; passThreshold: number };
  image_gen: { enabled: boolean; autoPlace?: boolean; imagesPerPost: number; styleNotes: string; quality: 'pro' | 'fast'; monochrome: boolean; provider: 'auto' | 'gemini' | 'freepik'; model: string; style: 'auto' | 'full' | 'objets' | 'chrome'; references: Record<string, string | null | undefined>; notesByStyle: Record<string, string | undefined>; modelByStyle?: Record<string, string | undefined> };
  visual_agent: { enabled: boolean; autoRun: boolean; screenshots: number; images: number };
  default_theme: string;
  default_format: string;
};

/** Initiales du carré de marque : celles saisies, sinon déduites du nom (« Odile AI » → OA). */
function initialsOf(brand: { name: string; initials?: string }): string {
  const forced = (brand.initials ?? '').trim();
  if (forced) return forced.slice(0, 3).toUpperCase();
  return brand.name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

interface SourceDto {
  id: number;
  name: string;
  url: string;
  lang: string;
  weight: number;
  enabled: boolean;
  lastError: string | null;
}

function Section({ title, children, onSave, saving }: { title: string; children: ReactNode; onSave?: () => void; saving?: boolean }) {
  return (
    <div className="card mb-5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">{title}</h2>
        {onSave && (
          <button className="btn-primary !py-1.5" disabled={saving} onClick={onSave}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function SlotsEditor({ slots, onChange }: { slots: { dow: number; time: string }[]; onChange: (s: { dow: number; time: string }[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {slots.map((slot, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            className="input !w-28"
            value={slot.dow}
            onChange={(e) => onChange(slots.map((s, j) => (j === i ? { ...s, dow: Number(e.target.value) } : s)))}
          >
            {DAYS.map((d, di) => (
              <option key={di} value={di}>{d}</option>
            ))}
          </select>
          <input
            type="time"
            className="input !w-32"
            value={slot.time}
            onChange={(e) => onChange(slots.map((s, j) => (j === i ? { ...s, time: e.target.value } : s)))}
          />
          <button className="btn-ghost !px-2 !py-1" onClick={() => onChange(slots.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn-ghost self-start !py-1.5 text-xs" onClick={() => onChange([...slots, { dow: 2, time: '11:00' }])}>
        + Ajouter un créneau
      </button>
    </div>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { data: settings, isError: enErreur, error: erreur, refetch: recharger } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AllSettings>('/api/settings'),
  });
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<SourceDto[]>('/api/sources'),
  });
  const { data: imageModels } = useQuery({
    queryKey: ['image-models'],
    queryFn: () => api.get<{ models: { id: string; label: string; speed: string; recommended: boolean }[] }>('/api/images/models'),
  });
  const { data: catalogue } = useQuery({
    queryKey: ['templates'],
    queryFn: () =>
      api.get<{ builtin: { id: string; label: string }[]; custom: { themeId: string; name: string }[] }>(
        '/api/templates',
      ),
  });
  const [form, setForm] = useState<AllSettings | null>(null);
  const [refPicker, setRefPicker] = useState<'full' | 'objets' | 'chrome' | null>(null);
  const [avatarPicker, setAvatarPicker] = useState(false);
  const { data: library } = useQuery({
    queryKey: ['library'],
    queryFn: () => api.get<LibraryImageDto[]>('/api/library'),
  });
  useEffect(() => {
    if (settings && !form) setForm(structuredClone(settings));
  }, [settings]);

  const SECTION_LABELS: Record<string, string> = {
    tone: 'Ton', brand: 'Marque', cadence: 'Cadence', publish_slots: 'Créneaux', dm_triggers: 'Commentaire → DM', fb_mirror: 'Miroir Facebook', amplification: 'Amplification', llm_budget: 'Budget IA',
    design_studio: 'Studio de design', image_gen: 'Illustrations IA', approval_email: 'Email de validation', visual_agent: 'Agent visuel',
    default_theme: 'Thème par défaut', default_format: 'Format par défaut', video: 'Vidéos avatar',
  };
  /** Enregistre une ou plusieurs clés en une seule action (bouton et message par section). */
  const save = useMutation({
    mutationFn: async (vars: { key: string; value: unknown } | { key: string; value: unknown }[]) => {
      const list = Array.isArray(vars) ? vars : [vars];
      for (const v of list) await api.put(`/api/settings/${v.key}`, v.value);
      return list.map((v) => v.key);
    },
    onSuccess: (keys) => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success(`${keys.map((k) => SECTION_LABELS[k] ?? k).join(' + ')} : enregistré`);
    },
  });
  const savingKeys = save.isPending ? (Array.isArray(save.variables) ? save.variables : [save.variables]).map((v) => v?.key) : [];
  const savingOf = (...keys: string[]) => keys.some((k) => savingKeys.includes(k));
  /** Remplit les messages privés avec les textes proposés (sans enregistrer). */
  const textesProposes = useMutation({
    mutationFn: () => api.get<Record<string, string | string[]>>('/api/settings/dm-textes-proposes'),
    onSuccess: (t) => {
      setForm((f) => (f ? { ...f, dm_triggers: { ...f.dm_triggers, ...t } } : f));
      toast.info('Textes proposés chargés — relis-les puis enregistre.');
    },
  });
  const testEmail = useMutation({
    mutationFn: () => api.post<{ ok: boolean; to: string }>('/api/settings/test-email'),
    onSuccess: (r) => toast.success(`Email de test envoyé à ${r.to}`),
  });
  const toggleSource = useMutation({
    mutationFn: (vars: { id: number; enabled: boolean }) => api.patch(`/api/sources/${vars.id}`, { enabled: vars.enabled }),
    // La case bascule tout de suite ; retour arrière si le serveur refuse
    onMutate: (vars) => {
      const previous = qc.getQueryData<SourceDto[]>(['sources']);
      qc.setQueryData<SourceDto[]>(['sources'], (old) => old?.map((s) => (s.id === vars.id ? { ...s, enabled: vars.enabled } : s)));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['sources'], ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['sources'] }),
  });

  // Les réglages ne se chargent pas : le dire, plutôt que laisser un écran vide où
  // l'on croit avoir tout perdu.
  if (enErreur) {
    return (
      <div className="max-w-3xl">
        <PageTitle title="Réglages" subtitle="Ton, marque, cadence, déclencheurs DM, studio de design, veille." />
        <EtatErreur error={erreur} onRetry={() => void recharger()} quoi="Les réglages" />
      </div>
    );
  }
  if (!form) return <div className="text-muted">Chargement…</div>;
  const set = <K extends keyof AllSettings>(key: K, value: AllSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <div className="max-w-3xl">
      <PageTitle title="Réglages" subtitle="Ton, marque, cadence, déclencheurs DM, studio de design, veille." />

      <Section title="Ton des posts" saving={savingOf('tone')} onSave={() => save.mutate({ key: 'tone', value: form.tone })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Personnalité</label>
            <select className="input" value={form.tone.preset} onChange={(e) => set('tone', { ...form.tone, preset: e.target.value })}>
              <option value="expert_accessible">Expert accessible</option>
              <option value="ami_entrepreneur">Ami entrepreneur</option>
              <option value="provocateur_bienveillant">Provocateur bienveillant</option>
              <option value="custom">Personnalisé</option>
            </select>
          </div>
          <div>
            <label className="label">Style de CTA</label>
            <select className="input" value={form.tone.ctaStyle} onChange={(e) => set('tone', { ...form.tone, ctaStyle: e.target.value })}>
              <option value="question">Question ouverte</option>
              <option value="direct">Impératif direct</option>
              <option value="curiosite">Curiosité</option>
            </select>
          </div>
          <div>
            <label className="label">Registre : pointu ← {form.tone.registre} → décontracté</label>
            <input type="range" min={0} max={100} className="w-full accent-sky-500" value={form.tone.registre}
              onChange={(e) => set('tone', { ...form.tone, registre: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Niveau d'emojis : {['aucun', 'discret', 'présent', 'généreux'][form.tone.emojiLevel]}</label>
            <input type="range" min={0} max={3} className="w-full accent-sky-500" value={form.tone.emojiLevel}
              onChange={(e) => set('tone', { ...form.tone, emojiLevel: Number(e.target.value) })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Instructions libres (facultatif)</label>
            <textarea className="input" rows={2} value={form.tone.customInstructions ?? ''}
              onChange={(e) => set('tone', { ...form.tone, customInstructions: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section title="Marque" saving={savingOf('brand')} onSave={() => save.mutate({ key: 'brand', value: form.brand })}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">Nom</label>
            <input className="input" value={form.brand.name} onChange={(e) => set('brand', { ...form.brand, name: e.target.value })} /></div>
          <div><label className="label">Handle</label>
            <input className="input" value={form.brand.handle} onChange={(e) => set('brand', { ...form.brand, handle: e.target.value })} /></div>
          <div><label className="label">Site</label>
            <input className="input" value={form.brand.siteUrl} onChange={(e) => set('brand', { ...form.brand, siteUrl: e.target.value })} /></div>
          <div><label className="label">Couleur d'accent</label>
            <div className="flex gap-2">
              <input type="color" className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-panel2" value={form.brand.accentColor}
                onChange={(e) => set('brand', { ...form.brand, accentColor: e.target.value })} />
              <input className="input" value={form.brand.accentColor} onChange={(e) => set('brand', { ...form.brand, accentColor: e.target.value })} />
            </div></div>
          <div className="sm:col-span-2"><label className="label">Tagline</label>
            <input className="input" value={form.brand.tagline} onChange={(e) => set('brand', { ...form.brand, tagline: e.target.value })} /></div>
          {/* Fiche locale : les mêmes nom, adresse et téléphone que sur la fiche Google et les réseaux — c'est ce que le référencement local compare. */}
          <div><label className="label">Téléphone (fiche locale)</label>
            <input className="input" value={form.brand.telephone ?? ''} placeholder="+33 5 …" onChange={(e) => set('brand', { ...form.brand, telephone: e.target.value })} /></div>
          <div><label className="label">Ville</label>
            <input className="input" value={form.brand.ville ?? ''} placeholder="Toulouse" onChange={(e) => set('brand', { ...form.brand, ville: e.target.value })} /></div>
          <div><label className="label">Adresse (rue)</label>
            <input className="input" value={form.brand.rue ?? ''} onChange={(e) => set('brand', { ...form.brand, rue: e.target.value })} /></div>
          <div><label className="label">Code postal</label>
            <input className="input" value={form.brand.codePostal ?? ''} onChange={(e) => set('brand', { ...form.brand, codePostal: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Pages officielles (LinkedIn, Instagram, Facebook… une adresse par ligne)</label>
            <textarea className="input min-h-20" value={(form.brand.sameAs ?? []).join('\n')}
              onChange={(e) => set('brand', { ...form.brand, sameAs: e.target.value.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)) })} />
            <p className="mt-1 text-[11px] text-muted">Reliées à l’entreprise dans les données structurées des articles : Google et les assistants IA comprennent que c’est la même Odile AI partout.</p></div>
          <div className="sm:col-span-2">
            <label className="label">Logo (PNG/JPG, affiché sur chaque slide)</label>
            <div className="flex items-center gap-3">
              {form.brand.logoAssetId && <img src={`/api/assets/${form.brand.logoAssetId}`} className="h-10 w-10 rounded-lg object-cover" alt="logo" />}
              <label className="btn-ghost cursor-pointer !py-1.5 text-xs">
                {form.brand.logoAssetId ? 'Remplacer le logo' : 'Choisir un fichier'}
              <input type="file" accept="image/*" hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    const r = await upload<{ assetId?: string; id?: string }>('/api/settings/brand/logo', file);
                    const assetId = r.assetId ?? r.id ?? null;
                    // Le logo est enregistré côté serveur ; le formulaire garde les autres modifications en cours
                    if (assetId) set('brand', { ...form.brand, logoAssetId: assetId });
                    void qc.invalidateQueries({ queryKey: ['settings'] });
                    toast.success('Logo enregistré');
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : String(err));
                  }
                }} />
              </label>
              <span className="text-xs text-muted">PNG transparent recommandé.</span>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Pied de marque sur les slides (les templates peuvent le surcharger)</label>
            <div className="flex flex-wrap items-center gap-2">
              {([
                { v: 'initiales', l: `${initialsOf(form.brand)} · ${form.brand.name} · ${form.brand.handle}` },
                { v: 'logo', l: 'Logo seul' },
                { v: 'logo-nom', l: 'Logo réduit + nom + handle' },
              ] as const).map((o) => (
                <button
                  key={o.v}
                  onClick={() => set('brand', { ...form.brand, footerStyle: o.v })}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    (form.brand.footerStyle ?? 'initiales') === o.v ? 'border-accent/50 bg-accent-soft text-ice' : 'border-line text-muted hover:text-txt'
                  }`}
                >
                  {o.l}
                </button>
              ))}
              <input
                className="input !w-24"
                maxLength={3}
                placeholder={initialsOf({ ...form.brand, initials: '' })}
                title="Initiales du carré de marque (sinon déduites du nom)"
                value={form.brand.initials ?? ''}
                onChange={(e) => set('brand', { ...form.brand, initials: e.target.value.toUpperCase() })}
              />
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Émojis dans les visuels</label>
            <div className="flex flex-wrap items-center gap-2">
              {([
                { v: 'aucun', l: 'Aucun — gardés dans la légende' },
                { v: 'systeme', l: 'Police du serveur (style Google)' },
              ] as const).map((o) => (
                <button
                  key={o.v}
                  onClick={() => set('brand', { ...form.brand, emojiStyle: o.v })}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    (form.brand.emojiStyle ?? 'aucun') === o.v ? 'border-accent/50 bg-accent-soft text-ice' : 'border-line text-muted hover:text-txt'
                  }`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Les visuels sont dessinés sur le serveur : les émojis y prennent le style de la police installée (Noto,
              allure Google). La police Apple ne peut pas y être embarquée, sa licence la réservant aux appareils Apple.
              En les gardant hors des visuels, ils restent dans la légende — et là, c'est l'iPhone du lecteur qui les
              dessine, donc en émojis Apple.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Chip auteur (templates avec « chip auteur ») — photo et ligne sous le nom</label>
            <div className="flex flex-wrap items-center gap-3">
              {form.brand.avatarAssetId ? (
                <img src={`/api/assets/${form.brand.avatarAssetId}`} className="h-10 w-10 rounded-full object-cover" alt="avatar" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-line text-[10px] text-muted">logo</span>
              )}
              <button className="btn-ghost !py-1.5 text-xs" onClick={() => setAvatarPicker(true)}>
                {form.brand.avatarAssetId ? 'Changer la photo' : 'Choisir une photo (bibliothèque)'}
              </button>
              {form.brand.avatarAssetId && (
                <button className="pill-btn" title="Revenir au logo" onClick={() => set('brand', { ...form.brand, avatarAssetId: null })}>×</button>
              )}
              <input className="input !w-auto min-w-[16rem] flex-1" placeholder="IA · Automatisation · PME (sinon le handle)"
                value={form.brand.authorLine ?? ''} onChange={(e) => set('brand', { ...form.brand, authorLine: e.target.value })} />
            </div>
            <LibraryPicker
              open={avatarPicker}
              title="Photo de la chip auteur"
              onClose={() => setAvatarPicker(false)}
              onPick={(img) => {
                set('brand', { ...form.brand, avatarAssetId: img.id });
                setAvatarPicker(false);
              }}
            />
          </div>
        </div>
      </Section>

      <Section title="Cadence & créneaux" saving={savingOf('cadence', 'publish_slots')}
        onSave={() => save.mutate([{ key: 'cadence', value: form.cadence }, { key: 'publish_slots', value: form.publish_slots }])}>
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Au moins 1 post tous les… {form.cadence.days} jour(s)</label>
            <input type="range" min={1} max={7} className="w-full accent-sky-500" value={form.cadence.days}
              onChange={(e) => set('cadence', { ...form.cadence, days: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Rotation automatique des canaux</label>
            <div className="flex gap-3 pt-1">
              {(['ig', 'li_personal', 'li_org'] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" className="accent-sky-500" checked={form.cadence.rotation.includes(ch)}
                    onChange={(e) => {
                      const rotation = e.target.checked
                        ? [...form.cadence.rotation, ch]
                        : form.cadence.rotation.filter((r) => r !== ch);
                      if (rotation.length > 0) set('cadence', { ...form.cadence, rotation });
                    }} />
                  {{ ig: 'Instagram', li_personal: 'LinkedIn perso', li_org: 'LinkedIn page' }[ch]}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mb-4 max-w-xs">
          <label className="label">Un post LinkedIn sur N en document PDF</label>
          <input type="number" min={0} max={20} className="input" value={form.cadence.docEveryNPosts ?? 3}
            onChange={(e) => set('cadence', { ...form.cadence, docEveryNPosts: Number(e.target.value) })} />
          <p className="mt-1.5 text-xs text-muted">
            Le document est le carrousel natif de LinkedIn : un PDF que l’on feuillette sans quitter le fil. C’est le format qui retient le plus longtemps, donc celui
            que l’algorithme pousse le plus — mais un fil qui n’en publierait que serait illisible. 0 = jamais.
          </p>
        </div>
        <label className="mb-1 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.cadence.broadcast ?? false}
            onChange={(e) => set('cadence', { ...form.cadence, broadcast: e.target.checked })} />
          Publier chaque post sur tous les comptes connectés
        </label>
        <p className="mb-4 text-xs text-muted">
          Un seul sujet, une seule validation : le post part sur chaque profil LinkedIn de l’équipe, sur la page entreprise, sur Instagram — et sur la Page Facebook
          dans la foulée. Mêmes visuels partout ; le texte est <strong>réécrit pour chaque compte</strong> — à la première personne pour un profil, au « nous » pour la
          page, et adapté à chaque plateforme. La rotation ci-dessus ne sert alors qu’à choisir le texte de départ.
        </p>
        <p className="mb-4 text-xs text-muted">
          Les copies ne partent pas à la même minute : chacune prend le créneau suivant de sa plateforme. Trois comptes qui publient le même sujet à la même seconde se
          repèrent ; étalés sur les créneaux de la semaine, ils font trois passages au lieu d’un.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <div><label className="label">Créneaux Instagram</label>
            <SlotsEditor slots={form.publish_slots.ig} onChange={(ig) => set('publish_slots', { ...form.publish_slots, ig })} /></div>
          <div><label className="label">Créneaux LinkedIn</label>
            <SlotsEditor slots={form.publish_slots.li} onChange={(li) => set('publish_slots', { ...form.publish_slots, li })} /></div>
        </div>
      </Section>

      <Section title="Budget IA" saving={savingOf('llm_budget')} onSave={() => save.mutate({ key: 'llm_budget', value: form.llm_budget })}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.llm_budget?.enabled ?? true}
            onChange={(e) => set('llm_budget', { ...(form.llm_budget ?? { dailyEuros: 2 }), enabled: e.target.checked })} />
          Plafonner la dépense quotidienne des modèles de langage
        </label>
        <div className="flex items-center gap-3">
          <label className="label !mb-0">Plafond par jour</label>
          <input
            type="number" step="0.5" min="0" max="500"
            className="input !w-28"
            value={form.llm_budget?.dailyEuros ?? 2}
            onChange={(e) => set('llm_budget', { ...(form.llm_budget ?? { enabled: true }), dailyEuros: Number(e.target.value) })}
          />
          <span className="text-sm text-muted">€</span>
        </div>
        <p className="mt-2 text-xs text-muted">
          Le compteur se remet à zéro à minuit, heure de Paris. À partir de 70 % du plafond, les tâches facultatives
          (relecture, agent visuel, scoring, recherche web) s'effacent pour laisser passer la rédaction du post. Au-delà
          de 100 %, plus aucun appel ne part jusqu'au lendemain — un arrêt annoncé, pas une panne.
        </p>
      </Section>

      <SectionVideo form={form} set={set} saving={savingOf('video')} onSave={() => save.mutate({ key: 'video', value: form.video })} />

      <Section title="Miroir Facebook" saving={savingOf('fb_mirror')} onSave={() => save.mutate({ key: 'fb_mirror', value: form.fb_mirror })}>
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.fb_mirror?.enabled ?? false}
            onChange={(e) => set('fb_mirror', { enabled: e.target.checked })} />
          Recopier chaque publication Instagram sur la Page Facebook liée
        </label>
        <p className="text-xs text-muted">
          Mêmes visuels, même légende, publiés juste après Instagram — sans créneau ni validation séparés. Une image
          devient une photo, un carrousel devient une publication à plusieurs photos. Un échec côté Facebook est
          consigné sur le post et laisse la publication Instagram intacte.
        </p>
        <p className="mt-2 text-xs text-muted">
          La recopie est aussi active tant que « publier sur tous les comptes » l'est (Cadence) — décocher ici suffit à
          l'arrêter dès que la diffusion l'est aussi. La légende, elle, est adaptée : le moteur ne lit que les commentaires
          Instagram, donc « Commente MOT-CLÉ » est remplacé sur Facebook par un renvoi vers la publication Instagram, là où
          la promesse est tenue.
        </p>
        <p className="mt-2 text-xs text-muted">
          Exige la permission <code>pages_manage_posts</code> sur l'app Meta : ajoutez-la aux autorisations, puis
          reconnectez le compte depuis Connexions &amp; santé.
        </p>
      </Section>

      <Section title="Amplification" saving={savingOf('amplification')} onSave={() => save.mutate({ key: 'amplification', value: form.amplification })}>
        <p className="mb-3 text-xs text-muted">
          Ce qui se passe <strong>sous</strong> un post LinkedIn une fois publié. C'est ce que font à la main les équipes qui percent : un commentaire précoce pèse
          bien plus qu'un like dans le classement LinkedIn, et ouvre le post aux réseaux des collègues.
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.amplification?.enabled ?? true}
            onChange={(e) => set('amplification', { ...form.amplification, enabled: e.target.checked })} />
          Activer l'amplification des posts LinkedIn
        </label>
        <label className="mb-1 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.amplification?.firstComment ?? true}
            onChange={(e) => set('amplification', { ...form.amplification, firstComment: e.target.checked })} />
          Commentaire d'amorce du compte qui publie
        </label>
        <p className="mb-3 text-xs text-muted">
          Le rappel du mot-clé à commenter, et rien d'autre : <strong>aucun lien sous le post</strong>, le lien vit dans la description. Il ne donne jamais la
          ressource promise : elle reste au bout du commentaire, sinon le tunnel n'a plus de raison d'être.
        </p>
        <label className="mb-1 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.amplification?.crossComment ?? true}
            onChange={(e) => set('amplification', { ...form.amplification, crossComment: e.target.checked })} />
          Les autres comptes connectés commentent le post
        </label>
        <p className="mb-3 text-xs text-muted">
          Chaque collègue écrit son propre commentaire, à sa voix, avec un angle ou un exemple — jamais un « super post ». Un compte ne commente qu'une fois le même
          post, et rien ne part au-delà de 48 h.
        </p>
        <div className="grid gap-4 sm:grid-cols-4">
          <div><label className="label">Amorce après (min)</label>
            <input type="number" min={1} max={120} className="input" value={form.amplification?.firstCommentDelayMinutes ?? 4}
              onChange={(e) => set('amplification', { ...form.amplification, firstCommentDelayMinutes: Number(e.target.value) })} /></div>
          <div><label className="label">Collègues après (min)</label>
            <input type="number" min={5} max={360} className="input" value={form.amplification?.delayMinutes ?? 25}
              onChange={(e) => set('amplification', { ...form.amplification, delayMinutes: Number(e.target.value) })} /></div>
          <div><label className="label">Écart entre eux (min)</label>
            <input type="number" min={5} max={180} className="input" value={form.amplification?.spacingMinutes ?? 20}
              onChange={(e) => set('amplification', { ...form.amplification, spacingMinutes: Number(e.target.value) })} /></div>
          <div><label className="label">Comptes max</label>
            <input type="number" min={1} max={5} className="input" value={form.amplification?.maxAccounts ?? 2}
              onChange={(e) => set('amplification', { ...form.amplification, maxAccounts: Number(e.target.value) })} /></div>
        </div>
      </Section>

      <Section title="Commentaire → DM" saving={savingOf('dm_triggers')} onSave={() => save.mutate({ key: 'dm_triggers', value: form.dm_triggers })}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.dm_triggers.enabled}
            onChange={(e) => set('dm_triggers', { ...form.dm_triggers, enabled: e.target.checked })} />
          Activer l'envoi automatique de DM Instagram sur mot-clé
        </label>
        <button className="btn-ghost mb-4 !py-1.5 text-xs" disabled={textesProposes.isPending} onClick={() => textesProposes.mutate()}>
          {textesProposes.isPending ? 'Chargement…' : 'Revenir aux textes proposés'}
        </button>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="label">Mots à commenter sur Instagram (séparés par des virgules) — sur Facebook rien ne se déclenche, sur LinkedIn ce sont les mots de diagnostic plus bas</label>
            <input className="input" value={form.dm_triggers.keywords.join(', ')}
              onChange={(e) => set('dm_triggers', { ...form.dm_triggers, keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </div>
          <div>
            <label className="label">Message envoyé ({'{{link}}'} = lien tracké du post)</label>
            <textarea className="input" rows={3} value={form.dm_triggers.replyTemplate}
              onChange={(e) => set('dm_triggers', { ...form.dm_triggers, replyTemplate: e.target.value })} />
          </div>
          <div className="rounded-xl border border-line p-4">
            <label className="label !mb-1">Ce que reçoit la personne (en message privé sur Instagram, par le lien du post sur LinkedIn)</label>
            <select className="input" value={form.dm_triggers.linkTarget ?? 'article'}
              onChange={(e) => set('dm_triggers', { ...form.dm_triggers, linkTarget: e.target.value as 'article' | 'fixe' })}>
              <option value="article">L'article source du post</option>
              <option value="fixe">Une adresse à moi (contact, prise de rendez-vous…)</option>
            </select>
            <p className="mt-2 text-xs text-muted">
              Le rédacteur en est informé : la promesse de la dernière slide désigne ce que la personne reçoit
              vraiment, et jamais un guide ou une checklist que le moteur n'envoie pas.
            </p>
            <p className="mt-2 text-xs text-muted">
              C'est aussi l'adresse posée dans la <strong>description des posts LinkedIn</strong> (« Ou directement ici : … ») : ceux qui ne veulent pas
              commenter y vont d'un clic, les autres passent par le mot-clé et arrivent en message privé. Un code de suivi par compte : on sait d'où vient
              chaque clic. Sur Instagram et Facebook, aucun lien — tout part en privé.
            </p>
            {form.dm_triggers.linkTarget === 'fixe' && (
              <div className="mt-3 grid gap-3">
                <div>
                  <label className="label">Adresse</label>
                  <input className="input" placeholder="https://odileai.com/cartographie"
                    value={form.dm_triggers.fixedUrl ?? ''}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, fixedUrl: e.target.value })} />
                </div>
                <div>
                  <label className="label">Ce qu'on y trouve (la promesse annoncée dans le post)</label>
                  <input className="input" placeholder="la cartographie gratuite de tes tâches répétitives"
                    value={form.dm_triggers.fixedLabel ?? ''}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, fixedLabel: e.target.value })} />
                </div>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-line p-4">
            <label className="label !mb-1">Sur LinkedIn, le mot-clé donne…</label>
            <select className="input" value={form.dm_triggers.linkedinOffer ?? 'diagnostic'}
              onChange={(e) => set('dm_triggers', { ...form.dm_triggers, linkedinOffer: e.target.value as 'ressource' | 'diagnostic' })}>
              <option value="diagnostic">Autre chose — un diagnostic de son organisation (recommandé)</option>
              <option value="ressource">La même ressource que le lien de la description</option>
            </select>
            <p className="mt-2 text-xs text-muted">
              Le lien de la description donne déjà la ressource. Si le mot-clé donne la même chose, personne n'a de raison de commenter — et un clic
              ne dit pas <em>qui</em> s'intéresse. Un diagnostic, lui, ne se télécharge pas : il se demande. C'est ce qui transforme un lecteur en
              conversation.
            </p>
            {form.dm_triggers.linkedinOffer !== 'ressource' && (
              <div className="mt-3 grid gap-3">
                <div>
                  <label className="label">Mots à commenter sur LinkedIn</label>
                  <input className="input" value={(form.dm_triggers.diagnosticKeywords ?? []).join(', ')}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, diagnosticKeywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
                  <p className="mt-1 text-xs text-muted">Un seul mot chacun, 3 à 14 lettres. Le rédacteur en choisit un par post.</p>
                </div>
                <div>
                  <label className="label">Ce que le diagnostic offre (annoncé dans le post, repris dans les réponses)</label>
                  <input className="input" placeholder="un regard sur votre organisation et ce qui peut y être automatisé, en 20 minutes"
                    value={form.dm_triggers.diagnosticPromise ?? ''}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, diagnosticPromise: e.target.value })} />
                </div>
                <p className="text-xs text-muted">
                  La réponse postée sous le commentaire rappelle que le lien est dans le post et propose le rendez-vous ci-dessous : renseigne-le,
                  sinon elle renvoie vers le site.
                </p>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-line p-4">
            <label className="label !mb-1">Prise de rendez-vous — la porte de sortie du tunnel</label>
            <p className="mb-3 text-xs text-muted">
              C’est le seul endroit où l’on demande quelque chose : à la dernière page du guide PDF (bouton cliquable, lien tracké) et dans
              le message qui suit l’envoi. Le moment où la personne vient de recevoir ce qu’elle a demandé est celui où son intérêt est le
              plus fort. Vide : le guide renvoie simplement vers le site.
            </p>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
              <div>
                <label className="label">Adresse du calendrier ou de la page de contact</label>
                <input className="input" placeholder="https://cal.com/odile/20min"
                  value={form.dm_triggers.rdvUrl ?? ''}
                  onChange={(e) => set('dm_triggers', { ...form.dm_triggers, rdvUrl: e.target.value })} />
              </div>
              <div>
                <label className="label">Libellé du bouton</label>
                <input className="input" placeholder="Prendre 20 minutes"
                  value={form.dm_triggers.rdvLabel ?? ''}
                  onChange={(e) => set('dm_triggers', { ...form.dm_triggers, rdvLabel: e.target.value })} />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted">
              Placeholders : <code>{'{{link}}'}</code> le lien de la ressource, <code>{'{{ressource}}'}</code> son titre exact,{' '}
              <code>{'{{motcle}}'}</code> le mot commenté, <code>{'{{prenom}}'}</code> le prénom (LinkedIn),{' '}
              <code>{'{{rdv}}'}</code> le rendez-vous ci-dessus. Un placeholder sans valeur disparaît proprement.
            </p>
          </div>
          <div className="rounded-xl border border-line p-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-sky-500" checked={form.dm_triggers.publicReply ?? true}
                onChange={(e) => set('dm_triggers', { ...form.dm_triggers, publicReply: e.target.checked })} />
              <span>
                Répondre publiquement sous le commentaire (Instagram et LinkedIn — décocher coupe les deux)
                <span className="mt-1 block text-xs text-muted">
                  Cette réponse ne dépend pas de la messagerie Meta : elle part même quand le message privé est
                  refusé, et elle montre aux autres lecteurs que le compte répond.
                </span>
              </span>
            </label>
            {(form.dm_triggers.publicReply ?? true) && (
              <div className="mt-3 grid gap-3">
                <div>
                  <label className="label">Phrases quand le message privé est parti — une par ligne, tirées à tour de rôle</label>
                  <textarea className="input" rows={5} value={(form.dm_triggers.publicReplyVariants ?? []).join('\n')}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, publicReplyVariants: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })} />
                </div>
                <div>
                  <label className="label">Phrases quand il n'a pas pu partir (invitation à écrire en privé)</label>
                  <textarea className="input" rows={4} value={(form.dm_triggers.publicReplyFallbackVariants ?? []).join('\n')}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, publicReplyFallbackVariants: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })} />
                </div>
                <p className="text-xs text-muted">
                  Le lien ne part jamais en commentaire : il reste dans le message privé.
                </p>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-line p-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-sky-500" checked={form.dm_triggers.requireFollow ?? false}
                onChange={(e) => set('dm_triggers', { ...form.dm_triggers, requireFollow: e.target.checked })} />
              <span>
                Demander l'abonnement avant d'envoyer le lien
                <span className="mt-1 block text-xs text-muted">
                  En deux temps, parce qu'Instagram ne dit pas qui suit le compte tant que la conversation n'est pas
                  ouverte. <b>1.</b> Le premier message ne réclame rien : il demande seulement de répondre — un abonné
                  n'a donc jamais l'impression qu'on lui demande de s'abonner. <b>2.</b> Sa réponse rend l'abonnement
                  lisible : le lien part s'il suit, la demande d'abonnement part sinon.
                </span>
              </span>
            </label>
            {form.dm_triggers.requireFollow && (
              <div className="mt-3 grid gap-3">
                <div>
                  <label className="label">1. Premier message (demande juste une réponse, sans le lien)</label>
                  <textarea className="input" rows={2} value={form.dm_triggers.askFollowTemplate ?? ''}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, askFollowTemplate: e.target.value })} />
                </div>
                <div>
                  <label className="label">2. Une fois l'abonnement constaté : remerciement + lien</label>
                  <textarea className="input" rows={2} value={form.dm_triggers.thanksTemplate ?? ''}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, thanksTemplate: e.target.value })} />
                </div>
                <div>
                  <label className="label">3. Si la personne répond sans suivre le compte</label>
                  <textarea className="input" rows={2} value={form.dm_triggers.remindTemplate ?? ''}
                    onChange={(e) => set('dm_triggers', { ...form.dm_triggers, remindTemplate: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Studio de design" saving={savingOf('design_studio')} onSave={() => save.mutate({ key: 'design_studio', value: form.design_studio })}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.design_studio.enabled}
            onChange={(e) => set('design_studio', { ...form.design_studio, enabled: e.target.checked })} />
          Faire critiquer chaque visuel par les 4 reviewers IA avant validation
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Itérations max : {form.design_studio.maxIterations}</label>
            <input type="range" min={1} max={5} className="w-full accent-sky-500" value={form.design_studio.maxIterations}
              onChange={(e) => set('design_studio', { ...form.design_studio, maxIterations: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Seuil de validation : {form.design_studio.passThreshold}/100</label>
            <input type="range" min={50} max={95} className="w-full accent-sky-500" value={form.design_studio.passThreshold}
              onChange={(e) => set('design_studio', { ...form.design_studio, passThreshold: Number(e.target.value) })} />
          </div>
        </div>
      </Section>

      <Section title="Illustrations IA" saving={savingOf('image_gen')} onSave={() => save.mutate({ key: 'image_gen', value: form.image_gen })}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.image_gen.enabled}
            onChange={(e) => set('image_gen', { ...form.image_gen, enabled: e.target.checked })} />
          Générer des illustrations IA (Nano Banana Pro) quand l'archétype du post s'y prête
        </label>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.image_gen.autoPlace ?? false}
            onChange={(e) => set('image_gen', { ...form.image_gen, autoPlace: e.target.checked })} />
          Poser automatiquement l'illustration sur l'accroche — décoché : l'agent visuel la propose et vous la posez si elle vous plaît
        </label>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.image_gen.monochrome ?? true}
            onChange={(e) => set('image_gen', { ...form.image_gen, monochrome: e.target.checked })} />
          Toutes les images en noir et blanc — illustrations, studio et bibliothèque (le modèle reçoit un guide monochrome, et le serveur désature quoi qu'il arrive)
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Illustrations max par post : {form.image_gen.imagesPerPost}</label>
            <input type="range" min={0} max={2} className="w-full accent-sky-500" value={form.image_gen.imagesPerPost}
              onChange={(e) => set('image_gen', { ...form.image_gen, imagesPerPost: Number(e.target.value) })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Style des illustrations</label>
            <select className="input" value={form.image_gen.style ?? 'auto'}
              onChange={(e) => set('image_gen', { ...form.image_gen, style: e.target.value as 'auto' | 'full' | 'objets' | 'chrome' })}>
              <option value="auto">Auto — l'agent choisit selon la slide et l'archétype (recommandé)</option>
              <option value="full">Plein cadre — scène cinématique, sujet en haut, titre en bas</option>
              <option value="objets">Objets détourés — objet 3D isolé, fondu à la palette, détouré automatiquement</option>
              <option value="chrome">Chrome & verre — rendu 3D irisé, halo accent</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Références de style — l'image guide le rendu (lumière, contraste, profondeur), pas le sujet</label>
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                ['full', 'Plein cadre', 'ex : la scène Superman'],
                ['objets', 'Objets détourés', 'ex : les pièces 3D'],
                ['chrome', 'Chrome & verre', 'ex : le token chrome'],
              ] as const).map(([key, label, hint]) => {
                const refId = form.image_gen.references?.[key] ?? null;
                const img = library?.find((i) => i.id === refId) ?? null;
                return (
                  <div key={key} className="rounded-xl border border-line p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold">{label}</span>
                      {refId && (
                        <button className="pill-btn" title="Retirer la référence"
                          onClick={() => set('image_gen', { ...form.image_gen, references: { ...form.image_gen.references, [key]: null } })}>
                          ×
                        </button>
                      )}
                    </div>
                    {img ? (
                      <LibraryThumb img={img} className="aspect-[4/5] w-full rounded-lg" />
                    ) : (
                      <div className="flex aspect-[4/5] items-center justify-center rounded-lg border border-dashed border-line px-3 text-center text-xs text-muted">
                        {hint}
                      </div>
                    )}
                    <button className="btn-ghost mt-2 w-full justify-center !py-1 text-xs" onClick={() => setRefPicker(key)}>
                      {refId ? 'Changer' : 'Choisir dans la bibliothèque'}
                    </button>
                    <textarea className="input mt-2 !py-1.5 text-xs" rows={2}
                      placeholder={`Consignes ${label.toLowerCase()} (facultatif)`}
                      value={form.image_gen.notesByStyle?.[key] ?? ''}
                      onChange={(e) => set('image_gen', { ...form.image_gen, notesByStyle: { ...form.image_gen.notesByStyle, [key]: e.target.value } })} />
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              Importez vos références dans <b>Images</b>. Flux et Mystic reçoivent l'image directement ; les modèles Google ont besoin d'une URL publique en https (c'est le cas en production).
            </p>
            <LibraryPicker
              open={refPicker !== null}
              title="Image de référence"
              onClose={() => setRefPicker(null)}
              onPick={(img) => {
                if (refPicker) set('image_gen', { ...form.image_gen, references: { ...form.image_gen.references, [refPicker]: img.id } });
                setRefPicker(null);
              }}
            />
          </div>
          <details className="section-toggle sm:col-span-2 rounded-xl border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">Réglages avancés — qualité, fournisseur, modèles, notes de direction artistique</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Qualité</label>
            <select className="input" value={form.image_gen.quality}
              onChange={(e) => set('image_gen', { ...form.image_gen, quality: e.target.value as 'pro' | 'fast' })}>
              <option value="pro">Pro — Nano Banana Pro (qualité max)</option>
              <option value="fast">Rapide — Nano Banana 2 (économique)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Fournisseur d'images</label>
            <select className="input" value={form.image_gen.provider ?? 'auto'}
              onChange={(e) => set('image_gen', { ...form.image_gen, provider: e.target.value as 'auto' | 'gemini' | 'freepik' })}>
              <option value="auto">Auto — Freepik/Magnific si sa clé est présente, sinon Gemini direct</option>
              <option value="freepik">Freepik / Magnific (Nano Banana Pro via leur plateforme, clé FREEPIK_API_KEY)</option>
              <option value="gemini">Gemini direct (clé GEMINI_API_KEY)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Modèle Freepik / Magnific par style (vide = modèle par défaut ci-dessous)</label>
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                ['full', 'Plein cadre', 'Nano Banana Pro : fidélité, lumière, couleur signature'],
                ['objets', 'Objets détourés', 'Flux.2 Klein : rapide, accepte l’objet précédent en référence (séries)'],
                ['chrome', 'Chrome & verre', 'Nano Banana Pro ou Mystic : matières'],
              ] as const).map(([key, label, hint]) => (
                <div key={key}>
                  <span className="mb-1 block text-xs font-semibold">{label}</span>
                  <select className="input !py-1.5 text-xs" value={form.image_gen.modelByStyle?.[key] ?? ''}
                    onChange={(e) => set('image_gen', { ...form.image_gen, modelByStyle: { ...form.image_gen.modelByStyle, [key]: e.target.value || undefined } })}>
                    <option value="">— modèle par défaut —</option>
                    {imageModels?.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label} · {m.speed}{m.recommended ? ' ★' : ''}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-muted">{hint}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Modèle Freepik / Magnific par défaut (studio, styles sans modèle dédié)</label>
            <select className="input" value={form.image_gen.model ?? 'nano-banana-pro-flash'}
              onChange={(e) => set('image_gen', { ...form.image_gen, model: e.target.value })}>
              {imageModels?.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label} · {m.speed}{m.recommended ? ' ★' : ''}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes de direction artistique (ajoutées à chaque génération)</label>
            <textarea className="input" rows={2} value={form.image_gen.styleNotes}
              placeholder="ex : privilégier les objets en verre, ambiance très minimaliste…"
              onChange={(e) => set('image_gen', { ...form.image_gen, styleNotes: e.target.value })} />
          </div>
            </div>
          </details>
        </div>
        <p className="mt-3 text-xs text-muted">
          Le texte n'est jamais dans l'image : il reste en surimpression HTML (typographie parfaite).
          Les reviewers colorimétrie/DA bloquent toute dérive hors palette du thème.
        </p>
      </Section>

      <Section title="Email de validation" saving={savingOf('approval_email')} onSave={() => save.mutate({ key: 'approval_email', value: form.approval_email })}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><label className="label">Destinataire</label>
            <input className="input" value={form.approval_email.to}
              onChange={(e) => set('approval_email', { ...form.approval_email, to: e.target.value })} /></div>
          <div><label className="label">Relances max</label>
            <input type="number" min={0} max={5} className="input" value={form.approval_email.maxReminders}
              onChange={(e) => set('approval_email', { ...form.approval_email, maxReminders: Number(e.target.value) })} /></div>
        </div>
        <button className="btn-ghost mt-3 !py-1.5 text-xs" disabled={testEmail.isPending} onClick={() => testEmail.mutate()}>
          {testEmail.isPending ? 'Envoi…' : 'Envoyer un email de test'}
        </button>
      </Section>

      <Section title="Agent visuel" saving={savingOf('visual_agent')} onSave={() => save.mutate({ key: 'visual_agent', value: form.visual_agent })}>
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.visual_agent?.enabled ?? true}
            onChange={(e) => set('visual_agent', { ...form.visual_agent, enabled: e.target.checked })} />
          Activer l'agent visuel (captures des pages liées au sujet et à la source + concepts d'illustration)
        </label>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.visual_agent?.autoRun ?? true}
            onChange={(e) => set('visual_agent', { ...form.visual_agent, autoRun: e.target.checked })} />
          Le lancer automatiquement pour chaque veille transformée en post
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Captures par passe : {form.visual_agent?.screenshots ?? 2}</label>
            <input type="range" min={0} max={5} className="w-full accent-sky-500" value={form.visual_agent?.screenshots ?? 2}
              onChange={(e) => set('visual_agent', { ...form.visual_agent, screenshots: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Images par passe : {form.visual_agent?.images ?? 3}</label>
            <input type="range" min={0} max={6} className="w-full accent-sky-500" value={form.visual_agent?.images ?? 3}
              onChange={(e) => set('visual_agent', { ...form.visual_agent, images: Number(e.target.value) })} />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Chaque passe coûte des crédits image ; « Encore des propositions » dans l'éditeur d'un post relance une passe sans limite.
        </p>
      </Section>

      <Section title="Défauts de création" saving={savingOf('default_theme', 'default_format')}
        onSave={() => save.mutate([{ key: 'default_theme', value: form.default_theme }, { key: 'default_format', value: form.default_format }])}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">Thème par défaut</label>
            <select className="input" value={form.default_theme || 'dernier'} onChange={(e) => set('default_theme', e.target.value)}>
              <option value="dernier">Dernier template créé (suit automatiquement)</option>
              {!catalogue && form.default_theme && form.default_theme !== 'dernier' && <option value={form.default_theme}>{form.default_theme}</option>}
              {catalogue && catalogue.custom.length > 0 && (
                <optgroup label="Mes templates">
                  {catalogue.custom.map((t) => <option key={t.themeId} value={t.themeId}>{t.name}</option>)}
                </optgroup>
              )}
              {catalogue && (
                <optgroup label="Thèmes fournis">
                  {catalogue.builtin.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </optgroup>
              )}
            </select>
            <p className="mt-1.5 text-xs text-muted">
              Par défaut, les posts générés prennent le dernier template que vous avez créé : dessinez-en un, il
              s'applique aux publications suivantes. Épinglez-en un précis pour figer le rendu.
            </p></div>
          <div><label className="label">Format Instagram par défaut</label>
            <select className="input" value={form.default_format} onChange={(e) => set('default_format', e.target.value)}>
              {['carousel', 'static'].map((v) => (
                <option key={v} value={v}>{v === 'carousel' ? `${FORMAT_LABELS[v]} (recommandé — meilleur engagement)` : FORMAT_LABELS[v]}</option>
              ))}
            </select></div>
        </div>
      </Section>

      <Section title="Sources de veille">
        <div className="flex flex-col gap-1.5">
          {sources?.map((source) => (
            <label key={source.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-panel2">
              <input type="checkbox" className="accent-sky-500" checked={source.enabled}
                onChange={(e) => toggleSource.mutate({ id: source.id, enabled: e.target.checked })} />
              <span className="w-52 font-medium">{source.name}</span>
              <span className="text-xs text-muted">{source.lang.toUpperCase()} · poids {source.weight}</span>
              {source.lastError && <span className="truncate text-xs text-muted italic" title={source.lastError}>{source.lastError.slice(0, 60)}</span>}
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}

interface AvatarDto {
  id: string;
  nom: string;
  type: 'avatar' | 'talking_photo';
  genre: string;
  apercu: string | null;
}
interface VoixDto {
  id: string;
  nom: string;
  langue: string;
  genre: string;
  apercu: string | null;
  emotions: boolean;
}

/**
 * Vidéos avatar : l'avatar et la voix se choisissent dans la liste du compte HeyGen
 * connecté — jamais un identifiant collé à la main — et l'essai part en mode test,
 * donc sans consommer de crédit.
 */
function SectionVideo({
  form,
  set,
  saving,
  onSave,
}: {
  form: AllSettings;
  set: <K extends keyof AllSettings>(k: K, v: AllSettings[K]) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const v = form.video;
  const [essai, setEssai] = useState<{ providerId: string; statut: string; url: string | null } | null>(null);
  const {
    data: comptes,
    refetch: charger,
    isFetching,
    error: erreurComptes,
  } = useQuery({
    queryKey: ['video', 'comptes'],
    queryFn: () => api.get<{ avatars: AvatarDto[]; voix: VoixDto[] }>('/api/video/comptes'),
    enabled: false,
    retry: false,
  });
  const lancerEssai = useMutation({
    mutationFn: () => api.post<{ providerId: string }>('/api/video/essai', {}),
    onSuccess: (r) => {
      setEssai({ providerId: r.providerId, statut: 'processing', url: null });
      toast.info('Essai lancé — la vidéo arrive dans une à trois minutes');
    },
    onError: (err) => toast.error(humanizeError(err)),
  });
  // Tant que l'essai tourne, on demande son état toutes les dix secondes.
  useQuery({
    queryKey: ['video', 'essai', essai?.providerId],
    queryFn: async () => {
      const etat = await api.get<{ statut: string; videoUrl: string | null; erreur: string | null }>(
        `/api/video/essai/${essai!.providerId}`,
      );
      if (etat.statut === 'completed' && etat.videoUrl) setEssai({ providerId: essai!.providerId, statut: 'completed', url: etat.videoUrl });
      else if (etat.statut === 'failed') {
        toast.error(`Essai en échec : ${etat.erreur ?? 'motif non donné'}`);
        setEssai(null);
      }
      return etat;
    },
    enabled: Boolean(essai && essai.statut !== 'completed'),
    refetchInterval: 10_000,
  });

  const avatars = comptes?.avatars ?? [];
  const voix = comptes?.voix ?? [];
  const avatarChoisi = avatars.find((a) => a.id === v.avatarId);
  const maj = <K extends keyof AllSettings['video']>(k: K, val: AllSettings['video'][K]) => set('video', { ...v, [k]: val });

  return (
    <Section title="Vidéos avatar (HeyGen)" saving={saving} onSave={onSave}>
      <label className="mb-1 flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-sky-500" checked={v.enabled} onChange={(e) => maj('enabled', e.target.checked)} />
        Fabriquer des vidéos avec l’avatar de la marque
      </label>
      <p className="mb-4 text-xs text-muted">
        Le moteur écrit le script, HeyGen le fait dire à ton avatar, et le MP4 part en Reel Instagram, en vidéo native LinkedIn et sur la
        Page Facebook. La slide d’accroche sert de couverture. La clé HeyGen se saisit dans Connexions &amp; santé.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-ghost !py-1.5 text-xs" disabled={isFetching} onClick={() => void charger()}>
          {isFetching ? 'Lecture du compte HeyGen…' : 'Charger mes avatars et mes voix'}
        </button>
        {erreurComptes && <span className="text-xs text-accent">{humanizeError(erreurComptes)}</span>}
        {avatars.length > 0 && <span className="text-xs text-muted">{avatars.length} avatars · {voix.length} voix</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Avatar</label>
          {avatars.length > 0 ? (
            <select
              className="input"
              value={v.avatarId}
              onChange={(e) => {
                const a = avatars.find((x) => x.id === e.target.value);
                set('video', { ...v, avatarId: e.target.value, avatarType: a?.type ?? 'avatar' });
              }}
            >
              <option value="">— choisir —</option>
              {avatars.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nom}
                  {a.type === 'talking_photo' ? ' (photo animée)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" value={v.avatarId} onChange={(e) => maj('avatarId', e.target.value)} placeholder="charge la liste, ou colle un avatar_id" />
          )}
        </div>
        <div>
          <label className="label">Voix</label>
          {voix.length > 0 ? (
            <select className="input" value={v.voiceId} onChange={(e) => maj('voiceId', e.target.value)}>
              <option value="">— choisir —</option>
              {voix.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nom} {x.langue ? `· ${x.langue}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" value={v.voiceId} onChange={(e) => maj('voiceId', e.target.value)} placeholder="charge la liste, ou colle un voice_id" />
          )}
        </div>
        <div>
          <label className="label">Cadrage {v.avatarType === 'talking_photo' ? '(sans effet sur une photo animée)' : ''}</label>
          <select className="input" value={v.avatarStyle} onChange={(e) => maj('avatarStyle', e.target.value)} disabled={v.avatarType === 'talking_photo'}>
            <option value="normal">Normal</option>
            <option value="closeUp">Gros plan</option>
            <option value="circle">Rond</option>
          </select>
        </div>
        <div>
          <label className="label">Débit de la voix · {v.voiceSpeed.toFixed(2)}×</label>
          <input type="range" min={0.8} max={1.2} step={0.05} className="w-full accent-sky-500" value={v.voiceSpeed} onChange={(e) => maj('voiceSpeed', Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Une vidéo tous les {v.everyNPosts || '—'} post(s)</label>
          <input type="range" min={0} max={10} className="w-full accent-sky-500" value={v.everyNPosts} onChange={(e) => maj('everyNPosts', Number(e.target.value))} />
          <p className="text-[11px] text-muted">0 = jamais automatiquement (tu lances la vidéo depuis un post).</p>
        </div>
        <div>
          <label className="label">Durée visée · {v.targetSeconds} s</label>
          <input type="range" min={15} max={90} step={5} className="w-full accent-sky-500" value={v.targetSeconds} onChange={(e) => maj('targetSeconds', Number(e.target.value))} />
          <p className="text-[11px] text-muted">Instagram accepte 5 à 90 s ; 30 à 45 s retient le mieux.</p>
        </div>
        <div>
          <label className="label">Fond</label>
          <div className="flex gap-2">
            <select className="input" value={v.backgroundType} onChange={(e) => maj('backgroundType', e.target.value as 'couleur' | 'image')}>
              <option value="couleur">Couleur du template</option>
              <option value="image">Image de la bibliothèque</option>
            </select>
            <input
              className="input"
              value={v.backgroundValue}
              onChange={(e) => maj('backgroundValue', e.target.value)}
              placeholder={v.backgroundType === 'couleur' ? '#06050a (vide = couleur du template)' : 'identifiant d’image'}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-sky-500" checked={v.captions} onChange={(e) => maj('captions', e.target.checked)} />
            Sous-titres incrustés
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-sky-500" checked={v.testMode} onChange={(e) => maj('testMode', e.target.checked)} />
            Mode test (filigrane, aucun crédit consommé)
          </label>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button className="btn-ghost !py-1.5 text-xs" disabled={lancerEssai.isPending || !v.avatarId || !v.voiceId} onClick={() => lancerEssai.mutate()}>
          {lancerEssai.isPending ? 'Demande…' : 'Tester l’avatar et la voix'}
        </button>
        <span className="text-xs text-muted">
          {avatarChoisi ? `${avatarChoisi.nom} · ` : ''}l’essai part toujours en mode test : il ne coûte aucun crédit.
        </span>
        {essai && essai.statut !== 'completed' && <span className="text-xs text-muted">Fabrication en cours…</span>}
      </div>
      {essai?.url && (
        <video src={essai.url} controls playsInline className="mt-3 w-full max-w-[260px] rounded-2xl border border-line" />
      )}
    </Section>
  );
}
