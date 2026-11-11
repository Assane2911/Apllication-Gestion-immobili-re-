import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiErrorMessage, DELAI_UPLOAD_MS, MAX_UPLOAD_SIZE_MB } from "../api/client";
import type { CategorieDocument, Property, StoredDocument, Tenant } from "../types";
import { CATEGORIES_DOCUMENT, titreDepuisNomDeFichier } from "../utils/documents";
import { preparerFichier } from "../utils/fichiers";
import CadreModale from "./CadreModale";
import ChampDate from "./ChampDate";
import { AIDE, BOUTON_ANNULER, BOUTON_PLEIN, CHAMP, ERREUR, ETIQUETTE } from "./styleFormulaire";

interface Props {
  /** Présent : modification des informations (le fichier et le rattachement ne changent pas). Absent : nouveau dépôt. */
  document?: StoredDocument;
  properties: Property[];
  tenants: Tenant[];
  /** Rattachement proposé à l'ouverture (filtre actif de la page). */
  initialPropertyId?: string;
  onSaved: () => void;
  onClose: () => void;
}

const jourSaisie = (valeur: string | null | undefined) => (valeur ? new Date(valeur).toISOString().slice(0, 10) : "");

/**
 * Dépôt ou correction d'un document rangé. Le fichier part avec ses informations dans une seule requête ; une photo trop
 * lourde est d'abord réduite (voir preparerFichier). La date d'expiration, facultative, alimente l'agenda.
 */
export default function StoredDocumentModal({ document, properties, tenants, initialPropertyId, onSaved, onClose }: Props) {
  const { t } = useTranslation();
  const edition = Boolean(document);
  const [fichier, setFichier] = useState<File | null>(null);
  const [titre, setTitre] = useState(document?.title ?? "");
  const [categorie, setCategorie] = useState<CategorieDocument>(document?.category ?? "OTHER");
  const [bienId, setBienId] = useState(document?.propertyId ?? initialPropertyId ?? "");
  const [locataireId, setLocataireId] = useState(document?.tenantId ?? "");
  const [expiration, setExpiration] = useState(jourSaisie(document?.expiresAt));
  const [notes, setNotes] = useState(document?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choisirFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const brut = e.target.files?.[0] ?? null;
    const pret = brut ? await preparerFichier(brut) : null;
    if (brut && !pret) {
      e.target.value = "";
      setFichier(null);
      setError(t("common.errors.fileTooLarge", { maxMb: MAX_UPLOAD_SIZE_MB }));
      return;
    }
    setError(null);
    setFichier(pret);
    if (pret && !titre.trim()) setTitre(titreDepuisNomDeFichier(pret.name));
  }

  async function enregistrer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!edition && !fichier) return setError(t("manager.documents.form.needFile"));
    if (!edition && !bienId && !locataireId) return setError(t("manager.documents.form.needTarget"));
    setSaving(true);
    try {
      if (document) {
        await api.put(`/stored-documents/${document.id}`, { title: titre.trim(), category: categorie, expiresAt: expiration || null, notes: notes.trim() || null });
      } else {
        const data = new FormData();
        data.append("file", fichier!);
        data.append("title", titre.trim());
        data.append("category", categorie);
        if (bienId) data.append("propertyId", bienId);
        if (locataireId) data.append("tenantId", locataireId);
        if (expiration) data.append("expiresAt", expiration);
        if (notes.trim()) data.append("notes", notes.trim());
        await api.post("/stored-documents", data, { timeout: DELAI_UPLOAD_MS });
      }
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CadreModale
      titre={t(edition ? "manager.documents.form.editTitle" : "manager.documents.form.addTitle")}
      titreId="stored-document-titre"
      onClose={onClose}
      fermable={!saving}
      largeur="lg"
    >
      <form onSubmit={enregistrer} className="space-y-4">
        {!edition && (
          <div>
            <label htmlFor="doc-fichier" className={ETIQUETTE}>
              {t("manager.documents.form.file")}
            </label>
            <input id="doc-fichier" type="file" accept="image/*,application/pdf" onChange={(e) => void choisirFichier(e)} className="w-full text-sm" />
            <p className={AIDE}>{t("manager.documents.form.fileHint", { maxMb: MAX_UPLOAD_SIZE_MB })}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="doc-titre" className={ETIQUETTE}>
              {t("manager.documents.form.title")}
            </label>
            <input id="doc-titre" required maxLength={200} value={titre} onChange={(e) => setTitre(e.target.value)} className={CHAMP} />
          </div>
          <div>
            <label htmlFor="doc-categorie" className={ETIQUETTE}>
              {t("manager.documents.form.category")}
            </label>
            <select id="doc-categorie" value={categorie} onChange={(e) => setCategorie(e.target.value as CategorieDocument)} className={CHAMP}>
              {CATEGORIES_DOCUMENT.map((c) => (
                <option key={c} value={c}>
                  {t(`manager.documents.categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="doc-expiration" className={ETIQUETTE}>
              {t("manager.documents.form.expiresAt")}
            </label>
            <ChampDate id="doc-expiration" value={expiration} onChange={(e) => setExpiration(e.target.value)} className={CHAMP} />
            <p className={AIDE}>{t("manager.documents.form.expiresHint")}</p>
          </div>
          {!edition && (
            <>
              <div>
                <label htmlFor="doc-bien" className={ETIQUETTE}>
                  {t("manager.documents.form.property")}
                </label>
                <select id="doc-bien" value={bienId} onChange={(e) => setBienId(e.target.value)} className={CHAMP}>
                  <option value="">{t("manager.documents.form.none")}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="doc-locataire" className={ETIQUETTE}>
                  {t("manager.documents.form.tenant")}
                </label>
                <select id="doc-locataire" value={locataireId} onChange={(e) => setLocataireId(e.target.value)} className={CHAMP}>
                  <option value="">{t("manager.documents.form.none")}</option>
                  {tenants.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.firstName} {l.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <label htmlFor="doc-notes" className={ETIQUETTE}>
              {t("manager.documents.form.notes")}
            </label>
            <textarea id="doc-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={CHAMP} />
          </div>
        </div>

        {error && (
          <p role="alert" className={ERREUR}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-300 pt-4">
          <button type="button" onClick={onClose} disabled={saving} className={BOUTON_ANNULER}>
            {t("common.actions.cancel")}
          </button>
          <button type="submit" disabled={saving} className={BOUTON_PLEIN}>
            {saving ? t("common.actions.saving") : t(edition ? "common.actions.save" : "manager.documents.form.submit")}
          </button>
        </div>
      </form>
    </CadreModale>
  );
}
