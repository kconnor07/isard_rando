import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import LibraryPicker, { LibraryThumb } from '../components/LibraryPicker';
import { PageTitle } from '../components/shared';
import type { LibraryImageDto } from '../api/types';

type AllSettings = Record<string, unknown> & {
  tone: { preset: string; registre: number; emojiLevel: number; ctaStyle: string; customInstructions?: string };
  brand: { name: string; handle: string; siteUrl: string; accentColor: string; tagline: string; logoAssetId: string | null; avatarAssetId?: string | null; authorLine?: string };
  cadence: { days: number; rotation: string[] };
  publish_slots: { ig: { dow: number; time: string }[]; li: { dow: number; time: string }[] };
  dm_triggers: { enabled: boolean; keywords: string[]; replyTemplate: string };
  approval_email: { to: string; subjectPrefix: string; maxReminders: number };
  design_studio: { enabled: boolean; maxIterations: number; passThreshold: number };
  image_gen: { enabled: boolean; imagesPerPost: number; styleNotes: string; quality: 'pro' | 'fast'; monochrome: boolean; provider: 'auto' | 'gemini' | 'freepik'; model: string; style: 'auto' | 'full' | 'objets' | 'chrome'; references: Record<string, string | null | undefined>; notesByStyle: Record<string, string | undefined>; modelByStyle?: Record<string, string | undefined> };
  visual_agent: { enabled: boolean; autoRun: boolean; screenshots: number; images: number };
  default_theme: string;
  default_format: string;
};

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
  const { data: settings } = useQuery({
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

  const save = useMutation({
    mutationFn: (vars: { key: string; value: unknown }) => api.put(`/api/settings/${vars.key}`, vars.value),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const toggleSource = useMutation({
    mutationFn: (vars: { id: number; enabled: boolean }) => api.patch(`/api/sources/${vars.id}`, { enabled: vars.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sources'] }),
  });

  if (!form) return <div className="text-muted">Chargement…</div>;
  const set = <K extends keyof AllSettings>(key: K, value: AllSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <div className="max-w-3xl">
      <PageTitle title="Réglages" subtitle="Ton, marque, cadence, déclencheurs DM, studio de design, veille." />

      <Section title="Ton des posts" saving={save.isPending} onSave={() => save.mutate({ key: 'tone', value: form.tone })}>
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

      <Section title="Marque" saving={save.isPending} onSave={() => save.mutate({ key: 'brand', value: form.brand })}>
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
          <div className="sm:col-span-2">
            <label className="label">Logo (PNG/JPG, affiché sur chaque slide)</label>
            <div className="flex items-center gap-3">
              {form.brand.logoAssetId && <img src={`/api/assets/${form.brand.logoAssetId}`} className="h-10 w-10 rounded-lg object-cover" alt="logo" />}
              <label className="btn-ghost cursor-pointer !py-1.5 text-xs">
                {form.brand.logoAssetId ? 'Remplacer le logo' : 'Choisir un fichier'}
              <input type="file" accept="image/*" hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append('file', file);
                  await fetch('/api/settings/brand/logo', { method: 'POST', body: fd });
                  void qc.invalidateQueries({ queryKey: ['settings'] });
                  setForm(null);
                }} />
              </label>
              <span className="text-xs text-muted">PNG transparent recommandé — remplace le nom + handle sur chaque slide.</span>
            </div>
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

      <Section title="Cadence & créneaux" saving={save.isPending}
        onSave={() => { save.mutate({ key: 'cadence', value: form.cadence }); save.mutate({ key: 'publish_slots', value: form.publish_slots }); }}>
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
        <div className="grid gap-6 sm:grid-cols-2">
          <div><label className="label">Créneaux Instagram</label>
            <SlotsEditor slots={form.publish_slots.ig} onChange={(ig) => set('publish_slots', { ...form.publish_slots, ig })} /></div>
          <div><label className="label">Créneaux LinkedIn</label>
            <SlotsEditor slots={form.publish_slots.li} onChange={(li) => set('publish_slots', { ...form.publish_slots, li })} /></div>
        </div>
      </Section>

      <Section title="Commentaire → DM" saving={save.isPending} onSave={() => save.mutate({ key: 'dm_triggers', value: form.dm_triggers })}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.dm_triggers.enabled}
            onChange={(e) => set('dm_triggers', { ...form.dm_triggers, enabled: e.target.checked })} />
          Activer l'envoi automatique de DM Instagram sur mot-clé
        </label>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="label">Mots-clés déclencheurs (séparés par des virgules)</label>
            <input className="input" value={form.dm_triggers.keywords.join(', ')}
              onChange={(e) => set('dm_triggers', { ...form.dm_triggers, keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </div>
          <div>
            <label className="label">Message envoyé ({'{{link}}'} = lien tracké du post)</label>
            <textarea className="input" rows={3} value={form.dm_triggers.replyTemplate}
              onChange={(e) => set('dm_triggers', { ...form.dm_triggers, replyTemplate: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section title="Studio de design" saving={save.isPending} onSave={() => save.mutate({ key: 'design_studio', value: form.design_studio })}>
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

      <Section title="Illustrations IA" saving={save.isPending} onSave={() => save.mutate({ key: 'image_gen', value: form.image_gen })}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.image_gen.enabled}
            onChange={(e) => set('image_gen', { ...form.image_gen, enabled: e.target.checked })} />
          Générer des illustrations IA (Nano Banana Pro) quand l'archétype du post s'y prête
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

      <Section title="Email de validation" saving={save.isPending} onSave={() => save.mutate({ key: 'approval_email', value: form.approval_email })}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><label className="label">Destinataire</label>
            <input className="input" value={form.approval_email.to}
              onChange={(e) => set('approval_email', { ...form.approval_email, to: e.target.value })} /></div>
          <div><label className="label">Relances max</label>
            <input type="number" min={0} max={5} className="input" value={form.approval_email.maxReminders}
              onChange={(e) => set('approval_email', { ...form.approval_email, maxReminders: Number(e.target.value) })} /></div>
        </div>
        <button className="btn-ghost mt-3 !py-1.5 text-xs" onClick={() => void api.post('/api/settings/test-email')}>
          Envoyer un email de test
        </button>
      </Section>

      <Section title="Agent visuel" saving={save.isPending} onSave={() => save.mutate({ key: 'visual_agent', value: form.visual_agent })}>
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

      <Section title="Défauts de création" saving={save.isPending}
        onSave={() => { save.mutate({ key: 'default_theme', value: form.default_theme }); save.mutate({ key: 'default_format', value: form.default_format }); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">Thème par défaut</label>
            <select className="input" value={form.default_theme} onChange={(e) => set('default_theme', e.target.value)}>
              {!catalogue && <option value={form.default_theme}>{form.default_theme}</option>}
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
            </select></div>
          <div><label className="label">Format Instagram par défaut</label>
            <select className="input" value={form.default_format} onChange={(e) => set('default_format', e.target.value)}>
              <option value="carousel">Carrousel (recommandé — meilleur engagement)</option>
              <option value="static">Post statique</option>
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
