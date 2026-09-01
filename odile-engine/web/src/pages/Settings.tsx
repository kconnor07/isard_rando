import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { PageTitle } from '../components/shared';

type AllSettings = Record<string, unknown> & {
  tone: { preset: string; registre: number; emojiLevel: number; ctaStyle: string; customInstructions?: string };
  brand: { name: string; handle: string; siteUrl: string; accentColor: string; tagline: string; logoAssetId: string | null };
  cadence: { days: number; rotation: string[] };
  publish_slots: { ig: { dow: number; time: string }[]; li: { dow: number; time: string }[] };
  dm_triggers: { enabled: boolean; keywords: string[]; replyTemplate: string };
  approval_email: { to: string; subjectPrefix: string; maxReminders: number };
  design_studio: { enabled: boolean; maxIterations: number; passThreshold: number };
  image_gen: { enabled: boolean; imagesPerPost: number; styleNotes: string; quality: 'pro' | 'fast' };
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
  const [form, setForm] = useState<AllSettings | null>(null);
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

      <Section title="🎙 Ton des posts" saving={save.isPending} onSave={() => save.mutate({ key: 'tone', value: form.tone })}>
        <div className="grid grid-cols-2 gap-4">
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
          <div className="col-span-2">
            <label className="label">Instructions libres (facultatif)</label>
            <textarea className="input" rows={2} value={form.tone.customInstructions ?? ''}
              onChange={(e) => set('tone', { ...form.tone, customInstructions: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section title="🏷 Marque" saving={save.isPending} onSave={() => save.mutate({ key: 'brand', value: form.brand })}>
        <div className="grid grid-cols-2 gap-4">
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
          <div className="col-span-2"><label className="label">Tagline</label>
            <input className="input" value={form.brand.tagline} onChange={(e) => set('brand', { ...form.brand, tagline: e.target.value })} /></div>
          <div className="col-span-2">
            <label className="label">Logo (PNG/JPG, affiché sur chaque slide)</label>
            <div className="flex items-center gap-3">
              {form.brand.logoAssetId && <img src={`/api/assets/${form.brand.logoAssetId}`} className="h-10 w-10 rounded-lg object-cover" alt="logo" />}
              <input type="file" accept="image/*" className="text-sm text-muted"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append('file', file);
                  await fetch('/api/settings/brand/logo', { method: 'POST', body: fd });
                  void qc.invalidateQueries({ queryKey: ['settings'] });
                  setForm(null);
                }} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="🗓 Cadence & créneaux" saving={save.isPending}
        onSave={() => { save.mutate({ key: 'cadence', value: form.cadence }); save.mutate({ key: 'publish_slots', value: form.publish_slots }); }}>
        <div className="mb-4 grid grid-cols-2 gap-4">
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
        <div className="grid grid-cols-2 gap-6">
          <div><label className="label">Créneaux Instagram</label>
            <SlotsEditor slots={form.publish_slots.ig} onChange={(ig) => set('publish_slots', { ...form.publish_slots, ig })} /></div>
          <div><label className="label">Créneaux LinkedIn</label>
            <SlotsEditor slots={form.publish_slots.li} onChange={(li) => set('publish_slots', { ...form.publish_slots, li })} /></div>
        </div>
      </Section>

      <Section title="💬 Commentaire → DM" saving={save.isPending} onSave={() => save.mutate({ key: 'dm_triggers', value: form.dm_triggers })}>
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

      <Section title="🎨 Studio de design" saving={save.isPending} onSave={() => save.mutate({ key: 'design_studio', value: form.design_studio })}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.design_studio.enabled}
            onChange={(e) => set('design_studio', { ...form.design_studio, enabled: e.target.checked })} />
          Faire critiquer chaque visuel par les 4 reviewers IA avant validation
        </label>
        <div className="grid grid-cols-2 gap-4">
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

      <Section title="🖼 Illustrations IA" saving={save.isPending} onSave={() => save.mutate({ key: 'image_gen', value: form.image_gen })}>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-500" checked={form.image_gen.enabled}
            onChange={(e) => set('image_gen', { ...form.image_gen, enabled: e.target.checked })} />
          Générer des illustrations IA (Nano Banana Pro) quand l'archétype du post s'y prête
        </label>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Illustrations max par post : {form.image_gen.imagesPerPost}</label>
            <input type="range" min={0} max={2} className="w-full accent-sky-500" value={form.image_gen.imagesPerPost}
              onChange={(e) => set('image_gen', { ...form.image_gen, imagesPerPost: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Qualité</label>
            <select className="input" value={form.image_gen.quality}
              onChange={(e) => set('image_gen', { ...form.image_gen, quality: e.target.value as 'pro' | 'fast' })}>
              <option value="pro">Pro — Nano Banana Pro (qualité max)</option>
              <option value="fast">Rapide — Nano Banana 2 (économique)</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Notes de direction artistique (ajoutées à chaque génération)</label>
            <textarea className="input" rows={2} value={form.image_gen.styleNotes}
              placeholder="ex : privilégier les objets en verre, ambiance très minimaliste…"
              onChange={(e) => set('image_gen', { ...form.image_gen, styleNotes: e.target.value })} />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Le texte n'est jamais dans l'image : il reste en surimpression HTML (typographie parfaite).
          Les reviewers colorimétrie/DA bloquent toute dérive hors palette bleue.
        </p>
      </Section>

      <Section title="📧 Email de validation" saving={save.isPending} onSave={() => save.mutate({ key: 'approval_email', value: form.approval_email })}>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2"><label className="label">Destinataire</label>
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

      <Section title="🎭 Défauts de création" saving={save.isPending}
        onSave={() => { save.mutate({ key: 'default_theme', value: form.default_theme }); save.mutate({ key: 'default_format', value: form.default_format }); }}>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Thème par défaut</label>
            <select className="input" value={form.default_theme} onChange={(e) => set('default_theme', e.target.value)}>
              <option value="odile-nuit">Odile Nuit (bleu horizon)</option>
              <option value="violet-glow">Halo Bleu (orbes lumineux)</option>
              <option value="cyan-tech">Bleu Tech (dégradés électriques)</option>
            </select></div>
          <div><label className="label">Format Instagram par défaut</label>
            <select className="input" value={form.default_format} onChange={(e) => set('default_format', e.target.value)}>
              <option value="carousel">Carrousel (recommandé — meilleur engagement)</option>
              <option value="static">Post statique</option>
            </select></div>
        </div>
      </Section>

      <Section title="📡 Sources de veille">
        <div className="flex flex-col gap-1.5">
          {sources?.map((source) => (
            <label key={source.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-panel2">
              <input type="checkbox" className="accent-sky-500" checked={source.enabled}
                onChange={(e) => toggleSource.mutate({ id: source.id, enabled: e.target.checked })} />
              <span className="w-52 font-medium">{source.name}</span>
              <span className="text-xs text-muted">{source.lang.toUpperCase()} · poids {source.weight}</span>
              {source.lastError && <span className="truncate text-xs text-red-400" title={source.lastError}>⚠ {source.lastError.slice(0, 60)}</span>}
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}
